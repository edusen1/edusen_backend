import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { StatutDemande } from '@prisma/client';
import { StorageService } from '@/infrastructure/storage/storage.service';

export interface CreateDemandeReductionDto {
  eleveId: string;
  inscriptionId?: string;
  pourcentage: number;
  motif: string;
  commentaireAdmin?: string;
}

const ELEVE_SELECT = { id: true, firstName: true, lastName: true, matricule: true, photoUrl: true };
const USER_SELECT  = { id: true, firstName: true, lastName: true, email: true, role: true };

@Injectable()
export class DemandeReductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(tenantId: string, dto: CreateDemandeReductionDto, demandePar: string): Promise<unknown> {
    this.validateCreateDto(dto);
    const demande = await this.prisma.demandeReduction.create({
      data: {
        tenantId,
        eleveId: dto.eleveId,
        inscriptionId: dto.inscriptionId ?? null,
        pourcentage: dto.pourcentage,
        motif: dto.motif.trim(),
        statut: StatutDemande.EN_ATTENTE,
        demandePar,
      },
      include: {
        eleve: { select: ELEVE_SELECT },
        demandeParUser: { select: USER_SELECT },
      },
    });
    return this.resolveElevePhoto(demande);
  }

  async createApproved(tenantId: string, dto: CreateDemandeReductionDto, adminId: string): Promise<unknown> {
    this.validateCreateDto(dto);
    const demande = await this.prisma.demandeReduction.create({
      data: {
        tenantId,
        eleveId: dto.eleveId,
        inscriptionId: dto.inscriptionId ?? null,
        pourcentage: dto.pourcentage,
        motif: dto.motif.trim(),
        statut: StatutDemande.APPROUVEE,
        demandePar: adminId,
        traitePar: adminId,
        commentaireAdmin: dto.commentaireAdmin?.trim() || 'Réduction appliquée directement par l’administration',
      },
      include: {
        eleve: { select: ELEVE_SELECT },
        demandeParUser: { select: USER_SELECT },
        traiteParUser: { select: USER_SELECT },
        inscription: { select: { id: true, numeroInscription: true, classe: { select: { nom: true } } } },
      },
    });
    return this.resolveElevePhoto(demande);
  }

  private validateCreateDto(dto: CreateDemandeReductionDto): void {
    if (dto.pourcentage <= 0 || dto.pourcentage > 100) {
      throw new BadRequestException('Le pourcentage doit être entre 1 et 100');
    }
    if (!dto.motif?.trim()) {
      throw new BadRequestException('Le motif est obligatoire');
    }
  }

  async findAll(tenantId: string, statut?: string, eleveId?: string): Promise<unknown[]> {
    const demandes = await this.prisma.demandeReduction.findMany({
      where: {
        tenantId,
        ...(statut ? { statut: statut as StatutDemande } : {}),
        ...(eleveId ? { eleveId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        eleve: { select: ELEVE_SELECT },
        demandeParUser: { select: USER_SELECT },
        traiteParUser: { select: USER_SELECT },
        inscription: { select: { id: true, numeroInscription: true, classe: { select: { nom: true } } } },
      },
    });
    return demandes.map((demande) => this.resolveElevePhoto(demande));
  }

  async findMine(tenantId: string, userId: string): Promise<unknown[]> {
    const demandes = await this.prisma.demandeReduction.findMany({
      where: { tenantId, demandePar: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        eleve: { select: ELEVE_SELECT },
        traiteParUser: { select: USER_SELECT },
        inscription: { select: { id: true, numeroInscription: true, classe: { select: { nom: true } } } },
      },
    });
    return demandes.map((demande) => this.resolveElevePhoto(demande));
  }

  async approuver(tenantId: string, id: string, adminId: string, commentaire?: string): Promise<unknown> {
    const demande = await this.findOne(tenantId, id);
    if ((demande as { statut: string }).statut !== StatutDemande.EN_ATTENTE) {
      throw new BadRequestException('Cette demande a déjà été traitée');
    }
    const demandeUpdated = await this.prisma.demandeReduction.update({
      where: { id },
      data: { statut: StatutDemande.APPROUVEE, traitePar: adminId, commentaireAdmin: commentaire ?? null },
      include: {
        eleve: { select: ELEVE_SELECT },
        traiteParUser: { select: USER_SELECT },
      },
    });
    return this.resolveElevePhoto(demandeUpdated);
  }

  async rejeter(tenantId: string, id: string, adminId: string, commentaire: string): Promise<unknown> {
    const demande = await this.findOne(tenantId, id);
    if ((demande as { statut: string }).statut !== StatutDemande.EN_ATTENTE) {
      throw new BadRequestException('Cette demande a déjà été traitée');
    }
    if (!commentaire?.trim()) {
      throw new BadRequestException('Un motif de rejet est obligatoire');
    }
    const demandeUpdated = await this.prisma.demandeReduction.update({
      where: { id },
      data: { statut: StatutDemande.REJETEE, traitePar: adminId, commentaireAdmin: commentaire.trim() },
      include: {
        eleve: { select: ELEVE_SELECT },
        traiteParUser: { select: USER_SELECT },
      },
    });
    return this.resolveElevePhoto(demandeUpdated);
  }

  private async findOne(tenantId: string, id: string) {
    const d = await this.prisma.demandeReduction.findFirst({ where: { id, tenantId } });
    if (!d) throw new NotFoundException('Demande introuvable');
    return d;
  }

  private resolveElevePhoto<T extends { eleve?: { photoUrl?: string | null } | null }>(demande: T): T {
    if (!demande.eleve?.photoUrl) return demande;
    return {
      ...demande,
      eleve: {
        ...demande.eleve,
        photoUrl: this.storage.resolveUrl(demande.eleve.photoUrl) ?? demande.eleve.photoUrl,
      },
    };
  }
}
