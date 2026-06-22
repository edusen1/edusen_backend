import { AppCacheService } from '@/infrastructure/cache/app-cache.service';

describe('AppCacheService', () => {
  it('coalesces simultaneous cache misses into one expensive load', async () => {
    const redis = {
      getJson: jest.fn().mockResolvedValue(null),
      acquireLock: jest.fn().mockResolvedValue('acquired'),
      setJson: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      delMany: jest.fn().mockResolvedValue(undefined),
    };
    const cache = new AppCacheService(redis as never);
    let loads = 0;

    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        cache.getOrSet('tenant:ecole-a:dashboard', 10, async () => {
          loads += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { eleves: 42 };
        }),
      ),
    );

    expect(loads).toBe(1);
    expect(results).toEqual(Array.from({ length: 25 }, () => ({ eleves: 42 })));
  });
});
