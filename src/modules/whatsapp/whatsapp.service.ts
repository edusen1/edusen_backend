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
import { createHash, randomInt, randomUUID, webcrypto } from 'node:crypto';
import { basename, dirname, join } from 'path';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { PrismaService } from '@/config/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { RedisRemoteAuthTenantStore } from './redis-remote-auth-tenant.store';

// Lazy-loaded au premier appel pour ne pas crasher si Chromium absent au démarrage
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WWebClient: any, WWebRemoteAuth: any, WWebMessageMedia: any, QRCodeLib: any, PuppeteerLib: any;

function loadQRCodeDep(): void {
  if (QRCodeLib) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  QRCodeLib = require('qrcode');
}

function loadWWebDeps(): void {
  if (WWebClient) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const wweb = require('whatsapp-web.js');
  WWebClient = wweb.Client;
  WWebRemoteAuth = wweb.RemoteAuth;
  WWebMessageMedia = wweb.MessageMedia;
  loadQRCodeDep();
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

export interface WhatsappPairingCodeResponse {
  sessionId?: string;
  phoneNumber: string;
  code: string;
  expiresAt?: string;
  expiresInSeconds?: number;
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

interface WhatsappStoredSessionMeta {
  encoding: 'binary' | 'base64';
  checksum: string;
  size: number;
  storage?: 'redis' | 's3';
  storageKey?: string;
  updatedAt: string;
}

interface WhatsappQueueRecord {
  id: string;
  tenantId: string;
  phone: string;
  kind: 'text' | 'document';
  message: string;
  document?: {
    filename: string;
    mimeType: string;
    dataBase64: string;
  } | null;
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

interface RelayioSessionBinding {
  sessionId: string;
  phoneNumber: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface RelayioSession {
  id: string;
  tenantId?: string;
  name?: string;
  phoneNumber?: string;
  status?: string;
  clientId?: string;
  lastReadyAt?: string | Date;
  lastDisconnectedAt?: string | Date;
  failureReason?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface RelayioStatusPayload {
  sessionId: string;
  status?: string;
  activeInWorker?: boolean;
  checkedAt?: string | Date;
}

interface RelayioQrPayload {
  sessionId: string;
  qr?: string | {
    value?: string;
    imageDataUrl?: string;
    expiresAt?: string | Date;
  } | null;
}

interface RelayioPairingCodePayload {
  sessionId?: string;
  phoneNumber?: string;
  code?: string;
  expiresAt?: string | Date;
}

interface RelayioMessagePayload {
  id?: string;
  status?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

interface RelayioMediaUploadPayload {
  id: string;
}

const QR_TTL_SECONDS = 120;
const QR_TTL_MS = QR_TTL_SECONDS * 1000;
const QR_MAX_RETRIES_REACHED = 'Max qrcode retries reached';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 10_000;
const STARTUP_STAGGER_MS = 3_000;
const WHATSAPP_BACKUP_SYNC_INTERVAL_MS = Math.max(60_000, Number(process.env.WHATSAPP_BACKUP_SYNC_INTERVAL_MS ?? 900_000));

const MAX_OUTBOX_ATTEMPTS = Number(process.env.WHATSAPP_OUTBOX_MAX_ATTEMPTS ?? 10);
const OUTBOX_FLUSH_INTERVAL_MS = Number(process.env.WHATSAPP_OUTBOX_FLUSH_INTERVAL_MS ?? 15_000);
const OUTBOX_FLUSH_DEBOUNCE_MS = Number(process.env.WHATSAPP_OUTBOX_FLUSH_DEBOUNCE_MS ?? 50);
const OUTBOX_BATCH_SIZE = Number(process.env.WHATSAPP_OUTBOX_BATCH_SIZE ?? 100);
const RETRY_PROMOTION_INTERVAL_MS = Number(process.env.WHATSAPP_RETRY_PROMOTION_INTERVAL_MS ?? 2_000);
const PROCESSING_RECOVERY_INTERVAL_MS = Number(process.env.WHATSAPP_PROCESSING_RECOVERY_INTERVAL_MS ?? 30_000);
const PROCESSING_STALE_AFTER_MS = Number(process.env.WHATSAPP_PROCESSING_STALE_AFTER_MS ?? 5 * 60_000);
const HISTORY_CLEANUP_INTERVAL_MS = Number(process.env.WHATSAPP_HISTORY_CLEANUP_INTERVAL_MS ?? 60_000);
const HISTORY_CLEANUP_BATCH_SIZE = Number(process.env.WHATSAPP_HISTORY_CLEANUP_BATCH_SIZE ?? 500);
const LOCK_TTL_SECONDS = Number(process.env.WHATSAPP_FLUSH_LOCK_TTL_SECONDS ?? 30);
const MESSAGE_HISTORY_TTL_SECONDS = Number(process.env.WHATSAPP_MESSAGE_HISTORY_TTL_SECONDS ?? 7 * 24 * 60 * 60);
const OTP_TTL_SECONDS = Number(process.env.WHATSAPP_OTP_TTL_SECONDS ?? 300);
const OTP_MAX_ATTEMPTS = Number(process.env.WHATSAPP_OTP_MAX_ATTEMPTS ?? 5);
const RETRY_BATCH_SIZE = Number(process.env.WHATSAPP_RETRY_BATCH_SIZE ?? 100);

const WA_SESSION_INDEX_KEY = 'wa:sessions';
const WA_SESSION_META_PREFIX = 'wa:session:meta:';
const WA_STATUS_PREFIX = 'wa:status:';
const WA_FEATURE_PREFIX = 'wa:features:';
const WA_QUEUE_PREFIX = 'wa:queue:';
const WA_PROCESSING_PREFIX = 'wa:processing:';
const WA_RETRY_PREFIX = 'wa:retry:';
const WA_MESSAGE_PREFIX = 'wa:message:';
const WA_MESSAGE_INDEX_PREFIX = 'wa:messages:';
const WA_HISTORY_PREFIX = 'wa:history:';
const WA_FLUSH_LOCK_PREFIX = 'wa:lock:flush:';
const WA_OTP_PREFIX = 'wa:otp:';
const WA_ACTIVE_TENANTS_KEY = 'wa:tenants:active';
const WA_RELAYIO_SESSION_PREFIX = 'wa:relayio:session:';

@Injectable()
export class WhatsappService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly states = new Map<string, TenantWaState>();
  private readonly flushingTenants = new Set<string>();
  private readonly scheduledFlushes = new Map<string, NodeJS.Timeout>();
  private outboxFlushTimer: NodeJS.Timeout | null = null;
  private retryPromotionTimer: NodeJS.Timeout | null = null;
  private processingRecoveryTimer: NodeJS.Timeout | null = null;
  private historyCleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.useRelayioProvider()) {
      this.logger.log('Provider WhatsApp Relayio actif : les sessions et envois passent par l API Relayio.');
      return;
    }

    if (!this.isClientWorkerEnabled()) {
      this.logger.log('Worker WhatsApp désactivé pour cette instance API : les messages restent en file Redis.');
      return;
    }

    this.startTimers();
    await this.migrateLegacyStateToRedis();
    // Large legacy archives are moved in the background so startup and health
    // checks remain responsive while Redis memory is progressively released.
    void this.migrateRedisSessionPayloadsToObjectStorage();

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
    if (this.processingRecoveryTimer) {
      clearInterval(this.processingRecoveryTimer);
      this.processingRecoveryTimer = null;
    }
    if (this.historyCleanupTimer) {
      clearInterval(this.historyCleanupTimer);
      this.historyCleanupTimer = null;
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
    if (this.useRelayioProvider()) {
      return this.getRelayioStatus(tenantId);
    }

    await this.assertTenantExists(tenantId);
    await this.ensureRedisTenantState(tenantId);

    const state = this.states.get(tenantId);
    const persisted = await this.redis.getJson<WhatsappPersistedStatus>(this.getStatusKey(tenantId));
    const hasSession = state?.ready || state?.initializing ? true : await this.hasPersistedSession(tenantId);
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
    if (this.useRelayioProvider()) {
      return this.getRelayioQrCode(tenantId);
    }

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

  async requestPairingCode(tenantId: string, phoneNumber?: string): Promise<WhatsappPairingCodeResponse> {
    if (!this.useRelayioProvider()) {
      throw new ServiceUnavailableException('Le pairing code est disponible avec le provider WhatsApp Relayio.');
    }
    return this.requestRelayioPairingCode(tenantId, phoneNumber);
  }

  async logout(tenantId: string): Promise<void> {
    if (this.useRelayioProvider()) {
      return this.logoutRelayio(tenantId);
    }

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

    await this.deletePersistedSession(tenantId);
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
    if (this.useRelayioProvider()) {
      return this.sendRelayioTextMessage(tenantId, phone, message);
    }

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
      kind: 'text',
      message: content,
      document: null,
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

    await this.queueMessageRecord(record);
    this.logger.log(`Message WhatsApp mis en file Redis → ${normalizedPhone} (tenant=${tenantId}, message=${id})`);
    return { queued: true, messageId: id };
  }

  async sendDocument(
    tenantId: string,
    phone: string,
    document: {
      filename: string;
      mimeType: string;
      data: Buffer;
      caption?: string;
    },
  ): Promise<WhatsappQueueResponse> {
    if (this.useRelayioProvider()) {
      return this.sendRelayioDocument(tenantId, phone, document);
    }

    await this.assertTenantExists(tenantId);

    const normalizedPhone = this.normalizePhone(phone);
    const filename = String(document?.filename ?? '').trim();
    const mimeType = String(document?.mimeType ?? '').trim();
    const data = Buffer.isBuffer(document?.data) ? document.data : Buffer.from(document?.data ?? []);
    const caption = String(document?.caption ?? '').trim();

    if (!filename || !mimeType || !data.length) {
      throw new BadRequestException('Document WhatsApp invalide');
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const record: WhatsappQueueRecord = {
      id,
      tenantId,
      phone: normalizedPhone,
      kind: 'document',
      message: caption,
      document: {
        filename,
        mimeType,
        dataBase64: data.toString('base64'),
      },
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

    await this.queueMessageRecord(record);
    this.logger.log(`Document WhatsApp mis en file Redis → ${normalizedPhone} (tenant=${tenantId}, message=${id})`);
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
    if (this.useRelayioProvider()) {
      return this.broadcastRelayioToRoles(tenantId, message, roles);
    }

    const users = await this.prisma.user.findMany({
      where: { tenantId, role: { in: roles as any }, actif: true, telephone: { not: null } },
      select: { telephone: true },
    });

    const phones = [...new Set(users.map((u) => u.telephone!).filter(Boolean))];
    this.logger.log(`[WA Broadcast] tenant=${tenantId} roles=${roles.join(',')} destinataires=${phones.length}`);

    const now = new Date();
    const records: WhatsappQueueRecord[] = [];
    for (const phone of phones) {
      try {
        const normalizedPhone = this.normalizePhone(phone);
        const iso = now.toISOString();
        records.push({
          id: randomUUID(),
          tenantId,
          phone: normalizedPhone,
          kind: 'text',
          message: String(message ?? '').trim(),
          document: null,
          status: 'QUEUED',
          attempts: 0,
          createdAt: iso,
          queuedAt: iso,
          lastAttemptAt: null,
          nextAttemptAt: null,
          lastError: null,
          sentAt: null,
          updatedAt: iso,
        });
      } catch (err) {
        this.logger.warn(`[WA Broadcast] phone ignoré ${phone}: ${(err as Error).message}`);
      }
    }

    await this.queueMessageRecords(records);
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
        'Edusen - Code de verification',
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
    if (this.useRelayioProvider()) return false;
    return this.states.get(tenantId)?.ready ?? false;
  }

  private async getRelayioStatus(tenantId: string): Promise<WhatsappStatusResponse> {
    await this.assertTenantExists(tenantId);
    const [features, binding] = await Promise.all([
      this.getFeatures(tenantId),
      this.resolveRelayioSession(tenantId, false),
    ]);

    if (!binding) {
      return {
        connected: false,
        initializing: false,
        hasSession: false,
        reconnectAttempts: 0,
        features,
      };
    }

    const [health, session] = await Promise.all([
      this.relayioRequest<RelayioStatusPayload>(`/v1/sessions/${binding.sessionId}/status`, {
        allowNotFound: true,
      }),
      this.relayioRequest<RelayioSession>(`/v1/sessions/${binding.sessionId}`, {
        allowNotFound: true,
      }),
    ]);

    if (!health && !session) {
      await this.clearRelayioSessionBinding(tenantId);
      return {
        connected: false,
        initializing: false,
        hasSession: false,
        reconnectAttempts: 0,
        lastError: 'Session Relayio introuvable',
        features,
      };
    }

    const status = String(health?.status ?? session?.status ?? '').toUpperCase();
    const connected = status === 'READY';
    const initializing = ['CREATED', 'STARTING', 'QR_PENDING', 'PAIRING_PENDING', 'AUTHENTICATED', 'RECONNECTING'].includes(status);
    const disconnected = ['FAILED', 'DISCONNECTED', 'LOGGED_OUT', 'STOPPED'].includes(status);

    return {
      connected,
      initializing,
      hasSession: true,
      reconnectAttempts: status === 'RECONNECTING' ? 1 : 0,
      lastError: disconnected ? (session?.failureReason ?? status) : undefined,
      phoneNumber: session?.phoneNumber ?? binding.phoneNumber ?? undefined,
      displayName: session?.name ?? binding.name,
      connectedAt: this.toIsoString(session?.lastReadyAt),
      features,
    };
  }

  private async getRelayioQrCode(tenantId: string): Promise<WhatsappQrResponse> {
    let binding = await this.resolveRelayioSession(tenantId, true);
    if (!binding) {
      throw new ServiceUnavailableException('Session Relayio indisponible');
    }

    const currentStatus = await this.relayioRequest<RelayioStatusPayload>(`/v1/sessions/${binding.sessionId}/status`, {
      allowNotFound: true,
    });

    if (!currentStatus) {
      await this.clearRelayioSessionBinding(tenantId);
      binding = await this.resolveRelayioSession(tenantId, true);
      if (!binding) {
        throw new ServiceUnavailableException('Session Relayio indisponible');
      }
    } else if (String(currentStatus.status ?? '').toUpperCase() === 'READY') {
      throw new ServiceUnavailableException('WhatsApp déjà connecté — déconnectez avant de rescanner');
    }

    await this.relayioRequest<RelayioSession>(`/v1/sessions/${binding.sessionId}/start`, {
      method: 'POST',
    });

    const attempts = Math.max(1, Number(this.readConfig('RELAYIO_QR_POLL_ATTEMPTS', 'WHATSAPP_RELAYIO_QR_POLL_ATTEMPTS') ?? 10));
    const delayMs = Math.max(250, Number(this.readConfig('RELAYIO_QR_POLL_INTERVAL_MS', 'WHATSAPP_RELAYIO_QR_POLL_INTERVAL_MS') ?? 1_000));

    for (let attempt = 0; attempt < attempts; attempt++) {
      const payload = await this.relayioRequest<RelayioQrPayload>(`/v1/sessions/${binding.sessionId}/qr`, {
        allowNotFound: true,
      });
      const qrCode = payload ? await this.extractRelayioQrDataUrl(payload) : null;
      if (payload && qrCode) {
        return {
          qrCode,
          expiresInSeconds: this.resolveRelayioQrTtl(payload, QR_TTL_SECONDS),
        };
      }

      const status = await this.relayioRequest<RelayioStatusPayload>(`/v1/sessions/${binding.sessionId}/status`, {
        allowNotFound: true,
      });
      if (String(status?.status ?? '').toUpperCase() === 'READY') {
        throw new ServiceUnavailableException('WhatsApp déjà connecté — déconnectez avant de rescanner');
      }

      if (attempt < attempts - 1) {
        await this.sleep(delayMs);
      }
    }

    throw new ServiceUnavailableException('QR code Relayio indisponible — réessayez dans quelques secondes');
  }

  private async requestRelayioPairingCode(
    tenantId: string,
    phoneNumber?: string,
  ): Promise<WhatsappPairingCodeResponse> {
    const binding = await this.resolveRelayioSession(tenantId, true);
    if (!binding) {
      throw new ServiceUnavailableException('Session Relayio indisponible');
    }

    await this.relayioRequest<RelayioSession>(`/v1/sessions/${binding.sessionId}/start`, {
      method: 'POST',
    });

    const targetPhone = this.normalizeRelayioPlainPhone(phoneNumber)
      ?? binding.phoneNumber
      ?? await this.resolveRelayioPhoneNumber(tenantId);
    if (!targetPhone) {
      throw new BadRequestException('Numéro WhatsApp requis pour générer un code pairing');
    }

    const payload = await this.relayioRequest<RelayioPairingCodePayload>(`/v1/sessions/${binding.sessionId}/pairing-code`, {
      method: 'POST',
      body: { phoneNumber: targetPhone },
    });
    const code = String(payload?.code ?? '').trim();
    if (!code) {
      throw new ServiceUnavailableException('Code pairing Relayio indisponible');
    }

    const expiresAt = this.toIsoString(payload?.expiresAt);
    return {
      sessionId: payload?.sessionId ?? binding.sessionId,
      phoneNumber: payload?.phoneNumber ?? targetPhone,
      code,
      expiresAt,
      expiresInSeconds: expiresAt ? this.secondsUntil(expiresAt, 300) : 300,
    };
  }

  private async logoutRelayio(tenantId: string): Promise<void> {
    await this.assertTenantExists(tenantId);
    const binding = await this.resolveRelayioSession(tenantId, false);
    if (!binding) return;

    await this.relayioRequest<RelayioSession>(`/v1/sessions/${binding.sessionId}/logout`, {
      method: 'POST',
      allowNotFound: true,
    });

    if (!this.getRelayioConfiguredSessionId()) {
      await this.clearRelayioSessionBinding(tenantId);
    }
    this.logger.log(`WhatsApp Relayio déconnecté (tenant=${tenantId}, session=${binding.sessionId})`);
  }

  private async sendRelayioTextMessage(
    tenantId: string,
    phone: string,
    message: string,
  ): Promise<WhatsappQueueResponse> {
    await this.assertTenantExists(tenantId);

    const normalizedPhone = this.normalizePhone(phone);
    const content = String(message ?? '').trim();
    if (!content) {
      throw new BadRequestException('Message WhatsApp vide');
    }

    const localMessageId = randomUUID();
    try {
      const binding = await this.resolveRelayioSession(tenantId, true);
      if (!binding) {
        throw new ServiceUnavailableException('Session Relayio indisponible');
      }

      const response = await this.relayioRequest<RelayioMessagePayload>(`/v1/sessions/${binding.sessionId}/messages/text`, {
        method: 'POST',
        body: {
          chatId: normalizedPhone,
          body: content,
        },
      });
      const messageId = await this.saveRelayioMessageResult({
        localMessageId,
        tenantId,
        phone: normalizedPhone,
        kind: 'text',
        message: content,
        response,
      });

      this.logger.log(`Message WhatsApp Relayio accepté → ${normalizedPhone} (tenant=${tenantId}, message=${messageId})`);
      return { queued: true, messageId };
    } catch (error) {
      await this.saveRelayioFailureRecord(localMessageId, tenantId, normalizedPhone, 'text', content, null, error);
      throw error;
    }
  }

  private async sendRelayioDocument(
    tenantId: string,
    phone: string,
    document: {
      filename: string;
      mimeType: string;
      data: Buffer;
      caption?: string;
    },
  ): Promise<WhatsappQueueResponse> {
    await this.assertTenantExists(tenantId);

    const normalizedPhone = this.normalizePhone(phone);
    const filename = String(document?.filename ?? '').trim();
    const mimeType = String(document?.mimeType ?? '').trim();
    const data = Buffer.isBuffer(document?.data) ? document.data : Buffer.from(document?.data ?? []);
    const caption = String(document?.caption ?? '').trim();

    if (!filename || !mimeType || !data.length) {
      throw new BadRequestException('Document WhatsApp invalide');
    }

    const localMessageId = randomUUID();
    const recordDocument = { filename, mimeType, dataBase64: '' };
    try {
      const binding = await this.resolveRelayioSession(tenantId, true);
      if (!binding) {
        throw new ServiceUnavailableException('Session Relayio indisponible');
      }

      const media = await this.uploadRelayioDocument(binding.sessionId, filename, mimeType, data);
      const response = await this.relayioRequest<RelayioMessagePayload>(`/v1/sessions/${binding.sessionId}/messages/media`, {
        method: 'POST',
        body: {
          chatId: normalizedPhone,
          mediaId: media.id,
          caption: caption || undefined,
        },
      });
      const messageId = await this.saveRelayioMessageResult({
        localMessageId,
        tenantId,
        phone: normalizedPhone,
        kind: 'document',
        message: caption,
        document: recordDocument,
        response,
      });

      this.logger.log(`Document WhatsApp Relayio accepté → ${normalizedPhone} (tenant=${tenantId}, message=${messageId})`);
      return { queued: true, messageId };
    } catch (error) {
      await this.saveRelayioFailureRecord(localMessageId, tenantId, normalizedPhone, 'document', caption, recordDocument, error);
      throw error;
    }
  }

  private async broadcastRelayioToRoles(tenantId: string, message: string, roles: string[]): Promise<void> {
    await this.assertTenantExists(tenantId);
    const content = String(message ?? '').trim();
    if (!content) return;

    const users = await this.prisma.user.findMany({
      where: { tenantId, role: { in: roles as any }, actif: true, telephone: { not: null } },
      select: { telephone: true },
    });

    const phones = [...new Set(users.map((u) => u.telephone!).filter(Boolean))];
    this.logger.log(`[WA Relayio Broadcast] tenant=${tenantId} roles=${roles.join(',')} destinataires=${phones.length}`);

    const concurrency = Math.max(1, Number(this.readConfig('RELAYIO_BROADCAST_CONCURRENCY', 'WHATSAPP_RELAYIO_BROADCAST_CONCURRENCY') ?? 5));
    for (let index = 0; index < phones.length; index += concurrency) {
      const batch = phones.slice(index, index + concurrency);
      const results = await Promise.allSettled(batch.map((phone) => this.sendRelayioTextMessage(tenantId, phone, content)));
      results.forEach((result, offset) => {
        if (result.status === 'rejected') {
          this.logger.warn(`[WA Relayio Broadcast] phone ignoré ${batch[offset]}: ${this.errorMessage(result.reason)}`);
        }
      });
    }
  }

  private async uploadRelayioDocument(
    sessionId: string,
    filename: string,
    mimeType: string,
    data: Buffer,
  ): Promise<RelayioMediaUploadPayload> {
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), filename);
    const media = await this.relayioRequest<RelayioMediaUploadPayload>(`/v1/sessions/${sessionId}/media`, {
      method: 'POST',
      body: formData,
    });
    if (!media?.id) {
      throw new ServiceUnavailableException('Upload média Relayio invalide');
    }
    return media;
  }

  private async resolveRelayioSession(
    tenantId: string,
    createIfMissing: boolean,
  ): Promise<RelayioSessionBinding | null> {
    const configuredSessionId = this.getRelayioConfiguredSessionId();
    if (configuredSessionId) {
      const binding: RelayioSessionBinding = {
        sessionId: configuredSessionId,
        phoneNumber: this.normalizeRelayioPlainPhone(this.readConfig('RELAYIO_PHONE_NUMBER', 'WHATSAPP_RELAYIO_PHONE_NUMBER')) ?? null,
        name: this.readConfig('RELAYIO_SESSION_NAME', 'WHATSAPP_RELAYIO_SESSION_NAME') ?? 'Relayio WhatsApp',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.redis.setJson(this.getRelayioSessionBindingKey(tenantId), binding);
      return binding;
    }

    const stored = await this.redis.getJson<RelayioSessionBinding>(this.getRelayioSessionBindingKey(tenantId));
    if (stored?.sessionId) return stored;
    if (!createIfMissing) return null;

    return this.createRelayioSession(tenantId);
  }

  private async createRelayioSession(tenantId: string): Promise<RelayioSessionBinding> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, nom: true, telephone: true },
    });
    if (!tenant) throw new NotFoundException('Tenant introuvable');

    const phoneNumber = await this.resolveRelayioPhoneNumber(tenantId, tenant.telephone);
    const name = this.resolveRelayioSessionName(tenant.nom);
    const body: Record<string, string> = {
      name,
      authType: this.getRelayioSessionAuthType(),
    };
    if (phoneNumber) body.phoneNumber = phoneNumber;

    const session = await this.relayioRequest<RelayioSession>('/v1/sessions', {
      method: 'POST',
      body,
    });
    if (!session?.id) {
      throw new ServiceUnavailableException('Création session Relayio invalide');
    }

    const now = new Date().toISOString();
    const binding: RelayioSessionBinding = {
      sessionId: session.id,
      phoneNumber: session.phoneNumber ?? phoneNumber ?? null,
      name: session.name ?? name,
      createdAt: now,
      updatedAt: now,
    };
    await this.redis.setJson(this.getRelayioSessionBindingKey(tenantId), binding);
    this.logger.log(`Session WhatsApp Relayio créée (tenant=${tenantId}, session=${session.id})`);
    return binding;
  }

  private async clearRelayioSessionBinding(tenantId: string): Promise<void> {
    await this.redis.del(this.getRelayioSessionBindingKey(tenantId));
  }

  private async resolveRelayioPhoneNumber(tenantId: string, tenantPhone?: string | null): Promise<string | null> {
    const configured = this.normalizeRelayioPlainPhone(this.readConfig('RELAYIO_PHONE_NUMBER', 'WHATSAPP_RELAYIO_PHONE_NUMBER'));
    if (configured) return configured;
    if (tenantPhone) return this.normalizeRelayioPlainPhone(tenantPhone);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { telephone: true },
    });
    return this.normalizeRelayioPlainPhone(tenant?.telephone);
  }

  private resolveRelayioSessionName(tenantName?: string | null): string {
    const configured = this.readConfig('RELAYIO_SESSION_NAME', 'WHATSAPP_RELAYIO_SESSION_NAME');
    if (configured) return configured;
    const suffix = String(tenantName ?? '').trim();
    return suffix ? `Medaaris - ${suffix}` : 'Medaaris WhatsApp';
  }

  private getRelayioSessionAuthType(): string {
    const value = String(this.readConfig('RELAYIO_SESSION_AUTH_TYPE', 'WHATSAPP_RELAYIO_SESSION_AUTH_TYPE') ?? 'local').trim();
    return value === 'remote' ? 'remote' : 'local';
  }

  private async saveRelayioMessageResult(input: {
    localMessageId: string;
    tenantId: string;
    phone: string;
    kind: WhatsappQueueRecord['kind'];
    message: string;
    document?: WhatsappQueueRecord['document'];
    response: RelayioMessagePayload | null;
  }): Promise<string> {
    const now = new Date().toISOString();
    const status = this.mapRelayioMessageStatus(input.response?.status);
    const messageId = String(input.response?.id ?? '').trim() || input.localMessageId;
    const sentAt = status === 'SENT' ? this.toIsoString(input.response?.updatedAt) ?? now : null;
    const record: WhatsappQueueRecord = {
      id: messageId,
      tenantId: input.tenantId,
      phone: input.phone,
      kind: input.kind,
      message: input.message,
      document: input.document ?? null,
      status,
      attempts: 1,
      createdAt: this.toIsoString(input.response?.createdAt) ?? now,
      queuedAt: now,
      lastAttemptAt: now,
      nextAttemptAt: null,
      lastError: status === 'FAILED' ? 'Relayio a refusé le message' : null,
      sentAt,
      updatedAt: this.toIsoString(input.response?.updatedAt) ?? now,
    };
    await this.saveMessageRecord(record, MESSAGE_HISTORY_TTL_SECONDS);
    return messageId;
  }

  private async saveRelayioFailureRecord(
    messageId: string,
    tenantId: string,
    phone: string,
    kind: WhatsappQueueRecord['kind'],
    message: string,
    document: WhatsappQueueRecord['document'],
    error: unknown,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.saveMessageRecord({
      id: messageId,
      tenantId,
      phone,
      kind,
      message,
      document,
      status: 'FAILED',
      attempts: 1,
      createdAt: now,
      queuedAt: now,
      lastAttemptAt: now,
      nextAttemptAt: null,
      lastError: this.errorMessage(error),
      sentAt: null,
      updatedAt: now,
    }, MESSAGE_HISTORY_TTL_SECONDS);
  }

  private mapRelayioMessageStatus(status: unknown): WhatsappQueueRecord['status'] {
    const value = String(status ?? '').trim().toLowerCase();
    if (['sent', 'delivered', 'read'].includes(value)) return 'SENT';
    if (value === 'failed') return 'FAILED';
    if (['pending', 'queued'].includes(value)) return 'QUEUED';
    return 'QUEUED';
  }

  private async relayioRequest<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      allowNotFound?: boolean;
    } = {},
  ): Promise<T | null> {
    const headers = this.getRelayioAuthHeaders();
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    const controller = new AbortController();
    const timeoutMs = Math.max(1_000, Number(this.readConfig('RELAYIO_TIMEOUT_MS', 'WHATSAPP_RELAYIO_TIMEOUT_MS') ?? 15_000));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (options.body !== undefined) {
      if (this.isFormData(options.body)) {
        init.body = options.body;
      } else {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }
    }

    let response: Response;
    try {
      response = await fetch(`${this.getRelayioBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`, init);
    } catch (error) {
      throw new ServiceUnavailableException(`Relayio indisponible: ${this.errorMessage(error)}`);
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    if (response.status === 404 && options.allowNotFound) {
      return null;
    }
    if (!response.ok) {
      this.throwRelayioHttpException(response.status, this.extractRelayioErrorMessage(text, response.statusText));
    }
    if (!text.trim()) return null;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ServiceUnavailableException('Réponse Relayio invalide');
    }
  }

  private getRelayioBaseUrl(): string {
    const configured = this.readConfig('RELAYIO_BASE_URL', 'WHATSAPP_RELAYIO_BASE_URL') ?? 'https://relayio-backend.medaaris.com';
    return configured.replace(/\/+$/, '');
  }

  private getRelayioAuthHeaders(): Record<string, string> {
    const apiKey = this.getRelayioApiKey();
    if (apiKey) {
      return { 'x-api-key': apiKey };
    }

    const sessionToken = this.readConfig('RELAYIO_SESSION_TOKEN', 'WHATSAPP_RELAYIO_SESSION_TOKEN');
    if (sessionToken) {
      return { Authorization: `Bearer ${sessionToken}` };
    }

    throw new ServiceUnavailableException('Configuration Relayio manquante: définissez RELAYIO_API_KEY côté serveur');
  }

  private getRelayioApiKey(): string | null {
    return this.readConfig('RELAYIO_API_KEY', 'WHATSAPP_RELAYIO_API_KEY');
  }

  private getRelayioConfiguredSessionId(): string | null {
    return this.readConfig('RELAYIO_SESSION_ID', 'WHATSAPP_RELAYIO_SESSION_ID');
  }

  private useRelayioProvider(): boolean {
    const provider = String(this.readConfig('WHATSAPP_PROVIDER', 'WHATSAPP_BACKEND_PROVIDER') ?? '').trim().toLowerCase();
    if (provider) return ['relayio', 'relay'].includes(provider);
    return Boolean(this.getRelayioApiKey() || this.getRelayioConfiguredSessionId());
  }

  private readConfig(...keys: string[]): string | null {
    for (const key of keys) {
      const value = this.config.get<string>(key) ?? process.env[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private isFormData(body: unknown): body is FormData {
    return typeof FormData !== 'undefined' && body instanceof FormData;
  }

  private async extractRelayioQrDataUrl(payload: RelayioQrPayload): Promise<string | null> {
    const qr = payload.qr;
    if (!qr) return null;
    if (typeof qr === 'string') {
      if (qr.startsWith('data:image/')) return qr;
      loadQRCodeDep();
      return QRCodeLib.toDataURL(qr, { width: 300, margin: 1 });
    }
    if (qr.imageDataUrl) return qr.imageDataUrl;
    if (qr.value) {
      loadQRCodeDep();
      return QRCodeLib.toDataURL(qr.value, { width: 300, margin: 1 });
    }
    return null;
  }

  private resolveRelayioQrTtl(payload: RelayioQrPayload, fallbackSeconds: number): number {
    if (payload.qr && typeof payload.qr === 'object' && payload.qr.expiresAt) {
      return this.secondsUntil(payload.qr.expiresAt, fallbackSeconds);
    }
    return fallbackSeconds;
  }

  private normalizeRelayioPlainPhone(phone: unknown): string | null {
    let digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length > 9) digits = digits.slice(1);
    if (digits.length === 9 && digits.startsWith('7')) {
      const countryCode = this.config.get<string>('WHATSAPP_DEFAULT_COUNTRY_CODE', '221');
      digits = `${countryCode}${digits}`;
    }
    if (digits.length < 11) return null;
    return `+${digits}`;
  }

  private getRelayioSessionBindingKey(tenantId: string): string {
    return `${WA_RELAYIO_SESSION_PREFIX}${tenantId}`;
  }

  private secondsUntil(value: string | Date, fallbackSeconds: number): number {
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return fallbackSeconds;
    return Math.max(1, Math.ceil((time - Date.now()) / 1000));
  }

  private toIsoString(value: string | Date | undefined | null): string | undefined {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private throwRelayioHttpException(status: number, message: string): never {
    if (status === 400) {
      throw new BadRequestException(message);
    }
    if (status === 404) {
      throw new NotFoundException(message);
    }
    if (status === 401 || status === 403) {
      throw new ServiceUnavailableException(`Authentification Relayio refusée: ${message}`);
    }
    throw new ServiceUnavailableException(`Relayio ${status}: ${message}`);
  }

  private extractRelayioErrorMessage(raw: string, fallback: string): string {
    if (!raw.trim()) return fallback || 'Erreur Relayio';
    try {
      const parsed = JSON.parse(raw) as { message?: unknown; error?: unknown };
      const message = parsed.message ?? parsed.error;
      if (Array.isArray(message)) return message.map((item) => String(item)).join('. ');
      if (message) return String(message);
    } catch {
      // keep raw body below
    }
    return raw.slice(0, 500);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ServiceUnavailableException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      const message = (response as { message?: unknown }).message;
      if (Array.isArray(message)) return message.map((item) => String(item)).join('. ');
      if (message) return String(message);
    }
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private async queueMessageRecord(record: WhatsappQueueRecord): Promise<void> {
    await this.queueMessageRecords([record]);
  }

  private async queueMessageRecords(records: WhatsappQueueRecord[]): Promise<void> {
    if (!records.length) return;
    const tenantId = records[0].tenantId;
    const ids: string[] = [];

    for (const record of records) {
      await this.saveMessageRecord(record);
      ids.push(record.id);
    }

    await this.redis.rpush(this.getQueueKey(tenantId), ...ids);
    await this.redis.sadd(WA_ACTIVE_TENANTS_KEY, tenantId);

    if (await this.hasPersistedSession(tenantId)) {
      this.startClientIfNeeded(tenantId);
    }

    this.scheduleOutboxFlush(tenantId, true);
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
    if (!this.isClientWorkerEnabled()) return;

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
    const store = new RedisRemoteAuthTenantStore(this.redis, tenantId, dataPath, this.storage);
    const clientId = `school-${tenantId}`;

    const client = new WWebClient({
      authTimeoutMs: 90_000,
      qrMaxRetries: 1,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 5_000,
      userAgent:
        process.env.WHATSAPP_USER_AGENT ??
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      deviceName: 'Edusen',
      browserName: 'Chrome',
      authStrategy: new WWebRemoteAuth({
        clientId,
        dataPath,
        store,
      backupSyncIntervalMs: WHATSAPP_BACKUP_SYNC_INTERVAL_MS,
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
      void this.deletePersistedSession(tenantId).catch(() => null);
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

    await this.deletePersistedSession(tenantId);
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

      processed++;
      const shouldContinue = await this.sendAndAckMessage(tenantId, state, messageId);
      if (!shouldContinue) break;
    }

    await this.pruneInactiveTenant(tenantId);
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

      if (record.kind === 'document' && record.document) {
        const media = new WWebMessageMedia(record.document.mimeType, record.document.dataBase64, record.document.filename);
        await state.client.sendMessage(record.phone, media, {
          caption: record.message || undefined,
          sendMediaAsDocument: true,
        });
      } else {
        await state.client.sendMessage(record.phone, record.message);
      }

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
        return state.ready && !!state.client;
      }

      const retryAtEpochMs = Date.now() + this.computeRetryDelayMs(record.attempts);
      record.status = 'RETRY';
      record.nextAttemptAt = new Date(retryAtEpochMs).toISOString();
      await this.saveMessageRecord(record);
      await this.redis.zadd(retryKey, retryAtEpochMs, messageId);
      await this.redis.sadd(WA_ACTIVE_TENANTS_KEY, tenantId);
      this.logger.warn(`Échec envoi WhatsApp — replanifié (tenant=${tenantId}, message=${messageId}): ${error}`);
      return state.ready && !!state.client;
    }
  }

  private async promoteRetryQueues(): Promise<void> {
    const tenantIds = await this.getActiveTenantIds();
    if (!tenantIds.length) return;

    const now = Date.now();
    for (const tenantId of tenantIds) {
      const retryKey = this.getRetryKey(tenantId);
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
        await this.redis.sadd(WA_ACTIVE_TENANTS_KEY, tenantId);
      }

      this.scheduleOutboxFlush(tenantId, true);
      await this.pruneInactiveTenant(tenantId);
    }
  }

  private async recoverStaleProcessingMessages(): Promise<void> {
    const tenantIds = await this.getActiveTenantIds();
    if (!tenantIds.length) return;

    const staleThreshold = Date.now() - PROCESSING_STALE_AFTER_MS;
    for (const tenantId of tenantIds) {
      const processingKey = this.getProcessingKey(tenantId);
      const processingIds = await this.redis.lrange(processingKey, 0, -1);
      if (!processingIds.length) {
        await this.pruneInactiveTenant(tenantId);
        continue;
      }

      for (const messageId of processingIds) {
        const record = await this.getMessageRecord(tenantId, messageId);
        if (!record) {
          await this.redis.lrem(processingKey, 0, messageId);
          continue;
        }

        const lastAttemptAt = record.lastAttemptAt ? new Date(record.lastAttemptAt).getTime() : 0;
        if (record.status !== 'PROCESSING' || !lastAttemptAt || lastAttemptAt > staleThreshold) {
          continue;
        }

        record.status = 'QUEUED';
        record.nextAttemptAt = null;
        record.updatedAt = new Date().toISOString();
        await this.saveMessageRecord(record);
        await this.redis.lrem(processingKey, 0, messageId);
        await this.redis.rpush(this.getQueueKey(tenantId), messageId);
        this.logger.warn(`Message WhatsApp récupéré depuis processing stale (tenant=${tenantId}, message=${messageId})`);
      }

      this.scheduleOutboxFlush(tenantId, true);
      await this.pruneInactiveTenant(tenantId);
    }
  }

  private async cleanupMessageHistory(): Promise<void> {
    const tenantIds = await this.getActiveTenantIds();
    if (!tenantIds.length) return;

    const now = Date.now();
    for (const tenantId of tenantIds) {
      const historyKey = this.getHistoryKey(tenantId);
      const expiredIds = await this.redis.zrangebyscore(historyKey, 0, now, {
        offset: 0,
        count: HISTORY_CLEANUP_BATCH_SIZE,
      });
      if (!expiredIds.length) {
        await this.pruneInactiveTenant(tenantId);
        continue;
      }

      await this.redis.zrem(historyKey, ...expiredIds);
      await this.redis.srem(this.getMessageIndexKey(tenantId), ...expiredIds);
      await this.redis.delMany(expiredIds.map((messageId) => this.getMessageKey(tenantId, messageId)));
      await this.pruneInactiveTenant(tenantId);
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

    if (!this.processingRecoveryTimer) {
      this.processingRecoveryTimer = setInterval(() => {
        void this.recoverStaleProcessingMessages();
      }, PROCESSING_RECOVERY_INTERVAL_MS);
    }

    if (!this.historyCleanupTimer) {
      this.historyCleanupTimer = setInterval(() => {
        void this.cleanupMessageHistory();
      }, HISTORY_CLEANUP_INTERVAL_MS);
    }
  }

  private async migrateLegacyStateToRedis(): Promise<void> {
    await this.migrateLegacySessionsToRedis();
    await this.migrateLegacyOutboxToRedis();
  }

  private async migrateRedisSessionPayloadsToObjectStorage(): Promise<void> {
    if (!this.usesObjectStorage()) return;

    const tenantIds = await this.redis.smembers(WA_SESSION_INDEX_KEY);
    for (const tenantId of tenantIds) {
      const meta = await this.redis.getJson<WhatsappStoredSessionMeta>(this.getSessionMetaKey(tenantId));
      if (meta?.storage === 's3') continue;

      const bytes = await this.redis.getBuffer(this.getSessionKey(tenantId));
      if (!bytes) continue;

      try {
        await this.persistSessionBytes(tenantId, bytes);
        this.logger.log(`Session WhatsApp migrée vers S3/MinIO (tenant=${tenantId}, bytes=${bytes.length})`);
      } catch (error) {
        this.logger.warn(`Migration session WhatsApp reportée (tenant=${tenantId}): ${this.formatError(error)}`);
      }

      // Yield between large archives so the API remains responsive under load.
      await new Promise((resolve) => setImmediate(resolve));
    }
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
      if (session.sessionData && !await this.hasPersistedSession(session.tenantId)) {
        const bytes = Buffer.from(session.sessionData);
        await this.persistSessionBytes(session.tenantId, bytes);
        await this.prisma.whatsappSession.update({
          where: { tenantId: session.tenantId },
          data: { sessionData: null },
        });
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
          kind: 'text',
          message: entry.message,
          document: null,
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

        await this.saveMessageRecord(queueRecord, invalidPhone ? MESSAGE_HISTORY_TTL_SECONDS : undefined);
        if (invalidPhone) {
          this.logger.warn(`Migration WhatsApp: message ${entry.id} marqué en échec à cause d'un numéro invalide (${String(entry.phone ?? '')})`);
        } else if (status === 'QUEUED') {
          await this.redis.rpush(this.getQueueKey(entry.tenantId), entry.id);
          await this.redis.sadd(WA_ACTIVE_TENANTS_KEY, entry.tenantId);
        } else if (status === 'RETRY' && queueRecord.nextAttemptAt) {
          await this.redis.zadd(this.getRetryKey(entry.tenantId), new Date(queueRecord.nextAttemptAt).getTime(), entry.id);
          await this.redis.sadd(WA_ACTIVE_TENANTS_KEY, entry.tenantId);
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

    if (legacy.sessionData && !await this.hasPersistedSession(tenantId)) {
      const bytes = Buffer.from(legacy.sessionData);
      await this.persistSessionBytes(tenantId, bytes);
      await this.prisma.whatsappSession.update({ where: { tenantId }, data: { sessionData: null } });
    }
  }

  private async hasPersistedSession(tenantId: string): Promise<boolean> {
    const meta = await this.redis.getJson<WhatsappStoredSessionMeta>(this.getSessionMetaKey(tenantId));
    if (meta?.storage === 's3') return Boolean(meta.storageKey);
    return this.redis.exists(this.getSessionKey(tenantId));
  }

  private async persistSessionBytes(tenantId: string, bytes: Buffer): Promise<void> {
    const useObjectStorage = this.usesObjectStorage();
    const storageKey = this.getSessionObjectKey(tenantId);
    if (useObjectStorage) {
      await this.storage.uploadPrivate(storageKey, bytes, 'application/zip');
      await this.redis.del(this.getSessionKey(tenantId));
    } else {
      await this.redis.setBuffer(this.getSessionKey(tenantId), bytes);
    }
    await this.redis.setJson(this.getSessionMetaKey(tenantId), {
      encoding: 'binary',
      checksum: await this.sessionChecksum(bytes),
      size: bytes.length,
      storage: useObjectStorage ? 's3' : 'redis',
      storageKey: useObjectStorage ? storageKey : undefined,
      updatedAt: new Date().toISOString(),
    } satisfies WhatsappStoredSessionMeta);
    await this.redis.sadd(WA_SESSION_INDEX_KEY, tenantId);
  }

  private async deletePersistedSession(tenantId: string): Promise<void> {
    const meta = await this.redis.getJson<WhatsappStoredSessionMeta>(this.getSessionMetaKey(tenantId));
    if (meta?.storage === 's3' && meta.storageKey) {
      await this.storage.delete(meta.storageKey).catch(() => undefined);
    }
    await this.redis.del(this.getSessionKey(tenantId));
    await this.redis.del(this.getSessionMetaKey(tenantId));
    await this.redis.srem(WA_SESSION_INDEX_KEY, tenantId);
  }

  private usesObjectStorage(): boolean {
    return process.env.WHATSAPP_SESSION_STORAGE !== 'redis' && this.storage.isConfigured();
  }

  private isClientWorkerEnabled(): boolean {
    return this.config.get<string>('WHATSAPP_CLIENT_ENABLED', 'true') !== 'false';
  }

  private getSessionObjectKey(tenantId: string): string {
    return `whatsapp-sessions/${tenantId}/remote-auth.zip`;
  }

  private async sessionChecksum(bytes: Buffer): Promise<string> {
    const digest = await webcrypto.subtle.digest('SHA-256', bytes);
    return Buffer.from(digest).toString('hex');
  }

  private async persistStatus(tenantId: string, status: WhatsappPersistedStatus): Promise<void> {
    await this.redis.setJson(this.getStatusKey(tenantId), status);
  }

  private async saveMessageRecord(record: WhatsappQueueRecord, ttlSeconds?: number): Promise<void> {
    await this.redis.setJson(this.getMessageKey(record.tenantId, record.id), record, ttlSeconds);
    await this.redis.sadd(this.getMessageIndexKey(record.tenantId), record.id);
    await this.redis.sadd(WA_ACTIVE_TENANTS_KEY, record.tenantId);
    if (ttlSeconds) {
      await this.redis.zadd(this.getHistoryKey(record.tenantId), Date.now() + ttlSeconds * 1000, record.id);
    } else {
      await this.redis.zrem(this.getHistoryKey(record.tenantId), record.id);
    }
  }

  private async getMessageRecord(tenantId: string, messageId: string): Promise<WhatsappQueueRecord | null> {
    return this.redis.getJson<WhatsappQueueRecord>(this.getMessageKey(tenantId, messageId));
  }

  private async getActiveTenantIds(): Promise<string[]> {
    const ids = new Set<string>(await this.redis.smembers(WA_ACTIVE_TENANTS_KEY));
    for (const tenantId of this.states.keys()) {
      ids.add(tenantId);
    }
    return [...ids];
  }

  private async pruneInactiveTenant(tenantId: string): Promise<void> {
    const [queued, processing, retry, history, indexed] = await Promise.all([
      this.redis.llen(this.getQueueKey(tenantId)),
      this.redis.llen(this.getProcessingKey(tenantId)),
      this.redis.zcard(this.getRetryKey(tenantId)),
      this.redis.zcard(this.getHistoryKey(tenantId)),
      this.redis.scard(this.getMessageIndexKey(tenantId)),
    ]);

    if (!queued && !processing && !retry && !history && !indexed) {
      await this.redis.srem(WA_ACTIVE_TENANTS_KEY, tenantId);
    }
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

  private getSessionMetaKey(tenantId: string): string {
    return `${WA_SESSION_META_PREFIX}${tenantId}`;
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

  private getHistoryKey(tenantId: string): string {
    return `${WA_HISTORY_PREFIX}${tenantId}`;
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
