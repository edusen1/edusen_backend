import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';

@Injectable()
export class StructureService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== CYCLE ====================
  async createCycle(tenantId: string, dto: { code: string; libelle: string }): Promise<unknown> {
    const existing = await this.prisma.cycle.findFirst({ where: { tenantId, code: dto.code } });
    if (existing) throw new ConflictException('Code cycle déjà utilisé');
    return this.prisma.cycle.create({ data: { tenantId, ...dto } });
  }

  async findCycles(tenantId: string): Promise<unknown[]> {
    return this.prisma.cycle.findMany({
      where: { tenantId, actif: true },
      include: { niveaux: { orderBy: { ordre: 'asc' } } },
      orderBy: { code: 'asc' },
    });
  }

  async findCycle(tenantId: string, id: string): Promise<unknown> {
    const c = await this.prisma.cycle.findFirst({ where: { id, tenantId }, include: { niveaux: true } });
    if (!c) throw new NotFoundException('Cycle introuvable');
    return c;
  }

  async updateCycle(tenantId: string, id: string, dto: Partial<{ code: string; libelle: string; actif: boolean }>): Promise<unknown> {
    await this.findCycle(tenantId, id);
    return this.prisma.cycle.update({ where: { id }, data: dto });
  }

  async deleteCycle(tenantId: string, id: string): Promise<void> {
    await this.findCycle(tenantId, id);
    await this.prisma.cycle.delete({ where: { id } });
  }

  // ==================== NIVEAU ====================
  async createNiveau(tenantId: string, dto: { cycleId: string; code: string; libelle: string; ordre: number }): Promise<unknown> {
    const existing = await this.prisma.niveau.findFirst({ where: { tenantId, code: dto.code } });
    if (existing) throw new ConflictException('Code niveau déjà utilisé');
    return this.prisma.niveau.create({
      data: { tenantId, ...dto },
      include: { cycle: { select: { id: true, code: true, libelle: true } } },
    });
  }

  async findNiveaux(tenantId: string, cycleId?: string): Promise<unknown[]> {
    return this.prisma.niveau.findMany({
      where: { tenantId, actif: true, ...(cycleId ? { cycleId } : {}) },
      include: { cycle: { select: { id: true, code: true, libelle: true } } },
      orderBy: { ordre: 'asc' },
    });
  }

  async findNiveau(tenantId: string, id: string): Promise<unknown> {
    const n = await this.prisma.niveau.findFirst({ where: { id, tenantId }, include: { cycle: true } });
    if (!n) throw new NotFoundException('Niveau introuvable');
    return n;
  }

  async updateNiveau(tenantId: string, id: string, dto: Partial<{ code: string; libelle: string; ordre: number; actif: boolean }>): Promise<unknown> {
    await this.findNiveau(tenantId, id);
    return this.prisma.niveau.update({ where: { id }, data: dto });
  }

  async deleteNiveau(tenantId: string, id: string): Promise<void> {
    await this.findNiveau(tenantId, id);
    await this.prisma.niveau.delete({ where: { id } });
  }

  // ==================== ANNEE ACADEMIQUE ====================
  async createAnnee(tenantId: string, dto: { libelle: string; dateDebut: string; dateFin: string; estCourante?: boolean }): Promise<unknown> {
    const existing = await this.prisma.anneeAcademique.findFirst({ where: { tenantId, libelle: dto.libelle } });
    if (existing) throw new ConflictException('Libellé année déjà utilisé');

    if (dto.estCourante) {
      await this.prisma.anneeAcademique.updateMany({ where: { tenantId }, data: { estCourante: false } });
    }

    return this.prisma.anneeAcademique.create({
      data: {
        tenantId,
        libelle: dto.libelle,
        dateDebut: new Date(dto.dateDebut),
        dateFin: new Date(dto.dateFin),
        estCourante: dto.estCourante ?? false,
      },
    });
  }

  async findAnnees(tenantId: string): Promise<unknown[]> {
    return this.prisma.anneeAcademique.findMany({
      where: { tenantId, actif: true },
      orderBy: { dateDebut: 'desc' },
    });
  }

  async findAnnee(tenantId: string, id: string): Promise<unknown> {
    const a = await this.prisma.anneeAcademique.findFirst({ where: { id, tenantId } });
    if (!a) throw new NotFoundException('Année académique introuvable');
    return a;
  }

  async setCourante(tenantId: string, id: string): Promise<unknown> {
    await this.findAnnee(tenantId, id);
    await this.prisma.anneeAcademique.updateMany({ where: { tenantId }, data: { estCourante: false } });
    return this.prisma.anneeAcademique.update({ where: { id }, data: { estCourante: true } });
  }

  async updateAnnee(tenantId: string, id: string, dto: Partial<{ libelle: string; dateDebut: string; dateFin: string; actif: boolean }>): Promise<unknown> {
    await this.findAnnee(tenantId, id);
    return this.prisma.anneeAcademique.update({
      where: { id },
      data: {
        ...dto,
        dateDebut: dto.dateDebut ? new Date(dto.dateDebut) : undefined,
        dateFin: dto.dateFin ? new Date(dto.dateFin) : undefined,
      },
    });
  }

  async deleteAnnee(tenantId: string, id: string): Promise<void> {
    await this.findAnnee(tenantId, id);
    await this.prisma.anneeAcademique.delete({ where: { id } });
  }

  // ==================== BATIMENT ====================
  async createBatiment(tenantId: string, dto: { nom: string; description?: string }): Promise<unknown> {
    return this.prisma.batiment.create({ data: { tenantId, ...dto } });
  }

  async findBatiments(tenantId: string): Promise<unknown[]> {
    return this.prisma.batiment.findMany({
      where: { tenantId, actif: true },
      include: { _count: { select: { salles: true } } },
      orderBy: { nom: 'asc' },
    });
  }

  async findBatiment(tenantId: string, id: string): Promise<unknown> {
    const b = await this.prisma.batiment.findFirst({ where: { id, tenantId }, include: { salles: true } });
    if (!b) throw new NotFoundException('Bâtiment introuvable');
    return b;
  }

  async updateBatiment(tenantId: string, id: string, dto: Partial<{ nom: string; description: string; actif: boolean }>): Promise<unknown> {
    await this.findBatiment(tenantId, id);
    return this.prisma.batiment.update({ where: { id }, data: dto });
  }

  async deleteBatiment(tenantId: string, id: string): Promise<void> {
    await this.findBatiment(tenantId, id);
    await this.prisma.batiment.delete({ where: { id } });
  }

  // ==================== SALLE ====================
  async createSalle(tenantId: string, dto: { batimentId: string; nom: string; capacite?: number; typeSalle?: string }): Promise<unknown> {
    return this.prisma.salle.create({
      data: { tenantId, ...dto },
      include: { batiment: { select: { id: true, nom: true } } },
    });
  }

  async findSalles(tenantId: string, batimentId?: string): Promise<unknown[]> {
    return this.prisma.salle.findMany({
      where: { tenantId, actif: true, ...(batimentId ? { batimentId } : {}) },
      include: { batiment: { select: { id: true, nom: true } } },
      orderBy: { nom: 'asc' },
    });
  }

  async findSalle(tenantId: string, id: string): Promise<unknown> {
    const s = await this.prisma.salle.findFirst({ where: { id, tenantId }, include: { batiment: true } });
    if (!s) throw new NotFoundException('Salle introuvable');
    return s;
  }

  async updateSalle(tenantId: string, id: string, dto: Partial<{ nom: string; capacite: number; typeSalle: string; actif: boolean }>): Promise<unknown> {
    await this.findSalle(tenantId, id);
    return this.prisma.salle.update({ where: { id }, data: dto });
  }

  async deleteSalle(tenantId: string, id: string): Promise<void> {
    await this.findSalle(tenantId, id);
    await this.prisma.salle.delete({ where: { id } });
  }

  // ==================== COURS ====================
  async createCours(tenantId: string, dto: { matiereId: string; classeId: string; enseignantId: string; anneeAcademiqueId?: string; volumeHoraireHebdo?: number; coefficient?: number; montantHoraire?: number }): Promise<unknown> {
    return this.prisma.cours.create({
      data: { tenantId, ...dto },
      include: {
        matiere: { select: { id: true, code: true, libelle: true } },
        classe: { select: { id: true, nom: true } },
      },
    });
  }

  async findCours(tenantId: string, classeId?: string, enseignantId?: string, anneeAcademiqueId?: string): Promise<unknown[]> {
    return this.prisma.cours.findMany({
      where: {
        tenantId,
        ...(classeId ? { classeId } : {}),
        ...(enseignantId ? { enseignantId } : {}),
        ...(anneeAcademiqueId ? { anneeAcademiqueId } : {}),
      },
      include: {
        matiere: { select: { id: true, code: true, libelle: true } },
        classe: { select: { id: true, nom: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneCours(tenantId: string, id: string): Promise<unknown> {
    const c = await this.prisma.cours.findFirst({
      where: { id, tenantId },
      include: { matiere: true, classe: true },
    });
    if (!c) throw new NotFoundException('Cours introuvable');
    return c;
  }

  async updateCours(tenantId: string, id: string, dto: Partial<{ volumeHoraireHebdo: number; coefficient: number; montantHoraire: number }>): Promise<unknown> {
    await this.findOneCours(tenantId, id);
    return this.prisma.cours.update({ where: { id }, data: dto });
  }

  async deleteCours(tenantId: string, id: string): Promise<void> {
    await this.findOneCours(tenantId, id);
    await this.prisma.cours.delete({ where: { id } });
  }

  // ==================== RECLAMATION ====================
  async createReclamation(tenantId: string, dto: { eleveId: string; noteId?: string; motif: string }): Promise<unknown> {
    return this.prisma.reclamation.create({ data: { tenantId, ...dto } });
  }

  async findReclamations(tenantId: string, query: PaginationQueryDto): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const [data, total] = await Promise.all([
      this.prisma.reclamation.findMany({ where: { tenantId }, skip, take: query.size ?? 20, orderBy: { createdAt: 'desc' } }),
      this.prisma.reclamation.count({ where: { tenantId } }),
    ]);
    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async traiterReclamation(tenantId: string, id: string, reponse: string): Promise<unknown> {
    const r = await this.prisma.reclamation.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('Réclamation introuvable');
    return this.prisma.reclamation.update({ where: { id }, data: { statut: 'TRAITEE', reponse } });
  }

  // ==================== CAHIER DE TEXTE ====================
  async createCahierTexte(tenantId: string, dto: { coursId: string; dateCours: string; contenuTraite: string; observations?: string; etapeProgramme?: string }): Promise<unknown> {
    return this.prisma.cahierTexte.create({
      data: {
        tenantId,
        coursId: dto.coursId,
        dateCours: new Date(dto.dateCours),
        contenuTraite: dto.contenuTraite,
        observations: dto.observations,
        etapeProgramme: dto.etapeProgramme,
      },
    });
  }

  async findCahiersTexte(tenantId: string, coursId?: string): Promise<unknown[]> {
    return this.prisma.cahierTexte.findMany({
      where: { tenantId, ...(coursId ? { coursId } : {}) },
      orderBy: { dateCours: 'desc' },
      include: { cours: { include: { matiere: true } } },
    });
  }

  // ==================== ABSENCE ENSEIGNANT ====================
  async createAbsenceEnseignant(tenantId: string, dto: { enseignantId: string; dateDebut: string; dateFin: string; motif: string; justifiee?: boolean; remplacantId?: string }): Promise<unknown> {
    return this.prisma.absenceEnseignant.create({
      data: {
        tenantId,
        enseignantId: dto.enseignantId,
        dateDebut: new Date(dto.dateDebut),
        dateFin: new Date(dto.dateFin),
        motif: dto.motif,
        justifiee: dto.justifiee ?? false,
        remplacantId: dto.remplacantId,
      },
    });
  }

  async findAbsencesEnseignant(tenantId: string, enseignantId?: string): Promise<unknown[]> {
    return this.prisma.absenceEnseignant.findMany({
      where: { tenantId, ...(enseignantId ? { enseignantId } : {}) },
      orderBy: { dateDebut: 'desc' },
      include: { enseignant: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  // ==================== CALENDRIER ====================
  async createCalendrier(tenantId: string, dto: { titre: string; description?: string; dateDebut: string; dateFin?: string; type?: string }): Promise<unknown> {
    return this.prisma.calendrierScolaire.create({
      data: {
        tenantId,
        titre: dto.titre,
        description: dto.description,
        dateDebut: new Date(dto.dateDebut),
        dateFin: dto.dateFin ? new Date(dto.dateFin) : undefined,
        type: (dto.type as never) || 'AUTRE',
      },
    });
  }

  async findCalendrier(tenantId: string): Promise<unknown[]> {
    return this.prisma.calendrierScolaire.findMany({
      where: { tenantId },
      orderBy: { dateDebut: 'asc' },
    });
  }

  // ==================== NOTIFICATIONS ====================
  async findNotifications(tenantId: string, destinataireId: string, query: PaginationQueryDto): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({ where: { tenantId, destinataireId }, skip, take: query.size ?? 20, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where: { tenantId, destinataireId } }),
    ]);
    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async marquerLue(tenantId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { id, tenantId }, data: { lu: true } });
  }

  // ==================== LIEN BULLETIN ====================
  async createLienBulletin(tenantId: string, dto: { bulletinId: string; parentId: string; expiresAt: string }): Promise<unknown> {
    const { randomBytes } = await import('node:crypto');
    const token = randomBytes(32).toString('hex');
    return this.prisma.lienBulletinParent.create({
      data: {
        tenantId,
        bulletinId: dto.bulletinId,
        parentId: dto.parentId,
        token,
        expiresAt: new Date(dto.expiresAt),
      },
    });
  }

  async findLienBulletinByToken(token: string): Promise<unknown> {
    const l = await this.prisma.lienBulletinParent.findUnique({
      where: { token },
      include: { bulletin: true },
    });
    if (!l) throw new NotFoundException('Lien introuvable');
    return l;
  }

  // ==================== LIEN PAIEMENT ====================
  async createLienPaiement(tenantId: string, dto: { parentId: string; montantTotal: number; mois: string; expiresAt: string }): Promise<unknown> {
    const { randomBytes } = await import('node:crypto');
    const token = randomBytes(32).toString('hex');
    return this.prisma.lienPaiementParent.create({
      data: {
        tenantId,
        parentId: dto.parentId,
        token,
        montantTotal: dto.montantTotal,
        mois: dto.mois,
        expiresAt: new Date(dto.expiresAt),
      },
    });
  }
}
