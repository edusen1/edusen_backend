import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: FastifyRequest, _res: FastifyReply, next: () => void): void {
    const tenantId = (req.headers['x-tenant-id'] as string | undefined)?.trim();
    (req as FastifyRequest & { tenantId?: string }).tenantId = tenantId;
    next();
  }
}
