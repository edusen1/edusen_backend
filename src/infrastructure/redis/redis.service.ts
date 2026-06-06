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
    await this.client.quit().catch(() => undefined);
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

  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      return await this.client.getBuffer(key);
    } catch {
      return null;
    }
  }

  async setBuffer(key: string, value: Buffer, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      this.logger.warn(`Redis setBuffer failed for key=${key}: ${(err as Error).message}`);
    }
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (err) {
      this.logger.warn(`Redis setIfAbsent failed for key=${key}: ${(err as Error).message}`);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await this.client.exists(key)) > 0;
    } catch {
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch {
      return -2;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`Redis getJson parse failed for key=${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
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

  async lpush(key: string, ...values: string[]): Promise<number> {
    try {
      return await this.client.lpush(key, ...values);
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

  async lrem(key: string, count: number, value: string): Promise<number> {
    try {
      return await this.client.lrem(key, count, value);
    } catch {
      return 0;
    }
  }

  async rpoplpush(source: string, destination: string): Promise<string | null> {
    try {
      return await this.client.rpoplpush(source, destination);
    } catch {
      return null;
    }
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    try {
      if (!members.length) return 0;
      return await this.client.sadd(key, ...members);
    } catch {
      return 0;
    }
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    try {
      if (!members.length) return 0;
      return await this.client.srem(key, ...members);
    } catch {
      return 0;
    }
  }

  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.smembers(key);
    } catch {
      return [];
    }
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    try {
      return await this.client.zadd(key, String(score), member);
    } catch {
      return 0;
    }
  }

  async zrangebyscore(key: string, min: number | string, max: number | string, limit?: { offset: number; count: number }): Promise<string[]> {
    try {
      if (limit) {
        return await this.client.zrangebyscore(
          key,
          String(min),
          String(max),
          'LIMIT',
          String(limit.offset),
          String(limit.count),
        );
      }
      return await this.client.zrangebyscore(key, String(min), String(max));
    } catch {
      return [];
    }
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    try {
      if (!members.length) return 0;
      return await this.client.zrem(key, ...members);
    } catch {
      return 0;
    }
  }

  async zcard(key: string): Promise<number> {
    try {
      return await this.client.zcard(key);
    } catch {
      return 0;
    }
  }

  async scard(key: string): Promise<number> {
    try {
      return await this.client.scard(key);
    } catch {
      return 0;
    }
  }

  async hset(key: string, values: Record<string, string>): Promise<void> {
    try {
      const entries = Object.entries(values);
      if (!entries.length) return;
      await this.client.hset(key, Object.fromEntries(entries));
    } catch (err) {
      this.logger.warn(`Redis hset failed for key=${key}: ${(err as Error).message}`);
    }
  }

  async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.client.hget(key, field);
    } catch {
      return null;
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hgetall(key);
    } catch {
      return {};
    }
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    try {
      if (!fields.length) return 0;
      return await this.client.hdel(key, ...fields);
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
