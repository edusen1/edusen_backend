import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { RedisService } from '@/infrastructure/redis/redis.service';

const SESSION_INDEX_KEY = 'wa:sessions';
const SESSION_DATA_PREFIX = 'wa:session:data:';

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
      await this.redis.set(this.sessionKey(), data.toString('base64'));
      await this.redis.sadd(SESSION_INDEX_KEY, this.tenantId);
      this.logger.log(`save(tenant=${this.tenantId}) — ${data.length} octets sauvegardés dans Redis`);
    } catch (err) {
      this.logger.error(`save — échec : ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async extract({ session }: { session: string }): Promise<void> {
    try {
      const encoded = await this.redis.get(this.sessionKey());
      if (!encoded) {
        this.logger.warn(`extract(tenant=${this.tenantId}) — aucune session Redis, nouveau QR requis`);
        return;
      }

      mkdirSync(this.dataPath, { recursive: true });
      const bytes = Buffer.from(encoded, 'base64');
      writeFileSync(join(this.dataPath, `${session}.zip`), bytes);
      this.logger.log(`extract(tenant=${this.tenantId}) — session restaurée (${bytes.length} octets)`);
    } catch (err) {
      this.logger.error(`extract — échec : ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async delete(_: { session: string }): Promise<void> {
    await this.redis.del(this.sessionKey());
    await this.redis.srem(SESSION_INDEX_KEY, this.tenantId);
    this.logger.log(`delete(tenant=${this.tenantId}) — session Redis effacée`);
  }

  private sessionKey(): string {
    return `${SESSION_DATA_PREFIX}${this.tenantId}`;
  }
}
