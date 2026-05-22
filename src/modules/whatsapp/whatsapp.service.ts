import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';
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
  reconnectAttempts?: number;
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

const QR_TTL_SECONDS = 18; // WhatsApp rotate le QR toutes les ~20s — ne pas servir un QR de plus de 18s
const QR_WHATSAPP_EXPIRY_SECONDS = 20; // Durée de vie réelle d'un QR côté WhatsApp

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 10_000;
const STARTUP_STAGGER_MS = 3_000; // délai entre chaque tenant au démarrage
const MAX_OUTBOX_ATTEMPTS = 10;   // abandon après N tentatives d'envoi

interface TenantWaState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any | null;
  ready: boolean;
  latestQr: string | null;
  qrGeneratedAt: number | null;
  initializing: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
  phoneNumber: string | null;
  displayName: string | null;
  connectedAt: Date | null;
  lastError: string | null;
  qrWaiters: Array<(qr: string | null) => void>;
}

const OUTBOX_FLUSH_INTERVAL_MS = 2 * 60 * 1000; // flush périodique toutes les 2 minutes

@Injectable()
export class WhatsappService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly states = new Map<string, TenantWaState>();
  private outboxFlushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const autostart = this.config.get<string>('WHATSAPP_AUTOSTART', 'true') !== 'false';
    if (!autostart) return;

    const sessions = await this.prisma.whatsappSession.findMany({
      where: {
        connected: true,
        sessionData: { not: null },
      },
      select: { tenantId: true },
    });

    if (!sessions.length) {
      this.logger.log('Aucune session WhatsApp à restaurer au démarrage');
      return;
    }

    this.logger.log(`Restauration de ${sessions.length} session(s) WhatsApp au démarrage (échelonnement ${STARTUP_STAGGER_MS}ms)`);
    for (let i = 0; i < sessions.length; i++) {
      const tenantId = sessions[i].tenantId;
      if (i === 0) {
        this.startClientIfNeeded(tenantId);
      } else {
        setTimeout(() => this.startClientIfNeeded(tenantId), i * STARTUP_STAGGER_MS);
      }
    }

    // Flush périodique de l'outbox — rattrape les messages si le `ready` a été manqué
    this.outboxFlushTimer = setInterval(() => {
      void this.flushAllOutboxes();
    }, OUTBOX_FLUSH_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.outboxFlushTimer) {
      clearInterval(this.outboxFlushTimer);
      this.outboxFlushTimer = null;
    }
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
      reconnectAttempts: state?.reconnectAttempts ?? 0,
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

    await this.resetTenantSessionForQr(tenantId);
    this.startClientIfNeeded(tenantId, true); // reconnexion manuelle — reset des tentatives

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
    // 1. Persister en outbox d'abord — message garanti même si WhatsApp est down
    let entry: { id: string } | null = null;
    try {
      entry = await this.outbox.create({
        data: { tenantId, phone, message },
      });
    } catch (err) {
      // Table absente (migration en attente) — envoi direct sans outbox
      this.logger.warn(`Outbox indisponible, envoi direct (tenant=${tenantId}): ${this.formatError(err)}`);
    }

    // 2. Essayer d'envoyer immédiatement si le client est prêt
    const state = this.states.get(tenantId);
    if (state?.ready && state.client) {
      if (entry) {
        await this.sendAndAckOutbox(tenantId, state, entry.id, phone, message);
      } else {
        // Pas d'entrée outbox (table absente) — envoi direct
        const chatId = this.normalizePhone(phone);
        await state.client.sendMessage(chatId, message);
        this.logger.log(`Message envoyé directement → ${chatId} (tenant=${tenantId})`);
      }
      return;
    }

    // 3. Client pas prêt — tenter de le démarrer si session existante
    const record = await this.prisma.whatsappSession.findUnique({ where: { tenantId } });
    if (record?.sessionData || record?.connected) {
      this.logger.log(`Session WhatsApp trouvée, démarrage pour envoi différé (tenant=${tenantId})`);
      this.startClientIfNeeded(tenantId);
      // Le flush sera déclenché automatiquement sur l'événement 'ready'
    }

    this.logger.log(`Message mis en file d'attente → ${phone} (tenant=${tenantId})`);
    // Ne pas lever d'exception : le message est dans l'outbox et sera renvoyé
  }

  async getOutbox(tenantId: string): Promise<{ id: string; phone: string; message: string; attempts: number; lastError: string | null; createdAt: Date }[]> {
    await this.assertTenantExists(tenantId);
    return this.outbox.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, phone: true, message: true, attempts: true, lastError: true, createdAt: true },
    });
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
        reconnectAttempts: 0,
        phoneNumber: null,
        displayName: null,
        connectedAt: null,
        lastError: null,
        qrWaiters: [],
      });
    }
    return this.states.get(tenantId)!;
  }

  private get outbox(): {
    create(args: unknown): Promise<{ id: string }>;
    findMany(args: unknown): Promise<Array<{ id: string; phone: string; message: string; attempts: number; lastError: string | null; createdAt: Date }>>;
    delete(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  } {
    return (this.prisma as unknown as { whatsappOutbox: WhatsappService['outbox'] }).whatsappOutbox;
  }

  private startClientIfNeeded(tenantId: string, resetAttempts = false): void {
    const state = this.getOrCreateState(tenantId);
    if (resetAttempts) state.reconnectAttempts = 0;
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

    const dataPath = this.getTenantDataPath(tenantId);
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
      state.reconnectAttempts = 0;
      const waiters = state.qrWaiters.splice(0);
      for (const resolve of waiters) resolve(null);
      this.logger.log(`WhatsApp prêt (tenant=${tenantId})`);

      // Flush outbox — envoyer tous les messages en attente
      void this.flushOutbox(tenantId);

      // Récupérer les infos du téléphone connecté
      void Promise.resolve(client.info ?? client.getInfo?.()).then((info: { wid?: { user?: string; _serialized?: string }; me?: { user?: string; _serialized?: string }; pushname?: string; displayName?: string }) => {
        state.phoneNumber = info?.wid?.user ?? info?.me?.user ?? info?.wid?._serialized?.split('@')[0] ?? info?.me?._serialized?.split('@')[0] ?? null;
        state.displayName = info?.pushname ?? info?.displayName ?? null;
        state.connectedAt = new Date();
        this.logger.log(`Infos WhatsApp tenant=${tenantId} phone=${state.phoneNumber ?? 'n/a'} name=${state.displayName ?? 'n/a'}`);
        // Persister en base
        void this.prisma.whatsappSession.upsert({
          where: { tenantId },
          create: { tenantId, connected: true, phoneNumber: state.phoneNumber, displayName: state.displayName, connectedAt: state.connectedAt },
          update: { connected: true, phoneNumber: state.phoneNumber, displayName: state.displayName, connectedAt: state.connectedAt },
        }).catch(() => null);
      }).catch((err: unknown) => {
        state.connectedAt = new Date();
        this.logger.warn(`Infos WhatsApp indisponibles (tenant=${tenantId}): ${this.formatError(err)}`);
        void this.prisma.whatsappSession.upsert({
          where: { tenantId },
          create: { tenantId, connected: true, connectedAt: state.connectedAt },
          update: { connected: true, connectedAt: state.connectedAt },
        }).catch(() => null);
      });
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
      this.logger.error(`❌ Erreur init WhatsApp (tenant=${tenantId}): ${message}`);
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

    if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.logger.warn(`Tenant ${tenantId} — ${MAX_RECONNECT_ATTEMPTS} tentatives échouées, reconnexion automatique arrêtée. Reconnectez manuellement via le QR code.`);
      return;
    }

    state.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * state.reconnectAttempts; // backoff linéaire
    this.logger.log(`Tentative de reconnexion ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} dans ${delay / 1000}s (tenant=${tenantId})`);

    state.reconnectTimer = setTimeout(() => {
      const s = this.states.get(tenantId);
      if (s) s.reconnectTimer = null;
      this.initClient(tenantId);
    }, delay);
  }

  private async resetTenantSessionForQr(tenantId: string): Promise<void> {
    const state = this.states.get(tenantId);
    if (state?.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state?.client) {
      try {
        await state.client.destroy();
      } catch {
        // ignore
      }
    }
    if (state) {
      const waiters = state.qrWaiters.splice(0);
      for (const resolve of waiters) resolve(null);
    }
    this.states.delete(tenantId);

    await this.prisma.whatsappSession.updateMany({
      where: { tenantId },
      data: { sessionData: null, connected: false, phoneNumber: null, displayName: null, connectedAt: null },
    });

    try {
      rmSync(this.getTenantDataPath(tenantId), { recursive: true, force: true });
    } catch {
      // ignore
    }

    this.logger.log(`Session WhatsApp réinitialisée avant génération QR (tenant=${tenantId})`);
  }

  private getTenantDataPath(tenantId: string): string {
    const basePath = this.config.get<string>('WHATSAPP_AUTH_DATA_PATH', join(process.cwd(), '.wwebjs_auth'));
    return join(basePath, tenantId);
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

  private waitForReady(tenantId: string, timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const state = this.states.get(tenantId);
        if (state?.ready) {
          clearInterval(interval);
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(interval);
          resolve(false);
        }
      }, 500);
    });
  }

  private async flushAllOutboxes(): Promise<void> {
    for (const [tenantId, state] of this.states.entries()) {
      if (state.ready && state.client) {
        await this.flushOutbox(tenantId);
      }
    }
  }

  private async flushOutbox(tenantId: string): Promise<void> {
    const state = this.states.get(tenantId);
    if (!state?.ready || !state.client) return;

    let pending: Array<{ id: string; phone: string; message: string }>;
    try {
      pending = await this.outbox.findMany({
        where: { tenantId, attempts: { lt: MAX_OUTBOX_ATTEMPTS } },
        orderBy: { createdAt: 'asc' },
      });
    } catch {
      // Table absente (migration en attente) — flush ignoré silencieusement
      return;
    }

    if (!pending.length) return;
    this.logger.log(`Flush outbox: ${pending.length} message(s) en attente (tenant=${tenantId})`);

    for (const entry of pending) {
      // Vérifier que le client est encore connecté entre chaque envoi
      if (!state.ready || !state.client) {
        this.logger.warn(`Flush interrompu — WhatsApp déconnecté (tenant=${tenantId})`);
        break;
      }
      await this.sendAndAckOutbox(tenantId, state, entry.id, entry.phone, entry.message);
    }
  }

  private async sendAndAckOutbox(
    tenantId: string,
    state: TenantWaState,
    outboxId: string,
    phone: string,
    message: string,
  ): Promise<void> {
    const chatId = this.normalizePhone(phone);
    try {
      await state.client.sendMessage(chatId, message);
      await this.outbox.delete({ where: { id: outboxId } }).catch(() => null);
      this.logger.log(`Message envoyé + supprimé de l'outbox → ${chatId} (tenant=${tenantId})`);
    } catch (err) {
      const error = this.formatError(err);
      await this.outbox.update({
        where: { id: outboxId },
        data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: error },
      }).catch(() => null);
      this.logger.warn(`Échec envoi outbox → ${chatId} (tenant=${tenantId}): ${error}`);
    }
  }

  private normalizePhone(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length > 9) digits = digits.slice(1);
    if (digits.length === 9 && digits.startsWith('7')) {
      const countryCode = this.config.get<string>('WHATSAPP_DEFAULT_COUNTRY_CODE', '221');
      digits = `${countryCode}${digits}`;
    }
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
