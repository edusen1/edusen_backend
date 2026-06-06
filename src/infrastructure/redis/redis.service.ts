import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  onModuleInit(): void {
    const url = process.env.REDIS_URL;

    this.client = url
      ? new Redis(url, { lazyConnect: true })
      : new Redis({
          host: process.env.REDIS_HOST ?? 'localhost',
          port: Number(process.env.REDIS_PORT ?? 6379),
          password: process.env.REDIS_PASSWORD || undefined,
          lazyConnect: true,
        });

    this.client.on('error', (err: Error) => {
      this.logger.warn(`Redis error: ${err.message}`);
    });

    this.client.connect().catch((err: Error) => {
      this.logger.warn(`Redis connect failed: ${err.message}. Running without cache.`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      this.logger.warn(`Redis set failed for key=${key}: ${(err as Error).message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`Redis del failed for key=${key}: ${(err as Error).message}`);
    }
  }

  async delMany(keys: string[]): Promise<void> {
    if (!keys.length) return;
    try {
      await this.client.del(...keys);
    } catch (err) {
      this.logger.warn(`Redis delMany failed: ${(err as Error).message}`);
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch {
      return 0;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.expire(key, ttlSeconds);
    } catch {
      // ignore
    }
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    try {
      return await this.client.rpush(key, ...values);
    } catch {
      return 0;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.client.lrange(key, start, stop);
    } catch {
      return [];
    }
  }

  async lpop(key: string): Promise<string | null> {
    try {
      return await this.client.lpop(key);
    } catch {
      return null;
    }
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    try {
      await this.client.ltrim(key, start, stop);
    } catch {
      // ignore
    }
  }

  async llen(key: string): Promise<number> {
    try {
      return await this.client.llen(key);
    } catch {
      return 0;
    }
  }

  async scanKeys(matchPattern: string, count = 100): Promise<string[]> {
    try {
      let cursor = '0';
      const keys: string[] = [];
      do {
        const [nextCursor, found] = await this.client.scan(cursor, 'MATCH', matchPattern, 'COUNT', String(count));
        cursor = nextCursor;
        keys.push(...found);
      } while (cursor !== '0');
      return keys;
    } catch {
      return [];
    }
  }

  async getCount(key: string): Promise<number> {
    const v = await this.get(key);
    if (!v) return 0;
    const parsed = parseInt(v, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  async getLockoutAttempts(key: string): Promise<{ count: number; lastEpoch: number }> {
    const v = await this.get(key);
    if (!v) return { count: 0, lastEpoch: 0 };
    const colon = v.indexOf(':');
    if (colon < 0) {
      const count = parseInt(v, 10);
      return { count: isNaN(count) ? 0 : count, lastEpoch: 0 };
    }
    const count = parseInt(v.substring(0, colon), 10);
    const lastEpoch = parseInt(v.substring(colon + 1), 10);
    return {
      count: isNaN(count) ? 0 : count,
      lastEpoch: isNaN(lastEpoch) ? 0 : lastEpoch,
    };
  }

  async incrementLockout(key: string, ttlSeconds: number): Promise<number> {
    const { count } = await this.getLockoutAttempts(key);
    const next = count + 1;
    const now = Math.floor(Date.now() / 1000);
    await this.set(key, `${next}:${now}`, ttlSeconds);
    return next;
  }
}
