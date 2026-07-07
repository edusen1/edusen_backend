import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '@/config/prisma.service';
import type { JwtUser } from '@/common/types/auth.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const RESOURCE_LABELS: Record<string, string> = {
  classes: 'classe',
  eleves: 'eleve',
  enseignants: 'enseignant',
  parents: 'parent',
  personnel: 'personnel',
  inscriptions: 'inscription',
  matieres: 'matiere',
  cours: 'cours',
  notes: 'note',
  bulletins: 'bulletin',
  paiements: 'paiement',
  'matieres-classes': 'matiereClasse',
  'matieres-niveaux': 'matiereNiveau',
  'annees-academiques': 'anneeAcademique',
  niveaux: 'niveau',
  sections: 'section',
  frais: 'frais',
  'emplois-du-temps': 'emploiDuTemps',
  'absences-eleves': 'absenceEleve',
  'absences-personnel': 'absencePersonnel',
  convocations: 'convocation',
  appels: 'appel',
  pointages: 'pointage',
  annonces: 'annonce',
  reclamations: 'reclamation',
  'cahiers-textes': 'cahierTexte',
  documents: 'document',
  'presences-professeurs': 'presenceProfesseur',
  'paiements-professeurs': 'paiementProfesseur',
  batiments: 'batiment',
  salles: 'salle',
  'calendrier-scolaire': 'calendrier',
  'absences-par-cours': 'absenceEleve',
  stagiaires: 'stagiaire',
};

const VERB_ACTIONS: Record<string, string> = {
  publier: 'PUBLICATION',
  approuver: 'APPROBATION',
  rejeter: 'REJET',
  activer: 'ACTIVATION',
  valider: 'VALIDATION',
  generer: 'GENERATION',
  logout: 'DECONNEXION',
  duplicata: 'DUPLICATA',
  repondre: 'REPONSE',
  dupliquer: 'DUPLICATION',
};

const SKIP_PREFIXES = ['/health', '/api/health', '/api/auth', '/auth', '/api/storage', '/storage'];
const TENANT_PREFIXES = ['admin', 'v1', 'caisse', 'enseignant', 'eleve', 'parent'];

function parsePath(url: string): { resourceType: string; resourceId: string | null; action: string } {
  const path = url.split('?')[0].replace(/^\/api/, '');
  const segments = path.split('/').filter(Boolean);

  if (!segments[0]) return { resourceType: 'unknown', resourceId: null, action: 'ACTION' };

  let rest = TENANT_PREFIXES.includes(segments[0]) ? segments.slice(1) : segments;

  if (rest[0] === 'configuration') rest = rest.slice(1);

  if (!rest[0]) return { resourceType: 'unknown', resourceId: null, action: 'ACTION' };

  const resourceSegment = rest[0];
  const resourceType = RESOURCE_LABELS[resourceSegment] ?? resourceSegment;

  const ids = rest.filter(isUuid);
  const resourceId = ids.length > 0 ? ids[ids.length - 1] : null;

  const lastSeg = rest[rest.length - 1];
  const isVerb = lastSeg && !isUuid(lastSeg) && lastSeg !== resourceSegment && !(lastSeg in RESOURCE_LABELS);
  const verbAction = isVerb ? (VERB_ACTIONS[lastSeg] ?? (lastSeg as string).toUpperCase()) : null;

  return { resourceType, resourceId, action: verbAction ?? 'METHOD' };
}

function methodToAction(method: string): string {
  switch (method) {
    case 'POST': return 'CREATION';
    case 'PUT': return 'MODIFICATION';
    case 'PATCH': return 'MODIFICATION';
    case 'DELETE': return 'SUPPRESSION';
    default: return method;
  }
}

function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const clone = { ...(body as Record<string, unknown>) };
  for (const key of ['password', 'motDePasse', 'token', 'secret', 'hash', 'tokenHash']) {
    if (key in clone) clone[key] = '[REDACTED]';
  }
  return clone;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtUser }>();
    const method = request.method;

    if (!MUTATION_METHODS.has(method)) return next.handle();
    if (SKIP_PREFIXES.some((p) => request.url.startsWith(p))) return next.handle();

    return next.handle().pipe(
      tap((response) => {
        void this.writeLog(request, method, response);
      }),
    );
  }

  private async writeLog(
    request: FastifyRequest & { user?: JwtUser },
    method: string,
    response: unknown,
  ): Promise<void> {
    try {
      const { resourceType, resourceId: urlId, action: verbAction } = parsePath(request.url);
      const action = verbAction === 'METHOD' ? methodToAction(method) : verbAction;

      let resourceId: string | null = urlId;
      if (!resourceId && method === 'POST') {
        const res = response as Record<string, unknown> | null;
        const id = res?.id ?? (res?.data as Record<string, unknown> | undefined)?.id;
        if (isUuid(id)) resourceId = id as string;
      }

      const user = request.user;
      const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim() || user?.tenantId;

      await this.prisma.auditLog.create({
        data: {
          tenantId: isUuid(tenantId) ? tenantId : null,
          utilisateurId: isUuid(user?.sub) ? user!.sub : null,
          role: user?.role ?? null,
          action,
          resourceType,
          resourceId: isUuid(resourceId) ? resourceId : null,
          details: {
            method,
            url: request.url.split('?')[0],
            body: sanitizeBody(request.body) as import('@prisma/client').Prisma.InputJsonValue,
          },
          ipAddress: typeof request.ip === 'string' ? request.ip.slice(0, 45) : null,
          userAgent: (request.headers['user-agent'] as string | undefined) ?? null,
        },
      });
    } catch {
      // Audit failure must never affect the response
    }
  }
}
