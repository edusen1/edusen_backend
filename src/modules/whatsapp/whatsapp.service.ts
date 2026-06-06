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
import { RedisService } from '@/infrastructure/redis/redis.service';
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

export interface WhatsappQueueResponse {
  queued: boolean;
  messageId: string | null;
}

interface RedisQueueEntry {
  outboxId: string;
  phone: string;
  message: string;
  queuedAt: string;
}

const QR_TTL_SECONDS = 120;
const QR_TTL_MS = QR_TTL_SECONDS * 1000;
const QR_MAX_RETRIES_REACHED = 'Max qrcode retries reached';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 10_000;
const STARTUP_STAGGER_MS = 3_000; // délai entre chaque tenant au démarrage
const MAX_OUTBOX_ATTEMPTS = 10;   // abandon après N tentatives d'envoi
const OUTBOX_FLUSH_INTERVAL_MS = 60 * 1000; // flush périodique pour rattraper les messages
const REDIS_QUEUE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // purge toutes les 10 minutes
const OUTBOX_FLUSH_DEBOUNCE_MS = Number(process.env.WHATSAPP_OUTBOX_FLUSH_DEBOUNCE_MS ?? 100);
const OUTBOX_BATCH_SIZE = Number(process.env.WHATSAPP_OUTBOX_BATCH_SIZE ?? 100);
const OUTBOX_CONCURRENCY = Math.max(1, Number(process.env.WHATSAPP_OUTBOX_CONCURRENCY ?? 5));
const REDIS_QUEUE_KEY_PREFIX = 'whatsapp:queue:';

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
  qrRequestExpiresAt: number | null;
}

@Injectable()
export class WhatsappService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly states = new Map<string, TenantWaState>();
  private readonly flushingTenants = new Set<string>();
  private readonly scheduledFlushes = new Map<string, NodeJS.Timeout>();
  private outboxFlushTimer: NodeJS.Timeout | null = null;
  private queueCleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.startTimers();

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

  }

  async onApplicationShutdown(): Promise<void> {
    if (this.outboxFlushTimer) {
      clearInterval(this.outboxFlushTimer);
      this.outboxFlushTimer = null;
    }
    if (this.queueCleanupTimer) {
      clearInterval(this.queueCleanupTimer);
      this.queueCleanupTimer = null;
    }
    for (const timer of this.scheduledFlushes.values()) {
      clearTimeout(timer);
    }
    this.scheduledFlushes.clear();
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

    if (state.latestQr && state.qrGeneratedAt && Date.now() - state.qrGeneratedAt < QR_TTL_MS) {
      loadWWebDeps();
      const ageMs = Date.now() - state.qrGeneratedAt;
      const dataUrl: string = await QRCodeLib.toDataURL(state.latestQr, { width: 300, margin: 1 });
      return { qrCode: dataUrl, expiresInSeconds: Math.max(1, Math.ceil((QR_TTL_MS - ageMs) / 1000)) };
    }

    await this.resetTenantSessionForQr(tenantId);
    const qrState = this.getOrCreateState(tenantId);
    qrState.qrRequestExpiresAt = Date.now() + QR_TTL_MS;
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

  async sendMessage(tenantId: string, phone: string, message: string): Promise<WhatsappQueueResponse> {
    const normalizedPhone = this.normalizePhone(phone);

    // 1. Persister en outbox d'abord — message garanti même si WhatsApp est down
    let entry: { id: string } | null = null;
    try {
      entry = await this.outbox.create({
        data: { tenantId, phone: normalizedPhone, message },
      });
    } catch (err) {
      this.logger.error(`Outbox WhatsApp indisponible, message non mis en file (tenant=${tenantId}): ${this.formatError(err)}`);
      throw new ServiceUnavailableException('File WhatsApp indisponible — réessayez dans quelques secondes');
    }

    // 2. Empiler aussi dans Redis pour accélérer le traitement.
    const queueEntry: RedisQueueEntry = {
      outboxId: entry.id,
      phone: normalizedPhone,
      message,
      queuedAt: new Date().toISOString(),
    };
    const queueKey = this.getRedisQueueKey(tenantId);
    await this.redis.rpush(queueKey, JSON.stringify(queueEntry));
    await this.redis.expire(queueKey, 60 * 60);

    // 3. Démarrer le client si une session existe, sans bloquer l'appelant.
    const record = await this.prisma.whatsappSession.findUnique({ where: { tenantId } });
    if (record?.sessionData || record?.connected) {
      this.startClientIfNeeded(tenantId);
    }

    // 4. Si WhatsApp est prêt, déclencher un flush asynchrone immédiat.
    this.scheduleOutboxFlush(tenantId);

    this.logger.log(`Message WhatsApp mis en file → ${normalizedPhone} (tenant=${tenantId}, outbox=${entry.id})`);
    return { queued: true, messageId: entry.id };
  }

  async getOutbox(tenantId: string): Promise<{ id: string; phone: string; message: string; attempts: number; lastError: string | null; createdAt: Date }[]> {
    await this.assertTenantExists(tenantId);
    return this.outbox.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, phone: true, message: true, attempts: true, lastError: true, createdAt: true },
    });
  }

  /**
   * Envoie un message à tous les utilisateurs d'un tenant ayant l'un des rôles spécifiés.
   * Les erreurs individuelles sont silencieuses (log uniquement) pour ne pas bloquer l'appelant.
   */
  async broadcastToRoles(tenantId: string, message: string, roles: string[]): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { tenantId, role: { in: roles as any }, actif: true, telephone: { not: null } },
      select: { telephone: true },
    });

    const phones = [...new Set(users.map((u) => u.telephone!).filter(Boolean))];
    this.logger.log(`[WA Broadcast] tenant=${tenantId} roles=${roles.join(',')} destinataires=${phones.length}`);

    for (const phone of phones) {
      try {
        await this.sendMessage(tenantId, phone, message);
      } catch (err) {
        this.logger.warn(`[WA Broadcast] échec phone=${phone}: ${(err as Error).message}`);
      }
    }
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
        qrRequestExpiresAt: null,
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
      qrMaxRetries: 1,
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
      const now = Date.now();
      if (!state.qrRequestExpiresAt || now > state.qrRequestExpiresAt) {
        this.logger.warn(`QR ignoré hors demande manuelle (tenant=${tenantId})`);
        return;
      }
      if (state.latestQr && state.qrGeneratedAt && now - state.qrGeneratedAt < QR_TTL_MS) {
        this.logger.warn(`QR renouvelé ignoré: QR déjà affiché (tenant=${tenantId})`);
        return;
      }
      state.latestQr = qr;
      state.qrGeneratedAt = now;
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
      state.qrRequestExpiresAt = null;
      state.lastError = null;
      state.reconnectAttempts = 0;
      const waiters = state.qrWaiters.splice(0);
      for (const resolve of waiters) resolve(null);
      this.logger.log(`WhatsApp prêt (tenant=${tenantId})`);

      // Flush outbox — envoyer tous les messages en attente
      this.scheduleOutboxFlush(tenantId);

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
      state.qrRequestExpiresAt = null;
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
      state.qrRequestExpiresAt = null;
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
      const isQrRetryLimit = String(reason || '').includes(QR_MAX_RETRIES_REACHED);
      if (!isQrRetryLimit) {
        state.latestQr = null;
        state.qrGeneratedAt = null;
        state.qrRequestExpiresAt = null;
      }
      state.phoneNumber = null;
      state.displayName = null;
      state.lastError = isQrRetryLimit
        ? 'QR expiré. Cliquez sur Générer le QR code pour en créer un nouveau.'
        : reason ? `Déconnecté: ${reason}` : null;
      this.logger.warn(`Déconnecté (tenant=${tenantId}): ${reason}`);
      void this.prisma.whatsappSession.updateMany({
        where: { tenantId },
        data: { connected: false },
      }).catch(() => null);
      if (isQrRetryLimit) {
        state.initializing = false;
        return;
      }
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
    if (state.latestQr && state.qrGeneratedAt && Date.now() - state.qrGeneratedAt < QR_TTL_MS) {
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
    await Promise.all([...this.states.entries()].map(([tenantId, state]) => {
      if (state.ready && state.client) {
        return this.flushOutbox(tenantId);
      }
      return Promise.resolve();
    }));
  }

  private scheduleOutboxFlush(tenantId: string): void {
    const state = this.states.get(tenantId);
    if (!state?.ready || !state.client || this.scheduledFlushes.has(tenantId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.scheduledFlushes.delete(tenantId);
      void this.flushOutbox(tenantId);
    }, OUTBOX_FLUSH_DEBOUNCE_MS);
    this.scheduledFlushes.set(tenantId, timer);
  }

  private async flushOutbox(tenantId: string): Promise<void> {
    if (this.flushingTenants.has(tenantId)) return;

    const state = this.states.get(tenantId);
    if (!state?.ready || !state.client) return;

    this.flushingTenants.add(tenantId);
    try {
      await this.flushRedisQueue(tenantId, state);
      await this.flushDbOutbox(tenantId, state);
    } finally {
      this.flushingTenants.delete(tenantId);
    }

    this.scheduleOutboxFlush(tenantId);
  }

  private async flushRedisQueue(tenantId: string, state: TenantWaState): Promise<void> {
    const queueKey = this.getRedisQueueKey(tenantId);
    let processed = 0;

    while (processed < OUTBOX_BATCH_SIZE && state.ready && state.client) {
      const raw = await this.redis.lpop(queueKey);
      if (!raw) break;

      let entry: RedisQueueEntry | null = null;
      try {
        entry = JSON.parse(raw) as RedisQueueEntry;
      } catch {
        continue;
      }

      if (!entry?.outboxId || !entry.phone || !entry.message) {
        continue;
      }

      const sent = await this.sendAndAckOutbox(tenantId, state, entry.outboxId, entry.phone, entry.message);
      if (sent) processed++;
    }
  }

  private async flushDbOutbox(tenantId: string, state: TenantWaState): Promise<void> {
    let pending: Array<{ id: string; phone: string; message: string }>;
    try {
      pending = await this.outbox.findMany({
        where: { tenantId, attempts: { lt: MAX_OUTBOX_ATTEMPTS } },
        orderBy: { createdAt: 'asc' },
        take: OUTBOX_BATCH_SIZE,
      });
    } catch {
      return;
    }

    if (!pending.length) return;
    this.logger.log(`Flush outbox DB: ${pending.length} message(s) en attente (tenant=${tenantId})`);

    for (let index = 0; index < pending.length; index += OUTBOX_CONCURRENCY) {
      if (!state.ready || !state.client) {
        this.logger.warn(`Flush interrompu — WhatsApp déconnecté (tenant=${tenantId})`);
        break;
      }

      const chunk = pending.slice(index, index + OUTBOX_CONCURRENCY);
      await Promise.all(chunk.map((entry) => this.sendAndAckOutbox(tenantId, state, entry.id, entry.phone, entry.message)));
    }
  }

  private async sendAndAckOutbox(
    tenantId: string,
    state: TenantWaState,
    outboxId: string,
    phone: string,
    message: string,
  ): Promise<boolean> {
    const chatId = this.normalizePhone(phone);
    try {
      await state.client.sendMessage(chatId, message);
      await this.outbox.delete({ where: { id: outboxId } }).catch(() => null);
      this.logger.log(`Message envoyé + supprimé de l'outbox → ${chatId} (tenant=${tenantId})`);
      return true;
    } catch (err) {
      const error = this.formatError(err);
      await this.outbox.update({
        where: { id: outboxId },
        data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: error },
      }).catch(() => null);
      this.logger.warn(`Échec envoi outbox → ${chatId} (tenant=${tenantId}): ${error}`);
      return false;
    }
  }

  private startTimers(): void {
    if (!this.outboxFlushTimer) {
      this.outboxFlushTimer = setInterval(() => {
        void this.flushAllOutboxes();
      }, OUTBOX_FLUSH_INTERVAL_MS);
    }

    if (!this.queueCleanupTimer) {
      this.queueCleanupTimer = setInterval(() => {
        void this.cleanupRedisQueues();
      }, REDIS_QUEUE_CLEANUP_INTERVAL_MS);
    }
  }

  private async cleanupRedisQueues(): Promise<void> {
    const keys = await this.redis.scanKeys(`${REDIS_QUEUE_KEY_PREFIX}*`);
    if (!keys.length) return;
    await this.redis.delMany(keys);
    this.logger.log(`Nettoyage Redis WhatsApp: ${keys.length} file(s) supprimée(s)`);
  }

  private getRedisQueueKey(tenantId: string): string {
    return `${REDIS_QUEUE_KEY_PREFIX}${tenantId}`;
  }

  private normalizePhone(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length > 9) digits = digits.slice(1);
    if (digits.length === 9 && digits.startsWith('7')) {
      const countryCode = this.config.get<string>('WHATSAPP_DEFAULT_COUNTRY_CODE', '221');
      digits = `${countryCode}${digits}`;
    }
    if (digits.startsWith('00')) digits = digits.slice(2);
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
