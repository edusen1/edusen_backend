import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppLoggerService } from '@/common/logger/app-logger.service';
import { RequestContextService } from '@/common/performance/request-context.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly requestContext: RequestContextService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const res = ctx.getResponse<FastifyReply>();

    const correlationId = this.getCorrelationId(req);
    res.header('x-correlation-id', correlationId);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const code = this.getHttpCode(status, response);
      const message =
        typeof response === 'string'
          ? response
          : (response as { message?: string | string[] }).message ?? 'Erreur';
      const publicMessage = this.toPublicMessage(message, status);

      this.logHttpException(exception, status, code, message, req, correlationId);
      res.status(status).send({
        code,
        message: publicMessage,
        correlationId,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const status = this.mapPrismaStatus(exception.code);
      if (exception.code === 'P1001') {
        res.header('retry-after', '3');
      }
      this.logger.warn(
        `[PrismaError] code=${exception.code} status=${status} method=${req.method} path=${req.url} correlationId=${correlationId}`,
        GlobalExceptionFilter.name,
      );
      res.status(status).send({
        code: `PRISMA_${exception.code}`,
        message: this.mapPrismaMessage(exception),
        correlationId,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.warn(
        `[PrismaValidationError] method=${req.method} path=${req.url} correlationId=${correlationId}`,
        GlobalExceptionFilter.name,
      );
      res.status(HttpStatus.BAD_REQUEST).send({
        code: 'PRISMA_VALIDATION_ERROR',
        message: 'Données invalides pour cette opération',
        correlationId,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    this.logger.error(
      `[UnhandledError] method=${req.method} path=${req.url} correlationId=${correlationId}`,
      exception instanceof Error ? exception.stack : undefined,
      GlobalExceptionFilter.name,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Une erreur inattendue est survenue',
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }

  private getCorrelationId(req: FastifyRequest): string {
    const activeContext = this.requestContext.get();
    if (activeContext?.correlationId) return activeContext.correlationId;

    const header = req.headers['x-correlation-id'];
    const value = Array.isArray(header) ? header[0] : header;

    return typeof value === 'string' && value.trim() ? value.trim() : randomUUID();
  }

  private getHttpCode(status: number, response: string | object): string {
    if (typeof response === 'object' && response !== null) {
      const body = response as { code?: unknown };
      if (typeof body.code === 'string' && body.code.trim()) {
        return body.code.trim();
      }
    }

    return HttpStatus[status] ?? 'HTTP_ERROR';
  }

  private logHttpException(
    exception: HttpException,
    status: number,
    code: string,
    message: string | string[],
    req: FastifyRequest,
    correlationId: string,
  ): void {
    const printableMessage = Array.isArray(message) ? message.join('; ') : message;
    const logMessage = `[HttpException] status=${status} code=${code} method=${req.method} path=${req.url} correlationId=${correlationId} message=${printableMessage}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(logMessage, exception.stack, GlobalExceptionFilter.name);
      return;
    }

    this.logger.warn(logMessage, GlobalExceptionFilter.name);
  }

  private toPublicMessage(message: string | string[], status: number): string {
    const values = Array.isArray(message) ? message : [message];
    const normalized = values
      .map((value) => this.mapKnownMessage(String(value ?? '').trim(), status))
      .filter(Boolean);

    if (!normalized.length) return 'Erreur';
    return Array.from(new Set(normalized)).join('. ');
  }

  private mapKnownMessage(message: string, status: number): string {
    const dictionary: Record<string, string> = {
      COMPTE_VERROUILLE: 'Compte temporairement bloqué',
      IDENTIFIANTS_AMBIGUS: 'Email ou mot de passe incorrect',
      IDENTIFIANTS_INVALIDES: 'Email ou mot de passe incorrect',
      USER_INACTIVE: 'Compte désactivé',
      TENANT_INACTIF: 'Établissement désactivé',
      REFRESH_TOKEN_INVALID: 'Session invalide',
      REFRESH_TOKEN_EXPIRED: 'Session expirée',
      EMAIL_DEJA_UTILISE: 'Email déjà utilisé',
      TOO_MANY_REQUESTS: 'Trop de demandes',
      RESET_TOKEN_INVALIDE: 'Lien invalide ou expiré',
      MOT_DE_PASSE_TROP_COURT: 'Mot de passe trop court',
      MOT_DE_PASSE_ACTUEL_INCORRECT: 'Mot de passe actuel incorrect',
      NOUVEAU_MOT_DE_PASSE_IDENTIQUE: 'Choisissez un autre mot de passe',
      CLASSE_INTROUVABLE: 'Classe introuvable',
      CLASSE_ANNEE_INVALIDE: 'Classe invalide pour cette année',
      CLASSE_NON_AUTORISEE: 'Classe non autorisée',
      DEMANDE_PASSAGE_REQUISE: 'Demande de passage requise',
    };

    if (dictionary[message]) return dictionary[message];

    if (message.startsWith('INSCRIPTION_DEJA_EXISTANTE')) {
      return 'Élève déjà inscrit cette année';
    }
    if (message.startsWith('IMPAYES_PRECEDENTS')) {
      return 'Paiements précédents impayés';
    }
    if (message.startsWith('SUPPRESSION_INSCRIPTION_INTERDITE')) {
      return 'Désactivez cette inscription';
    }
    if (message.includes(': UUID attendu')) {
      return 'Identifiant invalide';
    }

    if (/^[A-Z0-9_:-]+$/.test(message)) {
      if (status === HttpStatus.UNAUTHORIZED) return 'Connexion requise';
      if (status === HttpStatus.FORBIDDEN) return 'Accès refusé';
      if (status === HttpStatus.NOT_FOUND) return 'Ressource introuvable';
      if (status === HttpStatus.CONFLICT) return 'Conflit de données';
      return 'Données invalides';
    }

    return this.shortenMessage(message);
  }

  private shortenMessage(message: string): string {
    const trimmed = message.trim();
    if (trimmed.length <= 90) return trimmed;
    return `${trimmed.slice(0, 87).trim()}...`;
  }

  private mapPrismaStatus(code: string): HttpStatus {
    if (code === 'P1001') return HttpStatus.SERVICE_UNAVAILABLE;
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
    if (code === 'P2002') {
      const fieldLabels: Record<string, string> = {
        email: 'email',
        matricule: 'matricule',
        telephone: 'téléphone',
        username: 'nom d\'utilisateur',
        numeroIdentificationNational: 'numéro d\'identification national',
      };
      const conflictField = target.find((f) => f in fieldLabels);
      if (conflictField) {
        return `Un enregistrement avec ce ${fieldLabels[conflictField]} existe déjà`;
      }
      return 'Donnée déjà existante';
    }
    if (code === 'P2025') return 'Ressource introuvable';
    if (code === 'P2023') return 'Identifiant invalide';
    if (code === 'P2022') return 'Donnée indisponible';
    if (code === 'P1001') return 'Service indisponible';
    return 'Enregistrement impossible';
  }
}
