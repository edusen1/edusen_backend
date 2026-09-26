import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';

export interface CreateFournitureDto {
  niveauId: string;
  nom: string;
  quantite?: number;
  description?: string;
  obligatoire?: boolean;
  ordre?: number;
}

export interface UpdateFournitureDto {
  nom?: string;
  quantite?: number;
  description?: string;
  obligatoire?: boolean;
  ordre?: number;
}

@Injectable()
export class FournitureService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    const niveaux = await this.prisma.niveau.findMany({
      where: { tenantId, actif: true },
      select: {
        id: true,
        libelle: true,
        code: true,
        ordre: true,
        fournitures: {
          where: { tenantId },
          orderBy: [{ ordre: 'asc' }, { nom: 'asc' }],
        },
      },
      orderBy: { ordre: 'asc' },
    });
    return niveaux;
  }

  async findByNiveau(tenantId: string, niveauId: string) {
    return this.prisma.fourniture.findMany({
      where: { tenantId, niveauId },
      orderBy: [{ ordre: 'asc' }, { nom: 'asc' }],
    });
  }

  async create(tenantId: string, dto: CreateFournitureDto) {
    const niveau = await this.prisma.niveau.findFirst({
      where: { id: dto.niveauId, tenantId },
    });
    if (!niveau) throw new NotFoundException('Niveau introuvable');

    if (!dto.nom?.trim()) throw new BadRequestException('Le nom de la fourniture est requis');

    return this.prisma.fourniture.create({
      data: {
        tenantId,
        niveauId: dto.niveauId,
        nom: dto.nom.trim(),
        quantite: dto.quantite ?? 1,
        description: dto.description?.trim() ?? null,
        obligatoire: dto.obligatoire ?? true,
        ordre: dto.ordre ?? 0,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateFournitureDto) {
    const existing = await this.prisma.fourniture.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Fourniture introuvable');

    return this.prisma.fourniture.update({
      where: { id },
      data: {
        ...(dto.nom !== undefined ? { nom: dto.nom.trim() } : {}),
        ...(dto.quantite !== undefined ? { quantite: dto.quantite } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() ?? null } : {}),
        ...(dto.obligatoire !== undefined ? { obligatoire: dto.obligatoire } : {}),
        ...(dto.ordre !== undefined ? { ordre: dto.ordre } : {}),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.fourniture.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Fourniture introuvable');
    await this.prisma.fourniture.delete({ where: { id } });
    return { deleted: true };
  }

  /** Retourne les fournitures pour un niveau donné (utilisé lors de l'inscription) */
  async findForNiveau(tenantId: string, niveauId: string | null | undefined) {
    if (!niveauId) return [];
    return this.prisma.fourniture.findMany({
      where: { tenantId, niveauId },
      orderBy: [{ ordre: 'asc' }, { nom: 'asc' }],
    });
  }
}
