import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { PushNotificationService } from '@/modules/push-notification.service';

type CommunicationPayload = Record<string, unknown>;

type DocumentItem = {
  url: string;
  nom: string;
  mimeType: string;
  taille: number;
};

type CommunicationRow = {
  id: string;
  tenantId: string;
  titre: string;
  contenu: string;
  canal: string;
  statut: string;
  cibleType: string;
  cible: string | null;
  roles: unknown;
  classeIds: unknown;
  niveauIds: unknown;
  cycleIds: unknown;
  utilisateurIds: unknown;
  inclureParents: boolean;
  inclureEleves: boolean;
  nbDestinataires: number;
  nbLus: number;
  documentUrl: string | null;
  documentNom: string | null;
  documentMimeType: string | null;
  documentTaille: number | null;
  documents: unknown;
  anneeAcademiqueId: string | null;
  datePlanifiee: Date | null;
  envoyeLe: Date | null;
  auteurId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RecipientRow = {
  id: string;
  role: string;
  email: string | null;
  telephone: string | null;
};

const PERSONNEL_ROLES = ['RH', 'COMPTABLE', 'CAISSIER', 'SURVEILLANT', 'SECURITE'];
const MAX_DOCUMENT_BYTES = 10_000_000;
const ALLOWED_DOCUMENT_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const DOCUMENT_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

@Injectable()
export class CommunicationService {
  private communicationsTableReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly push: PushNotificationService,
  ) {}

  async list(tenantId: string, query: Record<string, unknown> = {}) {
    await this.ensureCommunicationsTable();
    const statut = this.clean(query.statut);
    const canal = this.clean(query.canal);
    const cible = this.clean(query.cible).toUpperCase();
    const anneeAcademiqueId = this.clean(query.anneeAcademiqueId ?? query.anneeId);
    const where: Prisma.Sql[] = [Prisma.sql`"tenantId" = ${tenantId}::uuid`];
    if (statut && statut !== 'TOUS') where.push(Prisma.sql`"statut" = ${statut}`);
    if (canal && canal !== 'TOUS') where.push(Prisma.sql`"canal" = ${this.normalizeCanal(canal)}`);
    if (cible && cible !== 'TOUS') where.push(Prisma.sql`"cible" = ${cible}`);
    if (anneeAcademiqueId && /^[0-9a-f-]{36}$/i.test(anneeAcademiqueId)) {
      where.push(Prisma.sql`"anneeAcademiqueId" = ${anneeAcademiqueId}::uuid`);
    }

    const rows = await this.prisma.$queryRaw<CommunicationRow[]>`
      SELECT *
      FROM "communications"
      WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY "createdAt" DESC
      LIMIT 200
    `;
    return rows.map((row) => this.serialize(row));
  }

  async preview(tenantId: string, payload: CommunicationPayload) {
    const recipients = await this.resolveRecipients(tenantId, payload);
    const parRole = recipients.reduce<Record<string, number>>((acc, user) => {
      acc[user.role] = (acc[user.role] ?? 0) + 1;
      return acc;
    }, {});
    return { total: recipients.length, parRole };
  }

  async create(tenantId: string, payload: CommunicationPayload, auteurId?: string) {
    await this.ensureCommunicationsTable();
    const titre = this.clean(payload.titre).slice(0, 200);
    const contenu = this.clean(payload.contenu);
    if (titre.length < 2) throw new BadRequestException('Titre requis');
    if (contenu.length < 2) throw new BadRequestException('Contenu requis');

    const normalized = this.normalizeTarget(payload);
    const canal = this.normalizeCanal(this.clean(payload.canal || 'IN_APP'));
    const brouillon = payload.brouillon === true || this.clean(payload.statut).toUpperCase() === 'BROUILLON';
    const envoiImmediat = payload.envoiImmediat !== false && !brouillon;
    const datePlanifiee = this.clean(payload.dateEnvoi || payload.datePlanifiee);
    const recipients = await this.resolveRecipients(tenantId, payload);
    const statut = brouillon ? 'BROUILLON' : envoiImmediat ? 'ENVOYE' : 'PLANIFIE';
    const safeAuteurId = auteurId && /^[0-9a-f-]{36}$/i.test(auteurId) ? auteurId : null;
    const safeAnneeId = this.clean(payload.anneeAcademiqueId ?? payload.anneeId);
    const anneeAcademiqueId = safeAnneeId && /^[0-9a-f-]{36}$/i.test(safeAnneeId) ? safeAnneeId : null;
    const documents = await this.storeMultipleDocuments(tenantId, payload);
    const firstDoc = documents[0] ?? null;

    const [row] = await this.prisma.$queryRaw<CommunicationRow[]>`
      INSERT INTO "communications" (
        "tenantId", "titre", "contenu", "canal", "statut", "cibleType", "cible",
        "roles", "classeIds", "niveauIds", "cycleIds", "utilisateurIds",
        "inclureParents", "inclureEleves", "nbDestinataires", "datePlanifiee",
        "envoyeLe", "auteurId", "documentUrl", "documentNom", "documentMimeType",
        "documentTaille", "documents", "anneeAcademiqueId", "updatedAt"
      )
      VALUES (
        ${tenantId}::uuid, ${titre}, ${contenu}, ${canal}, ${statut}, ${normalized.cibleType}, ${normalized.cible},
        ${JSON.stringify(normalized.roles)}::jsonb, ${JSON.stringify(normalized.classeIds)}::jsonb,
        ${JSON.stringify(normalized.niveauIds)}::jsonb, ${JSON.stringify(normalized.cycleIds)}::jsonb,
        ${JSON.stringify(normalized.utilisateurIds)}::jsonb, ${normalized.inclureParents}, ${normalized.inclureEleves},
        ${recipients.length}, ${datePlanifiee ? new Date(datePlanifiee) : null},
        ${envoiImmediat ? new Date() : null}, ${safeAuteurId}::uuid, ${firstDoc?.url ?? null},
        ${firstDoc?.nom ?? null}, ${firstDoc?.mimeType ?? null}, ${firstDoc?.taille ?? null},
        ${JSON.stringify(documents)}::jsonb, ${anneeAcademiqueId}::uuid, NOW()
      )
      RETURNING *
    `;

    if (envoiImmediat && recipients.length) {
      await this.createNotifications(tenantId, row.id, titre, contenu, recipients, canal, row.documentUrl);
    }

    return this.serialize(row);
  }

  async update(tenantId: string, id: string, payload: CommunicationPayload) {
    await this.ensureCommunicationsTable();
    const existing = await this.findOne(tenantId, id);

    const titre = payload.titre !== undefined ? this.clean(payload.titre).slice(0, 200) : existing.titre;
    const contenu = payload.contenu !== undefined ? this.clean(payload.contenu) : existing.contenu;
    if (titre.length < 2) throw new BadRequestException('Titre requis');
    if (contenu.length < 2) throw new BadRequestException('Contenu requis');

    const normalized = this.normalizeTarget({ ...existing, ...payload });

    // Recalcule les documents uniquement si le payload en contient de nouveaux
    const hasNewDocs = Array.isArray(payload.documents) || !!this.clean(payload.documentBase64 ?? payload.fileBase64);
    const newDocs = hasNewDocs ? await this.storeMultipleDocuments(tenantId, payload) : null;

    const finalDocs = newDocs ?? (Array.isArray(existing.documents) ? (existing.documents as DocumentItem[]) : []);
    const firstDoc = finalDocs[0] ?? null;

    const [row] = await this.prisma.$queryRaw<CommunicationRow[]>`
      UPDATE "communications"
      SET
        "titre" = ${titre},
        "contenu" = ${contenu},
        "cibleType" = ${normalized.cibleType},
        "cible" = ${normalized.cible},
        "roles" = ${JSON.stringify(normalized.roles)}::jsonb,
        "classeIds" = ${JSON.stringify(normalized.classeIds)}::jsonb,
        "utilisateurIds" = ${JSON.stringify(normalized.utilisateurIds)}::jsonb,
        "inclureParents" = ${normalized.inclureParents},
        "inclureEleves" = ${normalized.inclureEleves},
        "documentUrl" = ${firstDoc?.url ?? null},
        "documentNom" = ${firstDoc?.nom ?? null},
        "documentMimeType" = ${firstDoc?.mimeType ?? null},
        "documentTaille" = ${firstDoc?.taille ?? null},
        "documents" = ${JSON.stringify(finalDocs)}::jsonb,
        "updatedAt" = NOW()
      WHERE "id" = ${id}::uuid AND "tenantId" = ${tenantId}::uuid
      RETURNING *
    `;
    return this.serialize(row);
  }

  async delete(tenantId: string, id: string) {
    await this.ensureCommunicationsTable();
    await this.findOne(tenantId, id); // vérifie existence + tenant
    await this.prisma.$executeRaw`
      DELETE FROM "communications"
      WHERE "id" = ${id}::uuid AND "tenantId" = ${tenantId}::uuid
    `;
    return { deleted: true };
  }

  async send(tenantId: string, id: string) {
    await this.ensureCommunicationsTable();
    const communication = await this.findOne(tenantId, id);
    if (communication.statut === 'ENVOYE') return this.serialize(communication);

    const recipients = await this.resolveRecipients(tenantId, {
      cible: communication.cible,
      cibleType: communication.cibleType,
      roles: communication.roles,
      classeIds: communication.classeIds,
      niveauIds: communication.niveauIds,
      cycleIds: communication.cycleIds,
      utilisateurIds: communication.utilisateurIds,
      inclureParents: communication.inclureParents,
      inclureEleves: communication.inclureEleves,
    });

    await this.createNotifications(tenantId, id, communication.titre, communication.contenu, recipients, communication.canal, communication.documentUrl);
    const [updated] = await this.prisma.$queryRaw<CommunicationRow[]>`
      UPDATE "communications"
      SET "statut" = 'ENVOYE', "envoyeLe" = NOW(), "nbDestinataires" = ${recipients.length}, "updatedAt" = NOW()
      WHERE "id" = ${id}::uuid AND "tenantId" = ${tenantId}::uuid
      RETURNING *
    `;
    return this.serialize(updated);
  }

  private async findOne(tenantId: string, id: string) {
    await this.ensureCommunicationsTable();
    const [row] = await this.prisma.$queryRaw<CommunicationRow[]>`
      SELECT *
      FROM "communications"
      WHERE "id" = ${id}::uuid AND "tenantId" = ${tenantId}::uuid
      LIMIT 1
    `;
    if (!row) throw new NotFoundException('Communication introuvable');
    return row;
  }

  private async createNotifications(tenantId: string, communicationId: string, titre: string, contenu: string, recipients: RecipientRow[], canal: string, documentUrl?: string | null) {
    if (!recipients.length) return;
    const contenuNotification = documentUrl ? `${contenu}\n\nDocument: ${documentUrl}` : contenu;
    await this.prisma.notification.createMany({
      data: recipients.map((user) => ({ tenantId, destinataireId: user.id, titre, contenu: contenuNotification, lu: false })),
    });

    await this.prisma.notificationLog.create({
      data: {
        tenantId,
        canal: canal === 'NOTIFICATION' ? 'IN_APP' : canal as 'EMAIL' | 'SMS' | 'WHATSAPP' | 'IN_APP',
        destinataire: `${recipients.length} destinataire(s)`,
        sujet: titre,
        contenu: contenuNotification,
        statut: 'ENVOYE',
        envoyeLe: new Date(),
      },
    });

    await this.push.sendToUsers(tenantId, recipients.map((user) => user.id), {
      title: titre,
      body: contenuNotification,
      data: { type: 'communication', communicationId },
    }).catch(() => undefined);
  }

  private async ensureCommunicationsTable(): Promise<void> {
    if (this.communicationsTableReady) return;
    await this.prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await this.prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "communications" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
        "titre" VARCHAR(200) NOT NULL,
        "contenu" TEXT NOT NULL,
        "canal" VARCHAR(20) NOT NULL DEFAULT 'IN_APP',
        "statut" VARCHAR(20) NOT NULL DEFAULT 'BROUILLON',
        "cibleType" VARCHAR(30) NOT NULL DEFAULT 'ROLES',
        "cible" VARCHAR(40),
        "roles" JSONB,
        "classeIds" JSONB,
        "niveauIds" JSONB,
        "cycleIds" JSONB,
        "utilisateurIds" JSONB,
        "inclureParents" BOOLEAN NOT NULL DEFAULT false,
        "inclureEleves" BOOLEAN NOT NULL DEFAULT true,
        "nbDestinataires" INTEGER NOT NULL DEFAULT 0,
        "nbLus" INTEGER NOT NULL DEFAULT 0,
        "documentUrl" TEXT,
        "documentNom" VARCHAR(300),
        "documentMimeType" VARCHAR(120),
        "documentTaille" INTEGER,
        "datePlanifiee" TIMESTAMP(3),
        "envoyeLe" TIMESTAMP(3),
        "auteurId" UUID,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await this.prisma.$executeRaw`
      ALTER TABLE "communications"
        ADD COLUMN IF NOT EXISTS "documentUrl" TEXT,
        ADD COLUMN IF NOT EXISTS "documentNom" VARCHAR(300),
        ADD COLUMN IF NOT EXISTS "documentMimeType" VARCHAR(120),
        ADD COLUMN IF NOT EXISTS "documentTaille" INTEGER,
        ADD COLUMN IF NOT EXISTS "documents" JSONB,
        ADD COLUMN IF NOT EXISTS "anneeAcademiqueId" UUID
    `;
    await this.prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "communications_tenantId_statut_createdAt_idx"
      ON "communications" ("tenantId", "statut", "createdAt")
    `;
    await this.prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "communications_tenantId_canal_idx"
      ON "communications" ("tenantId", "canal")
    `;
    this.communicationsTableReady = true;
  }

  private async resolveRecipients(tenantId: string, payload: CommunicationPayload): Promise<RecipientRow[]> {
    const target = this.normalizeTarget(payload);
    if (target.cibleType === 'UTILISATEURS' && target.utilisateurIds.length) {
      return this.usersByIds(tenantId, target.utilisateurIds);
    }
    if (target.cibleType === 'CLASSES' && target.classeIds.length) {
      return this.usersByClasses(tenantId, target.classeIds, target.inclureEleves, target.inclureParents);
    }
    const roles = target.roles.length ? target.roles : this.rolesForCible(target.cible);
    return this.usersByRoles(tenantId, roles);
  }

  private usersByRoles(tenantId: string, roles: string[]) {
    const cleanRoles = [...new Set(roles.map((role) => role.trim().toUpperCase()).filter(Boolean))];
    if (!cleanRoles.length) return Promise.resolve([]);
    return this.prisma.$queryRaw<RecipientRow[]>`
      SELECT "id", "role"::text AS "role", "email", "telephone"
      FROM "User"
      WHERE "tenantId" = ${tenantId}::uuid AND "actif" = true AND "role"::text IN (${Prisma.join(cleanRoles)})
      ORDER BY "role"::text, "lastName", "firstName"
    `;
  }

  private usersByIds(tenantId: string, ids: string[]) {
    const cleanIds = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
    if (!cleanIds.length) return Promise.resolve([]);
    return this.prisma.$queryRaw<RecipientRow[]>`
      SELECT "id", "role"::text AS "role", "email", "telephone"
      FROM "User"
      WHERE "tenantId" = ${tenantId}::uuid AND "actif" = true AND "id"::text IN (${Prisma.join(cleanIds)})
      ORDER BY "role"::text, "lastName", "firstName"
    `;
  }

  private async usersByClasses(tenantId: string, classeIds: string[], includeEleves: boolean, includeParents: boolean) {
    const cleanIds = [...new Set(classeIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
    if (!cleanIds.length) return [];
    const rows: RecipientRow[] = [];
    if (includeEleves) {
      rows.push(...await this.prisma.$queryRaw<RecipientRow[]>`
        SELECT "id", "role"::text AS "role", "email", "telephone"
        FROM "User"
        WHERE "tenantId" = ${tenantId}::uuid AND "actif" = true AND "role" = 'ELEVE' AND "classeId"::text IN (${Prisma.join(cleanIds)})
      `);
    }
    if (includeParents) {
      rows.push(...await this.prisma.$queryRaw<RecipientRow[]>`
        SELECT DISTINCT p."id", p."role"::text AS "role", p."email", p."telephone"
        FROM "EleveParent" ep
        JOIN "User" e ON e."id" = ep."eleveId"
        JOIN "User" p ON p."id" = ep."parentId"
        WHERE e."tenantId" = ${tenantId}::uuid
          AND p."tenantId" = ${tenantId}::uuid
          AND p."actif" = true
          AND e."classeId"::text IN (${Prisma.join(cleanIds)})
      `);
    }
    return [...new Map(rows.map((user) => [user.id, user])).values()];
  }

  private normalizeTarget(payload: CommunicationPayload) {
    const cible = this.clean(payload.cible || payload.target || 'TOUS').toUpperCase();
    const roles = this.arrayOfStrings(payload.roles);
    const classeIds = this.arrayOfStrings(payload.classeIds ?? payload.classesIds ?? payload.classeId);
    const niveauIds = this.arrayOfStrings(payload.niveauIds ?? payload.niveauId);
    const cycleIds = this.arrayOfStrings(payload.cycleIds ?? payload.cycleId);
    const utilisateurIds = this.arrayOfStrings(payload.utilisateurIds ?? payload.userIds ?? payload.utilisateurId);
    const cibleType = utilisateurIds.length ? 'UTILISATEURS' : classeIds.length || cible === 'CLASSE' ? 'CLASSES' : roles.length ? 'ROLES' : 'ROLES';
    return {
      cible,
      cibleType,
      roles: roles.length ? roles : this.rolesForCible(cible),
      classeIds,
      niveauIds,
      cycleIds,
      utilisateurIds,
      inclureParents: payload.inclureParents !== false && (cible === 'CLASSE' || payload.inclureParents === true),
      inclureEleves: payload.inclureEleves !== false,
    };
  }

  private rolesForCible(cible: string): string[] {
    switch (cible) {
      case 'ELEVES': return ['ELEVE'];
      case 'PARENTS': return ['PARENT'];
      case 'ENSEIGNANTS': return ['ENSEIGNANT'];
      case 'RH': return ['RH'];
      case 'COMPTABLES': return ['COMPTABLE'];
      case 'CAISSIERS': return ['CAISSIER'];
      case 'SURVEILLANTS': return ['SURVEILLANT'];
      case 'SECURITE': return ['SECURITE'];
      case 'PERSONNEL': return PERSONNEL_ROLES;
      case 'ADMINISTRATION': return ['ADMIN'];
      case 'TOUS':
      default:
        return ['ADMIN', 'RH', 'COMPTABLE', 'CAISSIER', 'SURVEILLANT', 'SECURITE', 'ENSEIGNANT', 'ELEVE', 'PARENT'];
    }
  }

  private normalizeCanal(value: string) {
    const canal = value.trim().toUpperCase();
    if (canal === 'NOTIFICATION') return 'IN_APP';
    void canal;
    return 'IN_APP';
  }

  private clean(value: unknown) {
    return String(value ?? '').trim();
  }

  private arrayOfStrings(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => this.clean(item)).filter(Boolean);
    const clean = this.clean(value);
    if (!clean) return [];
    return clean.split(',').map((item) => item.trim()).filter(Boolean);
  }

  private async storeMultipleDocuments(tenantId: string, payload: CommunicationPayload): Promise<DocumentItem[]> {
    // Accepte documents[] (tableau) ou document unique (documentBase64 / fileBase64)
    const items: Array<{ base64: string; mimeType: string; nom: string }> = [];

    if (Array.isArray(payload.documents)) {
      for (const doc of payload.documents as CommunicationPayload[]) {
        const base64 = this.clean(doc.base64 ?? doc.documentBase64 ?? doc.fileBase64);
        const mimeType = this.clean(doc.mimeType ?? doc.documentMimeType);
        const nom = this.clean(doc.nom ?? doc.documentNom ?? doc.name ?? 'document');
        if (base64 && mimeType) items.push({ base64, mimeType, nom });
      }
    }

    // Compatibilité ascendante : champ documentBase64 unique
    const singleBase64 = this.clean(payload.documentBase64 ?? payload.fileBase64);
    if (singleBase64 && !items.length) {
      const mimeType = this.clean(payload.documentMimeType ?? payload.mimeType);
      const nom = this.clean(payload.documentNom ?? payload.documentName ?? payload.nomFichier ?? 'document');
      items.push({ base64: singleBase64, mimeType, nom });
    }

    const results: DocumentItem[] = [];
    for (const item of items) {
      if (!ALLOWED_DOCUMENT_MIME.has(item.mimeType)) {
        throw new BadRequestException(`Type de fichier non autorisé: ${item.mimeType || 'inconnu'}`);
      }
      const fileBase64 = item.base64.includes(',') ? item.base64.split(',').pop() ?? '' : item.base64;
      const buffer = Buffer.from(fileBase64, 'base64');
      if (!buffer.length) throw new BadRequestException('Document joint invalide');
      if (buffer.length > MAX_DOCUMENT_BYTES) throw new BadRequestException('Document trop volumineux (max 10 Mo)');

      const nom = (item.nom || 'document').slice(0, 300);
      const ext = DOCUMENT_MIME_EXT[item.mimeType] ?? '';
      const key = `${tenantId}/communications/${new Date().getFullYear()}/${randomUUID()}${ext}`;
      const stored = await this.storage.upload(key, buffer, item.mimeType);
      results.push({
        url: this.storage.resolveUrl(stored) ?? stored,
        nom,
        mimeType: item.mimeType,
        taille: buffer.length,
      });
    }
    return results;
  }

  private serialize(row: CommunicationRow) {
    const rawDocuments = Array.isArray(row.documents) ? (row.documents as DocumentItem[]) : [];
    // Si le champ documents est vide mais qu'un document legacy existe, on le reconstruit
    const documents: DocumentItem[] = rawDocuments.length > 0
      ? rawDocuments
      : row.documentUrl
        ? [{ url: row.documentUrl, nom: row.documentNom ?? '', mimeType: row.documentMimeType ?? '', taille: row.documentTaille ?? 0 }]
        : [];

    return {
      ...row,
      canal: row.canal === 'IN_APP' ? 'NOTIFICATION' : row.canal,
      dateEnvoi: row.envoyeLe ?? row.datePlanifiee,
      dateCreation: row.createdAt,
      document: documents[0] ?? null,
      documents,
    };
  }
}
