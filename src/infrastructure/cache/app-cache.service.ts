import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '@/infrastructure/redis/redis.service';

/**
 * Short-lived shared cache with local request coalescing. It prevents a burst
 * of users from issuing the same expensive dashboard or configuration query.
 */
@Injectable()
export class AppCacheService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: RedisService) {}

  async getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.redis.getJson<T>(key);
    if (cached !== null) return cached;

    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const operation = this.loadAndCache(key, ttlSeconds, loader);
    this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async invalidate(...keys: string[]): Promise<void> {
    await this.redis.delMany(keys);
  }

  private async loadAndCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const lockKey = `cache:lock:${key}`;
    const lockResult = await this.redis.acquireLock(lockKey, randomUUID(), Math.max(2, Math.min(ttlSeconds, 15)));

    if (lockResult === 'locked') {
      // Another replica is already loading this value. Wait briefly for its cache write.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        const cached = await this.redis.getJson<T>(key);
        if (cached !== null) return cached;
      }
    }

    try {
      const value = await loader();
      await this.redis.setJson(key, value, ttlSeconds);
      return value;
    } finally {
      if (lockResult === 'acquired') await this.redis.del(lockKey);
    }
  }
}
