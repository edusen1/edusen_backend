import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'path';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { PrismaService } from '@/config/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { RedisRemoteAuthTenantStore } from './redis-remote-auth-tenant.store';

// Lazy-loaded au premier appel pour ne pas crasher si Chromium absent au démarrage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WWebClient: any, WWebRemoteAuth: any, QRCodeLib: any, PuppeteerLib: any;

function loadWWebDeps(): void {
  if (WWebClient) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const wweb = require('whatsapp-web.js');
  WWebClient = wweb.Client;
  WWebRemoteAuth = wweb.RemoteAuth;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  QRCodeLib = require('qrcode');
}

function loadPuppeteerDep(): any {
  if (PuppeteerLib) return PuppeteerLib;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PuppeteerLib = require('puppeteer');
  return PuppeteerLib;
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

export interface WhatsappOtpIssueResponse {
  issued: boolean;
  expiresInSeconds: number;
}

interface WhatsappPersistedStatus {
  connected: boolean;
  hasSession: boolean;
  lastError: string | null;
  reconnectAttempts: number;
  phoneNumber: string | null;
  displayName: string | null;
  connectedAt: string | null;
  updatedAt: string;
}

interface WhatsappQueueRecord {
  id: string;
  tenantId: string;
  phone: string;
  message: string;
  status: 'QUEUED' | 'PROCESSING' | 'RETRY' | 'SENT' | 'FAILED';
  attempts: number;
  createdAt: string;
  queuedAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  updatedAt: string;
}

interface WhatsappOtpRecord {
  tenantId: string;
  scope: string;
  reference: string;
  phone: string;
  codeHash: string;
  attempts: number;
  createdAt: string;
  expiresAt: string;
  verifiedAt: string | null;
}

interface LegacySessionRecord {
  tenantId: string;
  sessionData: Buffer | null;
  connected: boolean;
  phoneNumber: string | null;
  displayName: string | null;
  connectedAt: Date | null;
  featureOtp: boolean;
  featurePayment: boolean;
  featureAbsence: boolean;
  featureBulletin: boolean;
}

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

const QR_TTL_SECONDS = 120;
const QR_TTL_MS = QR_TTL_SECONDS * 1000;
const QR_MAX_RETRIES_REACHED = 'Max qrcode retries reached';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 10_000;
const STARTUP_STAGGER_MS = 3_000;

const MAX_OUTBOX_ATTEMPTS = Number(process.env.WHATSAPP_OUTBOX_MAX_ATTEMPTS ?? 10);
const OUTBOX_FLUSH_INTERVAL_MS = Number(process.env.WHATSAPP_OUTBOX_FLUSH_INTERVAL_MS ?? 15_000);
const OUTBOX_FLUSH_DEBOUNCE_MS = Number(process.env.WHATSAPP_OUTBOX_FLUSH_DEBOUNCE_MS ?? 50);
const OUTBOX_BATCH_SIZE = Number(process.env.WHATSAPP_OUTBOX_BATCH_SIZE ?? 100);
const RETRY_PROMOTION_INTERVAL_MS = Number(process.env.WHATSAPP_RETRY_PROMOTION_INTERVAL_MS ?? 2_000);
const LOCK_TTL_SECONDS = Number(process.env.WHATSAPP_FLUSH_LOCK_TTL_SECONDS ?? 30);
const MESSAGE_HISTORY_TTL_SECONDS = Number(process.env.WHATSAPP_MESSAGE_HISTORY_TTL_SECONDS ?? 7 * 24 * 60 * 60);
const OTP_TTL_SECONDS = Number(process.env.WHATSAPP_OTP_TTL_SECONDS ?? 300);
const OTP_MAX_ATTEMPTS = Number(process.env.WHATSAPP_OTP_MAX_ATTEMPTS ?? 5);
const RETRY_BATCH_SIZE = Number(process.env.WHATSAPP_RETRY_BATCH_SIZE ?? 100);

const WA_SESSION_INDEX_KEY = 'wa:sessions';
const WA_STATUS_PREFIX = 'wa:status:';
const WA_FEATURE_PREFIX = 'wa:features:';
const WA_QUEUE_PREFIX = 'wa:queue:';
const WA_PROCESSING_PREFIX = 'wa:processing:';
const WA_RETRY_PREFIX = 'wa:retry:';
const WA_MESSAGE_PREFIX = 'wa:message:';
const WA_MESSAGE_INDEX_PREFIX = 'wa:messages:';
const WA_FLUSH_LOCK_PREFIX = 'wa:lock:flush:';
const WA_OTP_PREFIX = 'wa:otp:';

@Injectable()
export class WhatsappService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly states = new Map<string, TenantWaState>();
  private readonly flushingTenants = new Set<string>();
  private readonly scheduledFlushes = new Map<string, NodeJS.Timeout>();
  private outboxFlushTimer: NodeJS.Timeout | null = null;
  private retryPromotionTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.startTimers();
    await this.migrateLegacyStateToRedis();

    const autostart = this.config.get<string>('WHATSAPP_AUTOSTART', 'true') !== 'false';
    if (!autostart) return;

    const sessions = await this.redis.smembers(WA_SESSION_INDEX_KEY);
    if (!sessions.length) {
      this.logger.log('Aucune session WhatsApp Redis à restaurer au démarrage');
      return;
    }

    this.logger.log(`Restauration de ${sessions.length} session(s) WhatsApp Redis au démarrage (échelonnement ${STARTUP_STAGGER_MS}ms)`);
    for (let index = 0; index < sessions.length; index++) {
      const tenantId = sessions[index];
      if (index === 0) {
        this.startClientIfNeeded(tenantId);
      } else {
        setTimeout(() => this.startClientIfNeeded(tenantId), index * STARTUP_STAGGER_MS);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.outboxFlushTimer) {
      clearInterval(this.outboxFlushTimer);
      this.outboxFlushTimer = null;
    }
    if (this.retryPromotionTimer) {
      clearInterval(this.retryPromotionTimer);
      this.retryPromotionTimer = null;
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

  async getStatus(tenantId: string): Promise<WhatsappStatusResponse> {
    await this.assertTenantExists(tenantId);
    await this.ensureRedisTenantState(tenantId);

    const state = this.states.get(tenantId);
    const persisted = await this.redis.getJson<WhatsappPersistedStatus>(this.getStatusKey(tenantId));
    const hasSession = state?.ready || state?.initializing
      ? true
      : await this.redis.exists(this.getSessionKey(tenantId));
    const features = await this.getFeatures(tenantId);

    return {
      connected: state?.ready ?? persisted?.connected ?? false,
      initializing: state?.initializing ?? false,
      hasSession,
      lastError: state?.lastError ?? persisted?.lastError ?? undefined,
      reconnectAttempts: state?.reconnectAttempts ?? persisted?.reconnectAttempts ?? 0,
      phoneNumber: state?.phoneNumber ?? persisted?.phoneNumber ?? undefined,
      displayName: state?.displayName ?? persisted?.displayName ?? undefined,
      connectedAt: state?.connectedAt?.toISOString() ?? persisted?.connectedAt ?? undefined,
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
    this.startClientIfNeeded(tenantId, true);

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
          try {
            await state.client.destroy();
          } catch {
            // ignore
          }
        }
      }
      this.states.delete(tenantId);
    }

    await this.redis.del(this.getSessionKey(tenantId));
    await this.redis.srem(WA_SESSION_INDEX_KEY, tenantId);
    await this.persistStatus(tenantId, {
      connected: false,
      hasSession: false,
      lastError: null,
      reconnectAttempts: 0,
      phoneNumber: null,
      displayName: null,
      connectedAt: null,
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(`WhatsApp déconnecté (tenant=${tenantId})`);
  }

  async getFeatures(tenantId: string): Promise<WhatsappFeaturesResponse> {
    await this.assertTenantExists(tenantId);
    await this.ensureRedisTenantState(tenantId);
    const features = await this.redis.getJson<WhatsappFeaturesResponse>(this.getFeaturesKey(tenantId));
    return features ?? { otp: false, payment: false, absence: false, bulletin: false };
  }

  async updateFeatures(tenantId: string, features: WhatsappFeaturesResponse): Promise<WhatsappFeaturesResponse> {
    await this.assertTenantExists(tenantId);
    await this.redis.setJson(this.getFeaturesKey(tenantId), features);
    return features;
  }

  async sendMessage(tenantId: string, phone: string, message: string): Promise<WhatsappQueueResponse> {
    await this.assertTenantExists(tenantId);

    const normalizedPhone = this.normalizePhone(phone);
    const content = String(message ?? '').trim();
    if (!content) {
      throw new BadRequestException('Message WhatsApp vide');
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const record: WhatsappQueueRecord = {
      id,
      tenantId,
      phone: normalizedPhone,
      message: content,
      status: 'QUEUED',
      attempts: 0,
      createdAt: now,
      queuedAt: now,
      lastAttemptAt: null,
      nextAttemptAt: null,
      lastError: null,
      sentAt: null,
      updatedAt: now,
    };

    await this.saveMessageRecord(record);
    await this.redis.rpush(this.getQueueKey(tenantId), id);

    if (await this.hasPersistedSession(tenantId)) {
      this.startClientIfNeeded(tenantId);
    }

    this.scheduleOutboxFlush(tenantId, true);
    this.logger.log(`Message WhatsApp mis en file Redis → ${normalizedPhone} (tenant=${tenantId}, message=${id})`);
    return { queued: true, messageId: id };
  }

  async getOutbox(tenantId: string): Promise<Array<{
    id: string;
    phone: string;
    message: string;
    attempts: number;
    lastError: string | null;
    createdAt: Date;
    status: string;
    sentAt: Date | null;
    nextAttemptAt: Date | null;
  }>> {
    await this.assertTenantExists(tenantId);

    const ids = await this.redis.smembers(this.getMessageIndexKey(tenantId));
    const records: WhatsappQueueRecord[] = [];

    for (const id of ids) {
      const record = await this.getMessageRecord(tenantId, id);
      if (!record) {
        await this.redis.srem(this.getMessageIndexKey(tenantId), id);
        continue;
      }
      records.push(record);
    }

    records.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    return records.map((record) => ({
      id: record.id,
      phone: record.phone,
      message: record.message,
      attempts: record.attempts,
      lastError: record.lastError,
      createdAt: new Date(record.createdAt),
      status: record.status,
      sentAt: record.sentAt ? new Date(record.sentAt) : null,
      nextAttemptAt: record.nextAttemptAt ? new Date(record.nextAttemptAt) : null,
    }));
  }

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

  async issueOtp(
    tenantId: string,
    scope: string,
    reference: string,
    phone: string,
    ttlSeconds = OTP_TTL_SECONDS,
  ): Promise<WhatsappOtpIssueResponse> {
    await this.assertTenantExists(tenantId);
    const normalizedPhone = this.normalizePhone(phone);
    const code = `${randomInt(0, 1_000_000)}`.padStart(6, '0');
    const now = new Date();
    const otp: WhatsappOtpRecord = {
      tenantId,
      scope,
      reference,
      phone: normalizedPhone,
      codeHash: this.hashOtpCode(code),
      attempts: 0,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      verifiedAt: null,
    };

    await this.redis.setJson(this.getOtpKey(scope, reference), otp, ttlSeconds);
    await this.sendMessage(
      tenantId,
      normalizedPhone,
      [
        'NouraSchool - Code de verification',
        `Code OTP: ${code}`,
        `Valable ${Math.max(1, Math.floor(ttlSeconds / 60))} minute(s).`,
      ].join('\n'),
    );

    return { issued: true, expiresInSeconds: ttlSeconds };
  }

  async verifyOtp(tenantId: string, scope: string, reference: string, code: string): Promise<boolean> {
    const otpKey = this.getOtpKey(scope, reference);
    const record = await this.redis.getJson<WhatsappOtpRecord>(otpKey);
    if (!record || record.tenantId !== tenantId) return false;

    if (record.verifiedAt) return true;
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      await this.redis.del(otpKey);
      return false;
    }

    record.attempts += 1;
    if (record.attempts > OTP_MAX_ATTEMPTS) {
      await this.redis.del(otpKey);
      return false;
    }

    if (record.codeHash !== this.hashOtpCode(code)) {
      const ttl = await this.redis.ttl(otpKey);
      await this.redis.setJson(otpKey, record, ttl > 0 ? ttl : OTP_TTL_SECONDS);
      return false;
    }

    record.verifiedAt = new Date().toISOString();
    const ttl = await this.redis.ttl(otpKey);
    await this.redis.setJson(otpKey, record, ttl > 0 ? ttl : OTP_TTL_SECONDS);
    return true;
  }

  isReady(tenantId: string): boolean {
    return this.states.get(tenantId)?.ready ?? false;
  }

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

    const executablePath = this.resolveBrowserExecutablePath();

    const dataPath = this.getTenantDataPath(tenantId);
    mkdirSync(dataPath, { recursive: true });

    loadWWebDeps();
    const store = new RedisRemoteAuthTenantStore(this.redis, tenantId, dataPath);
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

    this.logger.log(
      `Initialisation navigateur WhatsApp (tenant=${tenantId}) via ${
        executablePath ? executablePath : 'résolution Puppeteer par défaut'
      }`,
    );

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
      const waiters = state.qrWaiters.splice(0);
      for (const resolve of waiters) resolve(qr);
      void this.persistStatus(tenantId, {
        connected: false,
        hasSession: true,
        lastError: null,
        reconnectAttempts: state.reconnectAttempts,
        phoneNumber: state.phoneNumber,
        displayName: state.displayName,
        connectedAt: state.connectedAt?.toISOString() ?? null,
        updatedAt: new Date().toISOString(),
      });
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

      this.scheduleOutboxFlush(tenantId, true);

      void Promise.resolve(client.info ?? client.getInfo?.()).then((info: {
        wid?: { user?: string; _serialized?: string };
        me?: { user?: string; _serialized?: string };
        pushname?: string;
        displayName?: string;
      }) => {
        state.phoneNumber =
          info?.wid?.user ??
          info?.me?.user ??
          info?.wid?._serialized?.split('@')[0] ??
          info?.me?._serialized?.split('@')[0] ??
          null;
        state.displayName = info?.pushname ?? info?.displayName ?? null;
        state.connectedAt = new Date();
        this.logger.log(`Infos WhatsApp tenant=${tenantId} phone=${state.phoneNumber ?? 'n/a'} name=${state.displayName ?? 'n/a'}`);
        return this.persistStatus(tenantId, {
          connected: true,
          hasSession: true,
          lastError: null,
          reconnectAttempts: 0,
          phoneNumber: state.phoneNumber,
          displayName: state.displayName,
          connectedAt: state.connectedAt.toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }).catch((err: unknown) => {
        state.connectedAt = new Date();
        this.logger.warn(`Infos WhatsApp indisponibles (tenant=${tenantId}): ${this.formatError(err)}`);
        return this.persistStatus(tenantId, {
          connected: true,
          hasSession: true,
          lastError: null,
          reconnectAttempts: 0,
          phoneNumber: null,
          displayName: null,
          connectedAt: state.connectedAt.toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }).catch(() => null);
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
      this.logger.log(`Session sauvegardée dans Redis (tenant=${tenantId})`);
    });

    client.on('auth_failure', (msg: string) => {
      state.ready = false;
      state.latestQr = null;
      state.qrGeneratedAt = null;
      state.qrRequestExpiresAt = null;
      state.lastError = msg || 'Échec authentification WhatsApp';
      this.logger.error(`Auth failure (tenant=${tenantId}): ${state.lastError}`);
      void this.redis.del(this.getSessionKey(tenantId)).catch(() => null);
      void this.redis.srem(WA_SESSION_INDEX_KEY, tenantId).catch(() => null);
      void this.persistStatus(tenantId, {
        connected: false,
        hasSession: false,
        lastError: state.lastError,
        reconnectAttempts: state.reconnectAttempts,
        phoneNumber: null,
        displayName: null,
        connectedAt: null,
        updatedAt: new Date().toISOString(),
      });
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
      void this.persistStatus(tenantId, {
        connected: false,
        hasSession: !isQrRetryLimit,
        lastError: state.lastError,
        reconnectAttempts: state.reconnectAttempts,
        phoneNumber: null,
        displayName: null,
        connectedAt: null,
        updatedAt: new Date().toISOString(),
      });
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
      void this.persistStatus(tenantId, {
        connected: false,
        hasSession: false,
        lastError: message,
        reconnectAttempts: state.reconnectAttempts,
        phoneNumber: null,
        displayName: null,
        connectedAt: null,
        updatedAt: new Date().toISOString(),
      });
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
    const delay = RECONNECT_DELAY_MS * state.reconnectAttempts;
    this.logger.log(`Tentative de reconnexion ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} dans ${delay / 1000}s (tenant=${tenantId})`);
    void this.persistStatus(tenantId, {
      connected: false,
      hasSession: true,
      lastError: state.lastError,
      reconnectAttempts: state.reconnectAttempts,
      phoneNumber: state.phoneNumber,
      displayName: state.displayName,
      connectedAt: state.connectedAt?.toISOString() ?? null,
      updatedAt: new Date().toISOString(),
    });

    state.reconnectTimer = setTimeout(() => {
      const currentState = this.states.get(tenantId);
      if (currentState) currentState.reconnectTimer = null;
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

    await this.redis.del(this.getSessionKey(tenantId));
    await this.redis.srem(WA_SESSION_INDEX_KEY, tenantId);
    await this.persistStatus(tenantId, {
      connected: false,
      hasSession: false,
      lastError: null,
      reconnectAttempts: 0,
      phoneNumber: null,
      displayName: null,
      connectedAt: null,
      updatedAt: new Date().toISOString(),
    });

    try {
      rmSync(this.getTenantDataPath(tenantId), { recursive: true, force: true });
    } catch {
      // ignore
    }

    this.logger.log(`Session WhatsApp Redis réinitialisée avant génération QR (tenant=${tenantId})`);
  }

  private getTenantDataPath(tenantId: string): string {
    const basePath = this.config.get<string>('WHATSAPP_AUTH_DATA_PATH', join(process.cwd(), '.wwebjs_auth'));
    return join(basePath, tenantId);
  }

  private resolveBrowserExecutablePath(): string | undefined {
    const configuredPath =
      process.env.PUPPETEER_EXECUTABLE_PATH ??
      this.config.get<string>('PUPPETEER_EXECUTABLE_PATH');
    if (configuredPath) {
      if (this.isValidBrowserExecutable(configuredPath)) {
        return configuredPath;
      }
      this.logger.warn(`PUPPETEER_EXECUTABLE_PATH ignoré car invalide ou incomplet: ${configuredPath}`);
    }

    const systemPath = this.findSystemBrowserExecutablePath();
    if (systemPath) {
      return systemPath;
    }

    const bundledPath = this.findBundledPuppeteerExecutablePath();
    if (bundledPath) {
      return bundledPath;
    }

    this.logger.warn('Aucun exécutable Chrome/Chromium valide détecté. Puppeteer utilisera sa résolution par défaut.');
    return undefined;
  }

  private findSystemBrowserExecutablePath(): string | undefined {
    const candidatesByPlatform: Record<string, string[]> = {
      darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ],
      linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge',
      ],
      win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Chromium\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ],
    };

    const candidates = candidatesByPlatform[process.platform] ?? [];
    return candidates.find((candidate) => this.isValidBrowserExecutable(candidate));
  }

  private findBundledPuppeteerExecutablePath(): string | undefined {
    try {
      const puppeteer = loadPuppeteerDep();
      const executablePath = puppeteer?.executablePath?.();
      if (typeof executablePath === 'string' && this.isValidBrowserExecutable(executablePath)) {
        return executablePath;
      }
      if (executablePath) {
        this.logger.warn(`Exécutable Puppeteer local ignoré car incomplet: ${executablePath}`);
      }
    } catch (error) {
      this.logger.warn(`Résolution exécutable Puppeteer impossible: ${this.formatError(error)}`);
    }
    return undefined;
  }

  private isValidBrowserExecutable(executablePath: string): boolean {
    if (!executablePath || !existsSync(executablePath)) {
      return false;
    }

    if (process.platform !== 'darwin') {
      return true;
    }

    const macOsDir = dirname(executablePath);
    const contentsDir = dirname(macOsDir);
    const frameworksDir = join(contentsDir, 'Frameworks');
    if (!existsSync(frameworksDir)) {
      return false;
    }

    const binaryName = basename(executablePath);
    const frameworkName = `${binaryName} Framework`;
    const directFrameworkBinary = join(
      frameworksDir,
      `${frameworkName}.framework`,
      frameworkName,
    );
    if (existsSync(directFrameworkBinary)) {
      return true;
    }

    const versionedFrameworkDir = join(frameworksDir, `${frameworkName}.framework`, 'Versions');
    if (!existsSync(versionedFrameworkDir)) {
      return true;
    }

    try {
      const versions = readdirSync(versionedFrameworkDir).filter((entry) => entry !== 'Current');
      return versions.some((version) =>
        existsSync(join(versionedFrameworkDir, version, frameworkName)),
      );
    } catch {
      return false;
    }
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
        const currentState = this.states.get(tenantId);
        if (currentState) {
          const idx = currentState.qrWaiters.indexOf(resolve);
          if (idx !== -1) currentState.qrWaiters.splice(idx, 1);
        }
        resolve(null);
      }, timeoutMs);

      state.qrWaiters.push((qr) => {
        clearTimeout(timer);
        resolve(qr);
      });
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

  private scheduleOutboxFlush(tenantId: string, immediate = false): void {
    const state = this.states.get(tenantId);
    if (!state?.ready || !state.client) return;
    if (this.scheduledFlushes.has(tenantId)) return;

    const delay = immediate ? 0 : OUTBOX_FLUSH_DEBOUNCE_MS;
    const timer = setTimeout(() => {
      this.scheduledFlushes.delete(tenantId);
      void this.flushOutbox(tenantId);
    }, delay);
    this.scheduledFlushes.set(tenantId, timer);
  }

  private async flushOutbox(tenantId: string): Promise<void> {
    if (this.flushingTenants.has(tenantId)) return;

    const state = this.states.get(tenantId);
    if (!state?.ready || !state.client) return;

    const lockKey = this.getFlushLockKey(tenantId);
    const lockValue = `${process.pid}-${Date.now()}`;
    const acquired = await this.redis.setIfAbsent(lockKey, lockValue, LOCK_TTL_SECONDS);
    if (!acquired) return;

    this.flushingTenants.add(tenantId);
    try {
      await this.flushPendingQueue(tenantId, state);
    } finally {
      this.flushingTenants.delete(tenantId);
      await this.redis.del(lockKey);
    }

    this.scheduleOutboxFlush(tenantId);
  }

  private async flushPendingQueue(tenantId: string, state: TenantWaState): Promise<void> {
    const pendingKey = this.getQueueKey(tenantId);
    const processingKey = this.getProcessingKey(tenantId);
    let processed = 0;

    while (processed < OUTBOX_BATCH_SIZE && state.ready && state.client) {
      const messageId = await this.redis.rpoplpush(pendingKey, processingKey);
      if (!messageId) break;

      const sent = await this.sendAndAckMessage(tenantId, state, messageId);
      if (!sent) break;
      processed++;
    }
  }

  private async sendAndAckMessage(
    tenantId: string,
    state: TenantWaState,
    messageId: string,
  ): Promise<boolean> {
    const processingKey = this.getProcessingKey(tenantId);
    const retryKey = this.getRetryKey(tenantId);
    const record = await this.getMessageRecord(tenantId, messageId);
    if (!record) {
      await this.redis.lrem(processingKey, 0, messageId);
      return true;
    }

    const attemptAt = new Date().toISOString();
    try {
      record.status = 'PROCESSING';
      record.lastAttemptAt = attemptAt;
      record.updatedAt = attemptAt;
      await this.saveMessageRecord(record);

      await state.client.sendMessage(record.phone, record.message);

      record.status = 'SENT';
      record.lastError = null;
      record.sentAt = new Date().toISOString();
      record.nextAttemptAt = null;
      record.updatedAt = record.sentAt;
      await this.saveMessageRecord(record, MESSAGE_HISTORY_TTL_SECONDS);
      await this.redis.lrem(processingKey, 0, messageId);
      this.logger.log(`Message WhatsApp envoyé → ${record.phone} (tenant=${tenantId}, message=${messageId})`);
      return true;
    } catch (err) {
      const error = this.formatError(err);
      record.attempts += 1;
      record.lastError = error;
      record.lastAttemptAt = attemptAt;
      record.updatedAt = new Date().toISOString();
      await this.redis.lrem(processingKey, 0, messageId);

      if (record.attempts >= MAX_OUTBOX_ATTEMPTS) {
        record.status = 'FAILED';
        record.nextAttemptAt = null;
        await this.saveMessageRecord(record, MESSAGE_HISTORY_TTL_SECONDS);
        this.logger.warn(`Message WhatsApp abandonné après ${record.attempts} tentative(s) (tenant=${tenantId}, message=${messageId}): ${error}`);
        return false;
      }

      const retryAtEpochMs = Date.now() + this.computeRetryDelayMs(record.attempts);
      record.status = 'RETRY';
      record.nextAttemptAt = new Date(retryAtEpochMs).toISOString();
      await this.saveMessageRecord(record);
      await this.redis.zadd(retryKey, retryAtEpochMs, messageId);
      this.logger.warn(`Échec envoi WhatsApp — replanifié (tenant=${tenantId}, message=${messageId}): ${error}`);
      return false;
    }
  }

  private async promoteRetryQueues(): Promise<void> {
    const keys = await this.redis.scanKeys(`${WA_RETRY_PREFIX}*`);
    if (!keys.length) return;

    const now = Date.now();
    for (const retryKey of keys) {
      const tenantId = retryKey.replace(WA_RETRY_PREFIX, '');
      const dueIds = await this.redis.zrangebyscore(retryKey, 0, now, { offset: 0, count: RETRY_BATCH_SIZE });
      if (!dueIds.length) continue;

      for (const messageId of dueIds) {
        const removed = await this.redis.zrem(retryKey, messageId);
        if (!removed) continue;

        const record = await this.getMessageRecord(tenantId, messageId);
        if (!record || record.status === 'SENT' || record.status === 'FAILED') {
          continue;
        }

        record.status = 'QUEUED';
        record.nextAttemptAt = null;
        record.updatedAt = new Date().toISOString();
        await this.saveMessageRecord(record);
        await this.redis.rpush(this.getQueueKey(tenantId), messageId);
      }

      this.scheduleOutboxFlush(tenantId, true);
    }
  }

  private startTimers(): void {
    if (!this.outboxFlushTimer) {
      this.outboxFlushTimer = setInterval(() => {
        void this.flushAllOutboxes();
      }, OUTBOX_FLUSH_INTERVAL_MS);
    }

    if (!this.retryPromotionTimer) {
      this.retryPromotionTimer = setInterval(() => {
        void this.promoteRetryQueues();
      }, RETRY_PROMOTION_INTERVAL_MS);
    }
  }

  private async migrateLegacyStateToRedis(): Promise<void> {
    await this.migrateLegacySessionsToRedis();
    await this.migrateLegacyOutboxToRedis();
  }

  private async migrateLegacySessionsToRedis(): Promise<void> {
    const sessions = await this.prisma.whatsappSession.findMany({
      where: {
        OR: [
          { sessionData: { not: null } },
          { connected: true },
          { phoneNumber: { not: null } },
          { displayName: { not: null } },
          { featureOtp: true },
          { featurePayment: true },
          { featureAbsence: true },
          { featureBulletin: true },
        ],
      },
    });

    if (!sessions.length) return;

    for (const session of sessions as LegacySessionRecord[]) {
      if (session.sessionData && !await this.redis.exists(this.getSessionKey(session.tenantId))) {
        await this.redis.set(this.getSessionKey(session.tenantId), Buffer.from(session.sessionData).toString('base64'));
        await this.redis.sadd(WA_SESSION_INDEX_KEY, session.tenantId);
      }

      if (!await this.redis.exists(this.getFeaturesKey(session.tenantId))) {
        await this.redis.setJson(this.getFeaturesKey(session.tenantId), {
          otp: session.featureOtp,
          payment: session.featurePayment,
          absence: session.featureAbsence,
          bulletin: session.featureBulletin,
        });
      }

      if (!await this.redis.exists(this.getStatusKey(session.tenantId))) {
        await this.persistStatus(session.tenantId, {
          connected: session.connected,
          hasSession: !!session.sessionData,
          lastError: null,
          reconnectAttempts: 0,
          phoneNumber: session.phoneNumber,
          displayName: session.displayName,
          connectedAt: session.connectedAt?.toISOString() ?? null,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  private async migrateLegacyOutboxToRedis(): Promise<void> {
    const pending = await this.prisma.whatsappOutbox.findMany({
      orderBy: { createdAt: 'asc' },
    });
    if (!pending.length) return;

    const migratedIds: string[] = [];
    for (const entry of pending) {
      const record = await this.getMessageRecord(entry.tenantId, entry.id);
      if (!record) {
        const status: WhatsappQueueRecord['status'] = entry.attempts >= MAX_OUTBOX_ATTEMPTS
          ? 'FAILED'
          : entry.attempts > 0
            ? 'RETRY'
            : 'QUEUED';
        const normalizedPhone = this.tryNormalizePhone(entry.phone);
        const invalidPhone = !normalizedPhone;
        const queueRecord: WhatsappQueueRecord = {
          id: entry.id,
          tenantId: entry.tenantId,
          phone: normalizedPhone ?? String(entry.phone ?? ''),
          message: entry.message,
          status: invalidPhone ? 'FAILED' : status,
          attempts: entry.attempts,
          createdAt: entry.createdAt.toISOString(),
          queuedAt: entry.createdAt.toISOString(),
          lastAttemptAt: entry.lastAttemptAt?.toISOString() ?? null,
          nextAttemptAt: !invalidPhone && entry.attempts > 0 && entry.attempts < MAX_OUTBOX_ATTEMPTS
            ? new Date(Date.now() + this.computeRetryDelayMs(entry.attempts)).toISOString()
            : null,
          lastError: invalidPhone
            ? `Numéro WhatsApp invalide dans l'outbox héritée: ${String(entry.phone ?? '')}`
            : entry.lastError ?? null,
          sentAt: null,
          updatedAt: new Date().toISOString(),
        };

        await this.saveMessageRecord(queueRecord);
        if (invalidPhone) {
          this.logger.warn(`Migration WhatsApp: message ${entry.id} marqué en échec à cause d'un numéro invalide (${String(entry.phone ?? '')})`);
        } else if (status === 'QUEUED') {
          await this.redis.rpush(this.getQueueKey(entry.tenantId), entry.id);
        } else if (status === 'RETRY' && queueRecord.nextAttemptAt) {
          await this.redis.zadd(this.getRetryKey(entry.tenantId), new Date(queueRecord.nextAttemptAt).getTime(), entry.id);
        }
      }
      migratedIds.push(entry.id);
    }

    if (migratedIds.length) {
      await this.prisma.whatsappOutbox.deleteMany({ where: { id: { in: migratedIds } } }).catch(() => null);
      this.logger.log(`Migration WhatsApp vers Redis: ${migratedIds.length} message(s) d'outbox transféré(s)`);
    }
  }

  private async ensureRedisTenantState(tenantId: string): Promise<void> {
    const [hasFeatures, hasStatus] = await Promise.all([
      this.redis.exists(this.getFeaturesKey(tenantId)),
      this.redis.exists(this.getStatusKey(tenantId)),
    ]);
    if (hasFeatures && hasStatus) return;

    const legacy = await this.prisma.whatsappSession.findUnique({ where: { tenantId } });
    if (!legacy) return;

    if (!hasFeatures) {
      await this.redis.setJson(this.getFeaturesKey(tenantId), {
        otp: legacy.featureOtp,
        payment: legacy.featurePayment,
        absence: legacy.featureAbsence,
        bulletin: legacy.featureBulletin,
      });
    }

    if (!hasStatus) {
      await this.persistStatus(tenantId, {
        connected: legacy.connected,
        hasSession: !!legacy.sessionData,
        lastError: null,
        reconnectAttempts: 0,
        phoneNumber: legacy.phoneNumber,
        displayName: legacy.displayName,
        connectedAt: legacy.connectedAt?.toISOString() ?? null,
        updatedAt: new Date().toISOString(),
      });
    }

    if (legacy.sessionData && !await this.redis.exists(this.getSessionKey(tenantId))) {
      await this.redis.set(this.getSessionKey(tenantId), Buffer.from(legacy.sessionData).toString('base64'));
      await this.redis.sadd(WA_SESSION_INDEX_KEY, tenantId);
    }
  }

  private async hasPersistedSession(tenantId: string): Promise<boolean> {
    return this.redis.exists(this.getSessionKey(tenantId));
  }

  private async persistStatus(tenantId: string, status: WhatsappPersistedStatus): Promise<void> {
    await this.redis.setJson(this.getStatusKey(tenantId), status);
  }

  private async saveMessageRecord(record: WhatsappQueueRecord, ttlSeconds?: number): Promise<void> {
    await this.redis.setJson(this.getMessageKey(record.tenantId, record.id), record, ttlSeconds);
    await this.redis.sadd(this.getMessageIndexKey(record.tenantId), record.id);
  }

  private async getMessageRecord(tenantId: string, messageId: string): Promise<WhatsappQueueRecord | null> {
    return this.redis.getJson<WhatsappQueueRecord>(this.getMessageKey(tenantId, messageId));
  }

  private getStatusKey(tenantId: string): string {
    return `${WA_STATUS_PREFIX}${tenantId}`;
  }

  private getFeaturesKey(tenantId: string): string {
    return `${WA_FEATURE_PREFIX}${tenantId}`;
  }

  private getSessionKey(tenantId: string): string {
    return `wa:session:data:${tenantId}`;
  }

  private getQueueKey(tenantId: string): string {
    return `${WA_QUEUE_PREFIX}${tenantId}`;
  }

  private getProcessingKey(tenantId: string): string {
    return `${WA_PROCESSING_PREFIX}${tenantId}`;
  }

  private getRetryKey(tenantId: string): string {
    return `${WA_RETRY_PREFIX}${tenantId}`;
  }

  private getMessageKey(tenantId: string, messageId: string): string {
    return `${WA_MESSAGE_PREFIX}${tenantId}:${messageId}`;
  }

  private getMessageIndexKey(tenantId: string): string {
    return `${WA_MESSAGE_INDEX_PREFIX}${tenantId}`;
  }

  private getFlushLockKey(tenantId: string): string {
    return `${WA_FLUSH_LOCK_PREFIX}${tenantId}`;
  }

  private getOtpKey(scope: string, reference: string): string {
    return `${WA_OTP_PREFIX}${scope}:${reference}`;
  }

  private computeRetryDelayMs(attempts: number): number {
    const baseMs = 1_000;
    const boundedAttempts = Math.min(attempts, 6);
    return baseMs * 2 ** boundedAttempts;
  }

  private hashOtpCode(code: string): string {
    return createHash('sha256').update(String(code).trim()).digest('hex');
  }

  private normalizePhone(phone: string): string {
    let digits = String(phone ?? '').replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length > 9) digits = digits.slice(1);
    if (digits.length === 9 && digits.startsWith('7')) {
      const countryCode = this.config.get<string>('WHATSAPP_DEFAULT_COUNTRY_CODE', '221');
      digits = `${countryCode}${digits}`;
    }
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length < 11) {
      throw new BadRequestException('Numéro WhatsApp invalide');
    }
    return `${digits}@c.us`;
  }

  private tryNormalizePhone(phone: string): string | null {
    try {
      return this.normalizePhone(phone);
    } catch {
      return null;
    }
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
