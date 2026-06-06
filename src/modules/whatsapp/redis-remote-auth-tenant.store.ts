import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { RedisService } from '@/infrastructure/redis/redis.service';

const SESSION_INDEX_KEY = 'wa:sessions';
const SESSION_DATA_PREFIX = 'wa:session:data:';
const SESSION_META_PREFIX = 'wa:session:meta:';

interface RedisStoredSessionMeta {
  encoding: 'binary' | 'base64';
  checksum: string;
  size: number;
  updatedAt: string;
}

export class RedisRemoteAuthTenantStore {
  private readonly logger = new Logger(RedisRemoteAuthTenantStore.name);

  constructor(
    private readonly redis: RedisService,
    private readonly tenantId: string,
    private readonly dataPath: string,
  ) {}

  async sessionExists(_: { session: string }): Promise<boolean> {
    return this.redis.exists(this.sessionKey());
  }

  async save({ session }: { session: string }): Promise<void> {
    const zipPath = join(this.dataPath, `${session}.zip`);
    if (!existsSync(zipPath)) {
      this.logger.error(`save — zip introuvable : ${zipPath}`);
      return;
    }

    try {
      const data = readFileSync(zipPath);
      const checksum = createHash('sha256').update(data).digest('hex');
      const existingMeta = await this.redis.getJson<RedisStoredSessionMeta>(this.sessionMetaKey());
      if (existingMeta?.encoding === 'binary' && existingMeta.checksum === checksum && existingMeta.size === data.length) {
        await this.redis.sadd(SESSION_INDEX_KEY, this.tenantId);
        this.logger.debug(`save(tenant=${this.tenantId}) — session inchangée, écriture Redis ignorée`);
        return;
      }

      await this.redis.setBuffer(this.sessionKey(), data);
      await this.redis.setJson(this.sessionMetaKey(), {
        encoding: 'binary',
        checksum,
        size: data.length,
        updatedAt: new Date().toISOString(),
      } satisfies RedisStoredSessionMeta);
      await this.redis.sadd(SESSION_INDEX_KEY, this.tenantId);
      this.logger.log(`save(tenant=${this.tenantId}) — ${data.length} octets sauvegardés dans Redis`);
    } catch (err) {
      this.logger.error(`save — échec : ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async extract({ session }: { session: string }): Promise<void> {
    try {
      const meta = await this.redis.getJson<RedisStoredSessionMeta>(this.sessionMetaKey());
      const bytes = meta?.encoding === 'binary'
        ? await this.redis.getBuffer(this.sessionKey())
        : null;
      const legacyEncoded = !meta ? await this.redis.get(this.sessionKey()) : null;
      const payload = bytes ?? (legacyEncoded ? Buffer.from(legacyEncoded, 'base64') : null);

      if (!payload) {
        this.logger.warn(`extract(tenant=${this.tenantId}) — aucune session Redis, nouveau QR requis`);
        return;
      }

      mkdirSync(this.dataPath, { recursive: true });
      writeFileSync(join(this.dataPath, `${session}.zip`), payload);
      this.logger.log(`extract(tenant=${this.tenantId}) — session restaurée (${payload.length} octets)`);
    } catch (err) {
      this.logger.error(`extract — échec : ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async delete(_: { session: string }): Promise<void> {
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
}
