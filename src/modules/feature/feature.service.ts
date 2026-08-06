import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { AppCacheService } from '@/infrastructure/cache/app-cache.service';

const CACHE_TTL = 300; // 5 minutes

@Injectable()
export class FeatureService {
  private readonly logger = new Logger(FeatureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  /**
   * Resolve whether a feature is enabled for a given tenant.
   * Resolution order:
   *   1. TenantFeatureOverride (per-tenant override)
   *   2. PlanFeature (plan default)
   *   3. false (disabled by default)
   */
  async isEnabled(tenantId: string, featureKey: string): Promise<boolean> {
    const resolved = await this.getResolvedFeatures(tenantId);
    return resolved[featureKey] ?? false;
  }

  /**
   * Returns all resolved features for a tenant (overrides merged with plan defaults).
   * Cached in Redis for 5 minutes.
   */
  async getResolvedFeatures(tenantId: string): Promise<Record<string, boolean>> {
    const cacheKey = `features:resolved:${tenantId}`;
    return this.cache.getOrSet(cacheKey, CACHE_TTL, () => this.loadResolvedFeatures(tenantId));
  }

  /**
   * Returns the plan limits for a tenant's current plan.
   * Cached in Redis for 5 minutes.
   */
  async getLimits(tenantId: string): Promise<Record<string, number>> {
    const cacheKey = `features:limits:${tenantId}`;
    return this.cache.getOrSet(cacheKey, CACHE_TTL, () => this.loadLimits(tenantId));
  }

  /**
   * Check if a tenant has exceeded a specific limit.
   */
  async checkLimit(tenantId: string, limitKey: string, currentCount: number): Promise<{ allowed: boolean; limit: number; current: number }> {
    const limits = await this.getLimits(tenantId);
    const limit = limits[limitKey] ?? 0;
    // 0 or negative = unlimited
    if (limit <= 0) return { allowed: true, limit: 0, current: currentCount };
    return { allowed: currentCount < limit, limit, current: currentCount };
  }

  /**
   * Invalidate the cache for a tenant (after override or plan change).
   */
  async invalidateCache(tenantId: string): Promise<void> {
    await this.cache.invalidate(
      `features:resolved:${tenantId}`,
      `features:limits:${tenantId}`,
    );
  }

  /**
   * Invalidate cache for all tenants of a given plan (after plan feature change).
   */
  async invalidatePlanCache(plan: string): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({
      where: { plan, deletedAt: null },
      select: { id: true },
    });
    const keys = tenants.flatMap((t) => [
      `features:resolved:${t.id}`,
      `features:limits:${t.id}`,
    ]);
    if (keys.length > 0) await this.cache.invalidate(...keys);
  }

  private async loadResolvedFeatures(tenantId: string): Promise<Record<string, boolean>> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });
    if (!tenant) return {};

    const [planFeatures, overrides] = await Promise.all([
      this.prisma.planFeature.findMany({ where: { plan: tenant.plan } }),
      this.prisma.tenantFeatureOverride.findMany({ where: { tenantId } }),
    ]);

    const resolved: Record<string, boolean> = {};

    // Start with plan defaults
    for (const pf of planFeatures) {
      resolved[pf.featureKey] = pf.actif;
    }

    // Apply overrides (override > plan)
    for (const ov of overrides) {
      resolved[ov.featureKey] = ov.actif;
    }

    return resolved;
  }

  private async loadLimits(tenantId: string): Promise<Record<string, number>> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });
    if (!tenant) return {};

    const limits = await this.prisma.planLimit.findMany({ where: { plan: tenant.plan } });
    const result: Record<string, number> = {};
    for (const l of limits) {
      result[l.limitKey] = l.limitValue;
    }
    return result;
  }
}
