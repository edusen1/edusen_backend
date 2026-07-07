import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TypeDocument } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';

export const DOC_TYPE_LABELS: Record<TypeDocument, string> = {
  EXTRAIT_NAISSANCE: 'Extrait de naissance',
  PHOTO_CNI: 'Photo / CNI',
  VISITE_MEDICALE: 'Visite médicale',
  CARNET_SANTE: 'Carnet de santé',
  VACCINATION: 'Carnet de vaccination',
  DIPLOME: 'Diplôme / Attestation',
  PHOTO: 'Photo',
  AUTRE: 'Autre document',
};

const MAX_BYTES = 10_000_000; // 10 MB

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

@Injectable()
export class EleveDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async listDocuments(tenantId: string, eleveId: string) {
    const docs = await this.prisma.eleveDocument.findMany({
      where: { tenantId, eleveId },
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    });
    return docs.map((d) => ({
      id: d.id,
      type: d.type,
      typeLabel: DOC_TYPE_LABELS[d.type] ?? d.type,
      nom: d.nom,
      mimeType: d.mimeType,
      taille: d.taille,
      createdAt: d.createdAt,
    }));
  }

  async uploadDocument(
    tenantId: string,
    eleveId: string,
    uploadedById: string,
    input: { type: TypeDocument; nom: string; fileBase64: string; mimeType: string },
  ) {
    if (!ALLOWED_MIME.has(input.mimeType)) {
      throw new BadRequestException(`Type de fichier non autorisé: ${input.mimeType}`);
    }

    const eleve = await this.prisma.user.findFirst({
      where: { id: eleveId, tenantId, role: 'ELEVE' },
      select: { id: true },
    });
    if (!eleve) throw new NotFoundException('Élève introuvable');

    const buffer = Buffer.from(input.fileBase64, 'base64');
    if (buffer.length > MAX_BYTES) throw new BadRequestException('Fichier trop volumineux (max 10 Mo)');

    const ext = MIME_EXT[input.mimeType] ?? '';
    const key = `${tenantId}/eleves/${eleveId}/documents/${input.type}/${randomUUID()}${ext}`;
    await this.storage.upload(key, buffer, input.mimeType);

    const nom = input.nom.trim() || (DOC_TYPE_LABELS[input.type] ?? input.type);
    const doc = await this.prisma.eleveDocument.create({
      data: { tenantId, eleveId, type: input.type, nom, fileKey: key, mimeType: input.mimeType, taille: buffer.length, uploadedById },
    });

    return {
      id: doc.id,
      type: doc.type,
      typeLabel: DOC_TYPE_LABELS[doc.type],
      nom: doc.nom,
      mimeType: doc.mimeType,
      taille: doc.taille,
      createdAt: doc.createdAt,
    };
  }

  async getDownloadUrl(tenantId: string, eleveId: string, docId: string): Promise<{ url: string; nom: string }> {
    const doc = await this.prisma.eleveDocument.findFirst({ where: { id: docId, tenantId, eleveId } });
    if (!doc) throw new NotFoundException('Document introuvable');
    const url = await this.storage.getPresignedUrl(doc.fileKey, 900);
    return { url, nom: doc.nom };
  }

  async deleteDocument(tenantId: string, eleveId: string, docId: string): Promise<void> {
    const doc = await this.prisma.eleveDocument.findFirst({ where: { id: docId, tenantId, eleveId } });
    if (!doc) throw new NotFoundException('Document introuvable');
    await Promise.allSettled([
      this.storage.delete(doc.fileKey),
      this.prisma.eleveDocument.delete({ where: { id: docId } }),
    ]);
  }
}
