import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import type { FastifyRequest } from 'fastify';
import type { JwtUser, UserRole } from '@/common/types/auth.types';

@Injectable()
export class AppAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtUser }>();
    const auth = req.headers.authorization;

    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token manquant');
    }

    const token = auth.slice(7);
    let payload: JwtUser;
    try {
      payload = this.jwtService.verify<JwtUser>(token);
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré');
    }

    req.user = payload;

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (roles?.length && !roles.includes(payload.role)) {
      throw new ForbiddenException('Accès refusé');
    }

    const tenantHeader = (req.headers['x-tenant-id'] as string | undefined)?.trim();
    if (payload.tenantId && tenantHeader && payload.tenantId !== tenantHeader) {
      throw new ForbiddenException('Tenant incohérent');
    }

    return true;
  }
}
