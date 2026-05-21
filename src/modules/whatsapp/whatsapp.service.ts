import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { PrismaService } from '@/config/prisma.service';
import { PrismaRemoteAuthTenantStore } from './prisma-remote-auth-tenant.store';

// Lazy-loaded au premier appel pour ne pas crasher si Chromium absent au démarrage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WWebClient: any, WWebRemoteAuth: any, QRCodeLib: any;

function loadWWebDeps(): void {
  if (WWebClient) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const wweb = require('whatsapp-web.js');
  WWebClient = wweb.Client;
  WWebRemoteAuth = wweb.RemoteAuth;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  QRCodeLib = require('qrcode');
}

export interface WhatsappStatusResponse {
  connected: boolean;
  initializing?: boolean;
  hasSession?: boolean;
  lastError?: string;
  phoneNumber?: string;
  displayName?: string;
  connectedAt?: string;
  features?: WhatsappFeaturesResponse;
}

export interface WhatsappFeaturesResponse {
  otp: boolean;
  payment: boolean;
  absence: boolean;
  bulletin: boolean;
}

export interface WhatsappQrResponse {
  qrCode: string;
  expiresInSeconds: number;
}

const QR_TTL_SECONDS = 120;

interface TenantWaState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any | null;
  ready: boolean;
  latestQr: string | null;
  qrGeneratedAt: number | null;
  initializing: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  phoneNumber: string | null;
  displayName: string | null;
  connectedAt: Date | null;
  lastError: string | null;
  qrWaiters: Array<(qr: string | null) => void>;
}

@Injectable()
export class WhatsappService implements OnApplicationShutdown {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly states = new Map<string, TenantWaState>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    for (const [tenantId, state] of this.states.entries()) {
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      if (state.client) {
        try {
          await state.client.destroy();
        } catch {
          // ignore
        }
      }
      this.logger.log(`Client WhatsApp détruit (tenant=${tenantId})`);
    }
    this.states.clear();
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  async getStatus(tenantId: string): Promise<WhatsappStatusResponse> {
    await this.assertTenantExists(tenantId);
    const state = this.states.get(tenantId);
    const record = await this.prisma.whatsappSession.findUnique({ where: { tenantId } });

    const connected = state?.ready ?? record?.connected ?? false;
    const features = record
      ? {
          otp: record.featureOtp,
          payment: record.featurePayment,
          absence: record.featureAbsence,
          bulletin: record.featureBulletin,
        }
      : undefined;

    return {
      connected,
      initializing: state?.initializing ?? false,
      hasSession: !!record?.sessionData,
      lastError: state?.lastError ?? undefined,
      phoneNumber: state?.phoneNumber ?? record?.phoneNumber ?? undefined,
      displayName: state?.displayName ?? record?.displayName ?? undefined,
      connectedAt: state?.connectedAt?.toISOString() ?? record?.connectedAt?.toISOString() ?? undefined,
      features,
    };
  }

  async getQrCode(tenantId: string): Promise<WhatsappQrResponse> {
    await this.assertTenantExists(tenantId);

    const state = this.getOrCreateState(tenantId);
    if (state.ready) {
      throw new ServiceUnavailableException('WhatsApp déjà connecté — déconnectez avant de rescanner');
    }

    this.startClientIfNeeded(tenantId);

    // Attendre le QR (max 35s)
    const rawQr = await this.waitForQr(tenantId, 35_000);
    if (!rawQr) {
      throw new ServiceUnavailableException('QR code indisponible — réessayez dans quelques secondes');
    }

    loadWWebDeps();
    const dataUrl: string = await QRCodeLib.toDataURL(rawQr, { width: 300, margin: 1 });
    return { qrCode: dataUrl, expiresInSeconds: QR_TTL_SECONDS };
  }

  async logout(tenantId: string): Promise<void> {
    await this.assertTenantExists(tenantId);
    const state = this.states.get(tenantId);
    if (state) {
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      if (state.client) {
        try {
          await state.client.logout();
        } catch {
          try { await state.client.destroy(); } catch { /* ignore */ }
        }
      }
      this.states.delete(tenantId);
    }
    // Effacer la session en base
    await this.prisma.whatsappSession.updateMany({
      where: { tenantId },
      data: { sessionData: null, connected: false, phoneNumber: null, displayName: null, connectedAt: null },
    });
    this.logger.log(`WhatsApp déconnecté (tenant=${tenantId})`);
  }

  async getFeatures(tenantId: string): Promise<WhatsappFeaturesResponse> {
    await this.assertTenantExists(tenantId);
    const record = await this.prisma.whatsappSession.findUnique({ where: { tenantId } });
    return {
      otp: record?.featureOtp ?? false,
      payment: record?.featurePayment ?? false,
      absence: record?.featureAbsence ?? false,
      bulletin: record?.featureBulletin ?? false,
    };
  }

  async updateFeatures(tenantId: string, features: WhatsappFeaturesResponse): Promise<WhatsappFeaturesResponse> {
    await this.assertTenantExists(tenantId);
    const record = await this.prisma.whatsappSession.upsert({
      where: { tenantId },
      create: {
        tenantId,
        featureOtp: features.otp,
        featurePayment: features.payment,
        featureAbsence: features.absence,
        featureBulletin: features.bulletin,
      },
      update: {
        featureOtp: features.otp,
        featurePayment: features.payment,
        featureAbsence: features.absence,
        featureBulletin: features.bulletin,
      },
    });
    return {
      otp: record.featureOtp,
      payment: record.featurePayment,
      absence: record.featureAbsence,
      bulletin: record.featureBulletin,
    };
  }

  async sendMessage(tenantId: string, phone: string, message: string): Promise<void> {
    const state = this.states.get(tenantId);
    if (!state?.ready || !state.client) {
      throw new ServiceUnavailableException('WhatsApp non connecté pour ce tenant');
    }
    const chatId = this.normalizePhone(phone);
    await state.client.sendMessage(chatId, message);
    this.logger.log(`Message envoyé à ${chatId} (tenant=${tenantId})`);
  }

  isReady(tenantId: string): boolean {
    return this.states.get(tenantId)?.ready ?? false;
  }

  // ----------------------------------------------------------------
  // Private — gestion du client per-tenant
  // ----------------------------------------------------------------

  private getOrCreateState(tenantId: string): TenantWaState {
    if (!this.states.has(tenantId)) {
      this.states.set(tenantId, {
        client: null,
        ready: false,
        latestQr: null,
        qrGeneratedAt: null,
        initializing: false,
        reconnectTimer: null,
        phoneNumber: null,
        displayName: null,
        connectedAt: null,
        lastError: null,
        qrWaiters: [],
      });
    }
    return this.states.get(tenantId)!;
  }

  private startClientIfNeeded(tenantId: string): void {
    const state = this.getOrCreateState(tenantId);
    if (state.ready || state.initializing) return;
    this.initClient(tenantId);
  }

  private initClient(tenantId: string): void {
    const state = this.getOrCreateState(tenantId);
    if (state.initializing) return;
    state.initializing = true;

    if (state.client) {
      void state.client.destroy().catch(() => null);
      state.client = null;
    }

    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH ??
      this.config.get<string>('PUPPETEER_EXECUTABLE_PATH');

    const basePath = this.config.get<string>('WHATSAPP_AUTH_DATA_PATH', join(process.cwd(), '.wwebjs_auth'));
    const dataPath = join(basePath, tenantId);
    mkdirSync(dataPath, { recursive: true });

    loadWWebDeps();
    const store = new PrismaRemoteAuthTenantStore(this.prisma, tenantId, dataPath);
    const clientId = `school-${tenantId}`;

    const client = new WWebClient({
      authTimeoutMs: 90_000,
      qrMaxRetries: 6,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 5_000,
      userAgent:
        process.env.WHATSAPP_USER_AGENT ??
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      deviceName: 'NouraSchool',
      browserName: 'Chrome',
      authStrategy: new WWebRemoteAuth({
        clientId,
        dataPath,
        store,
        backupSyncIntervalMs: 60_000,
      }),
      puppeteer: {
        headless: 'new',
        ...(executablePath ? { executablePath } : {}),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
        ],
      },
    });

    state.client = client;

    client.on('qr', (qr: string) => {
      state.latestQr = qr;
      state.qrGeneratedAt = Date.now();
      state.ready = false;
      state.lastError = null;
      // Résoudre les waiters
      const waiters = state.qrWaiters.splice(0);
      for (const resolve of waiters) resolve(qr);
      this.logger.log(`QR généré (tenant=${tenantId})`);
    });

    client.on('ready', () => {
      state.ready = true;
      state.latestQr = null;
      state.qrGeneratedAt = null;
      state.lastError = null;
      const waiters = state.qrWaiters.splice(0);
      for (const resolve of waiters) resolve(null);
      this.logger.log(`WhatsApp prêt (tenant=${tenantId})`);

      // Récupérer les infos du téléphone connecté
      void client.getInfo().then((info: { wid?: { user?: string }; pushname?: string }) => {
        state.phoneNumber = info?.wid?.user ?? null;
        state.displayName = info?.pushname ?? null;
        state.connectedAt = new Date();
        // Persister en base
        void this.prisma.whatsappSession.upsert({
          where: { tenantId },
          create: { tenantId, connected: true, phoneNumber: state.phoneNumber, displayName: state.displayName, connectedAt: state.connectedAt },
          update: { connected: true, phoneNumber: state.phoneNumber, displayName: state.displayName, connectedAt: state.connectedAt },
        }).catch(() => null);
      }).catch(() => null);
    });

    client.on('authenticated', () => {
      state.latestQr = null;
      state.qrGeneratedAt = null;
      state.lastError = null;
      this.logger.log(`WhatsApp authentifié (tenant=${tenantId})`);
    });

    client.on('loading_screen', (percent: number, message: string) => {
      this.logger.log(`Chargement WhatsApp ${percent}% ${message ? `- ${message}` : ''} (tenant=${tenantId})`);
    });

    client.on('change_state', (waState: string) => {
      this.logger.log(`État WhatsApp=${waState} (tenant=${tenantId})`);
    });

    client.on('remote_session_saved', () => {
      this.logger.log(`Session sauvegardée en base (tenant=${tenantId})`);
    });

    client.on('auth_failure', (msg: string) => {
      state.ready = false;
      state.latestQr = null;
      state.qrGeneratedAt = null;
      state.lastError = msg || 'Échec authentification WhatsApp';
      this.logger.error(`Auth failure (tenant=${tenantId}): ${state.lastError}`);
      void this.prisma.whatsappSession.updateMany({
        where: { tenantId },
        data: { sessionData: null, connected: false, phoneNumber: null, displayName: null, connectedAt: null },
      }).catch(() => null);
      this.scheduleReconnect(tenantId);
    });

    client.on('disconnected', (reason: string) => {
      state.ready = false;
      state.latestQr = null;
      state.qrGeneratedAt = null;
      state.phoneNumber = null;
      state.displayName = null;
      state.lastError = reason ? `Déconnecté: ${reason}` : null;
      this.logger.warn(`Déconnecté (tenant=${tenantId}): ${reason}`);
      void this.prisma.whatsappSession.updateMany({
        where: { tenantId },
        data: { connected: false },
      }).catch(() => null);
      this.scheduleReconnect(tenantId);
    });

    client.initialize().catch((err: unknown) => {
      const message = this.formatError(err);
      state.lastError = message;
      this.logger.error(`Erreur init (tenant=${tenantId}): ${message}`);
      state.initializing = false;
      this.scheduleReconnect(tenantId);
    }).then(() => {
      state.initializing = false;
    });
  }

  private scheduleReconnect(tenantId: string): void {
    const state = this.states.get(tenantId);
    if (!state || state.reconnectTimer) return;
    state.initializing = false;
    state.reconnectTimer = setTimeout(() => {
      const s = this.states.get(tenantId);
      if (s) s.reconnectTimer = null;
      this.initClient(tenantId);
    }, 10_000);
  }

  private waitForQr(tenantId: string, timeoutMs: number): Promise<string | null> {
    const state = this.getOrCreateState(tenantId);
    if (state.latestQr && state.qrGeneratedAt && Date.now() - state.qrGeneratedAt < QR_TTL_SECONDS * 1000) {
      return Promise.resolve(state.latestQr);
    }
    state.latestQr = null;
    state.qrGeneratedAt = null;
    if (state.ready) return Promise.resolve(null);

    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        const s = this.states.get(tenantId);
        if (s) {
          const idx = s.qrWaiters.indexOf(resolve);
          if (idx !== -1) s.qrWaiters.splice(idx, 1);
        }
        resolve(null);
      }, timeoutMs);

      state.qrWaiters.push((qr) => {
        clearTimeout(timer);
        resolve(qr);
      });
    });
  }

  private normalizePhone(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length > 9) digits = digits.slice(1);
    return `${digits}@c.us`;
  }

  private async assertTenantExists(tenantId: string): Promise<void> {
    const exists = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Tenant introuvable');
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack || error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
