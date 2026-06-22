import { webcrypto } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { AsyncSemaphore } from '@/common/utils/async.util';
import { StorageService } from '@/infrastructure/storage/storage.service';

const SESSION_INDEX_KEY = 'wa:sessions';
const SESSION_DATA_PREFIX = 'wa:session:data:';
const SESSION_META_PREFIX = 'wa:session:meta:';

interface RedisStoredSessionMeta {
  encoding: 'binary' | 'base64';
  checksum: string;
  size: number;
  modifiedAtMs?: number;
  storage?: 'redis' | 's3';
  storageKey?: string;
  updatedAt: string;
}

const sessionSaveConcurrency = Math.max(1, Number(process.env.WHATSAPP_SESSION_SAVE_CONCURRENCY ?? 1));
const sessionSaveSemaphore = new AsyncSemaphore(sessionSaveConcurrency);

export class RedisRemoteAuthTenantStore {
  private readonly logger = new Logger(RedisRemoteAuthTenantStore.name);
  private saveInFlight: Promise<void> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly tenantId: string,
    private readonly dataPath: string,
    private readonly storage?: StorageService,
  ) {}

  async sessionExists(_: { session: string }): Promise<boolean> {
    const meta = await this.redis.getJson<RedisStoredSessionMeta>(this.sessionMetaKey());
    if (meta?.storage === 's3' && meta.storageKey) {
      return this.storage?.privateObjectExists(meta.storageKey) ?? false;
    }
    return this.redis.exists(this.sessionKey());
  }

  async save({ session }: { session: string }): Promise<void> {
    if (this.saveInFlight) return this.saveInFlight;

    const operation = sessionSaveSemaphore.run(() => this.persistSession(session));
    this.saveInFlight = operation;
    try {
      await operation;
    } finally {
      if (this.saveInFlight === operation) this.saveInFlight = null;
    }
  }

  private async persistSession(session: string): Promise<void> {
    const zipPath = join(this.dataPath, `${session}.zip`);

    try {
      const file = await stat(zipPath);
      const existingMeta = await this.redis.getJson<RedisStoredSessionMeta>(this.sessionMetaKey());
      if (
        existingMeta?.encoding === 'binary'
        && existingMeta.size === file.size
        && existingMeta.modifiedAtMs === file.mtimeMs
      ) {
        await this.redis.sadd(SESSION_INDEX_KEY, this.tenantId);
        this.logger.debug(`save(tenant=${this.tenantId}) — archive inchangée, lecture Redis ignorée`);
        return;
      }

      const data = await readFile(zipPath);
      const checksum = await this.sha256(data);
      if (existingMeta?.encoding === 'binary' && existingMeta.checksum === checksum && existingMeta.size === data.length) {
        await this.redis.sadd(SESSION_INDEX_KEY, this.tenantId);
        this.logger.debug(`save(tenant=${this.tenantId}) — session inchangée, écriture Redis ignorée`);
        return;
      }

      const useObjectStorage = this.usesObjectStorage();
      const storageKey = this.objectStorageKey();
      if (useObjectStorage) {
        await this.storage!.uploadPrivate(storageKey, data, 'application/zip');
        // Frees legacy Redis session data as soon as the durable object is written.
        await this.redis.del(this.sessionKey());
      } else {
        await this.redis.setBuffer(this.sessionKey(), data);
      }
      await this.redis.setJson(this.sessionMetaKey(), {
        encoding: 'binary',
        checksum,
        size: data.length,
        modifiedAtMs: file.mtimeMs,
        storage: useObjectStorage ? 's3' : 'redis',
        storageKey: useObjectStorage ? storageKey : undefined,
        updatedAt: new Date().toISOString(),
      } satisfies RedisStoredSessionMeta);
      await this.redis.sadd(SESSION_INDEX_KEY, this.tenantId);
      this.logger.log(`save(tenant=${this.tenantId}) — ${data.length} octets sauvegardés dans ${useObjectStorage ? 'S3/MinIO' : 'Redis'}`);
    } catch (err) {
      this.logger.error(`save — échec : ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async extract({ session }: { session: string }): Promise<void> {
    try {
      const meta = await this.redis.getJson<RedisStoredSessionMeta>(this.sessionMetaKey());
      const objectPayload = meta?.storage === 's3' && meta.storageKey
        ? await this.storage?.getPrivateBuffer(meta.storageKey)
        : null;
      const bytes = !objectPayload && meta?.encoding === 'binary'
        ? await this.redis.getBuffer(this.sessionKey())
        : null;
      const legacyEncoded = !meta ? await this.redis.get(this.sessionKey()) : null;
      const payload = objectPayload ?? bytes ?? (legacyEncoded ? Buffer.from(legacyEncoded, 'base64') : null);

      if (!payload) {
        this.logger.warn(`extract(tenant=${this.tenantId}) — aucune session Redis, nouveau QR requis`);
        return;
      }

      await mkdir(this.dataPath, { recursive: true });
      await writeFile(join(this.dataPath, `${session}.zip`), payload);
      this.logger.log(`extract(tenant=${this.tenantId}) — session restaurée (${payload.length} octets)`);
    } catch (err) {
      this.logger.error(`extract — échec : ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async delete(_: { session: string }): Promise<void> {
    const meta = await this.redis.getJson<RedisStoredSessionMeta>(this.sessionMetaKey());
    if (meta?.storage === 's3' && meta.storageKey && this.storage) {
      await this.storage.delete(meta.storageKey).catch(() => undefined);
    }
    await this.redis.del(this.sessionKey());
    await this.redis.del(this.sessionMetaKey());
    await this.redis.srem(SESSION_INDEX_KEY, this.tenantId);
    this.logger.log(`delete(tenant=${this.tenantId}) — session Redis effacée`);
  }

  private sessionKey(): string {
    return `${SESSION_DATA_PREFIX}${this.tenantId}`;
  }

  private sessionMetaKey(): string {
    return `${SESSION_META_PREFIX}${this.tenantId}`;
  }

  private objectStorageKey(): string {
    return `whatsapp-sessions/${this.tenantId}/remote-auth.zip`;
  }

  private usesObjectStorage(): boolean {
    return process.env.WHATSAPP_SESSION_STORAGE !== 'redis' && Boolean(this.storage?.isConfigured());
  }

  private async sha256(data: Buffer): Promise<string> {
    const digest = await webcrypto.subtle.digest('SHA-256', data);
    return Buffer.from(digest).toString('hex');
  }
}
