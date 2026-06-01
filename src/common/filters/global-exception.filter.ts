import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const res = ctx.getResponse<FastifyReply>();

    const correlationId = (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : (response as { message?: string | string[] }).message ?? 'Erreur';

      res.status(status).send({
        code: HttpStatus[status] ?? 'HTTP_ERROR',
        message,
        correlationId,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const status = this.mapPrismaStatus(exception.code);
      this.logger.warn(`[PrismaError] code=${exception.code} correlationId=${correlationId}`);
      res.status(status).send({
        code: `PRISMA_${exception.code}`,
        message: this.mapPrismaMessage(exception),
        correlationId,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.warn(`[PrismaValidationError] correlationId=${correlationId} path=${req.url}`);
      res.status(HttpStatus.BAD_REQUEST).send({
        code: 'PRISMA_VALIDATION_ERROR',
        message: 'Données invalides pour cette opération',
        correlationId,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    this.logger.error(
      `[UnhandledError] correlationId=${correlationId} path=${req.url}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Une erreur inattendue est survenue',
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }

  private mapPrismaStatus(code: string): HttpStatus {
    if (code === 'P2002') return HttpStatus.CONFLICT;
    if (code === 'P2025') return HttpStatus.NOT_FOUND;
    if (code === 'P2023') return HttpStatus.BAD_REQUEST;
    return HttpStatus.BAD_REQUEST;
  }

  private mapPrismaMessage(exception: Prisma.PrismaClientKnownRequestError): string {
    const code = exception.code;
    const target = Array.isArray(exception.meta?.target) ? exception.meta.target.map(String) : [];
    if (
      code === 'P2002' &&
      ['tenantId', 'eleveId', 'anneeAcademiqueId'].every((field) => target.includes(field))
    ) {
      return 'INSCRIPTION_DEJA_EXISTANTE: cet élève est déjà inscrit pour cette année scolaire';
    }
    if (code === 'P2002') return 'Conflit de données: une valeur unique existe déjà';
    if (code === 'P2025') return 'Ressource introuvable';
    if (code === 'P2023') return 'Identifiant invalide: UUID attendu';
    return 'Erreur de persistance des données';
  }
}
