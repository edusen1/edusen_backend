import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { REQUIRE_FEATURE_KEY } from '@/common/decorators/require-feature.decorator';
import { FeatureService } from '@/modules/feature/feature.service';
import type { JwtUser } from '@/common/types/auth.types';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureService: FeatureService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const featureKey = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!featureKey) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtUser; tenantId?: string }>();
    const tenantId = req.tenantId ?? req.user?.tenantId;

    if (!tenantId) return true; // platform users have no tenant — skip check

    const enabled = await this.featureService.isEnabled(tenantId, featureKey);
    if (!enabled) {
      throw new ForbiddenException('Fonctionnalite non disponible avec votre abonnement');
    }

    return true;
  }
}
