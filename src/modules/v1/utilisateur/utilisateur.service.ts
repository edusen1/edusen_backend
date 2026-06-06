import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { UserRole } from '@prisma/client';
import { Prisma } from '@prisma/client';

export interface CreateUserDto {
  tenantId: string;
  firstName: string;
  lastName: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  role: UserRole;
  username?: string;
  // Eleve
  matricule?: string;
  dateNaissance?: string;
  lieuNaissance?: string;
  genre?: 'M' | 'F' | 'AUTRE';
  numeroUrgence?: string;
  classeId?: string;
  parentIds?: string[];
  // Enseignant
  specialite?: string;
  dateEmbauche?: string;
  numeroCNPS?: string;
  numeroSecuriteSociale?: string;
  // Parent
  profession?: string;
  lieuTravail?: string;
  telephoneTravail?: string;
  lienParente?: string;
}

@Injectable()
export class UtilisateurService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async create(dto: CreateUserDto): Promise<unknown> {
    const normalizedEmail = dto.email?.trim().toLowerCase() || null;

    if (normalizedEmail) {
      const existing = await this.prisma.user.findFirst({
        where: { tenantId: dto.tenantId, email: normalizedEmail },
      });
      if (existing) throw new ConflictException('Email déjà utilisé dans ce tenant');
    }

    if (dto.matricule) {
      const existingMatricule = await this.prisma.user.findFirst({
        where: { tenantId: dto.tenantId, matricule: dto.matricule },
      });
      if (existingMatricule) throw new ConflictException('Matricule déjà utilisé');
    }

    const tmpPwd = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tmpPwd, 12);

    const generatedUsername = dto.username
      ?? normalizedEmail
      ?? `${dto.firstName.toLowerCase().replace(/\s+/g, '')}.${dto.lastName.toLowerCase().replace(/\s+/g, '')}.${Date.now()}`;

    const user = await this.prisma.user.create({
      data: {
        tenantId: dto.tenantId,
        email: normalizedEmail,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        telephone: dto.telephone,
        adresse: dto.adresse,
        role: dto.role,
        username: generatedUsername,
        mustChangePwd: true,
        matricule: dto.matricule,
        dateNaissance: dto.dateNaissance ? new Date(dto.dateNaissance) : undefined,
        lieuNaissance: dto.lieuNaissance,
        genre: dto.genre as Prisma.UserCreateInput['genre'],
        numeroUrgence: dto.numeroUrgence,
        classeId: dto.classeId,
        specialite: dto.specialite,
        dateEmbauche: dto.dateEmbauche ? new Date(dto.dateEmbauche) : undefined,
        numeroCNPS: dto.numeroCNPS,
        numeroSecuriteSociale: dto.numeroSecuriteSociale,
        profession: dto.profession,
        lieuTravail: dto.lieuTravail,
        telephoneTravail: dto.telephoneTravail,
        lienParente: dto.lienParente as Prisma.UserCreateInput['lienParente'],
      },
    });

    if (dto.parentIds?.length && dto.role === 'ELEVE') {
      await this.prisma.eleveParent.createMany({
        data: dto.parentIds.map((parentId) => ({ eleveId: user.id, parentId })),
        skipDuplicates: true,
      });
    }

    await this.sendCredentialsByWhatsapp(user, tmpPwd);
    return this.sanitize(user);
  }

  async findAll(tenantId: string, query: PaginationQueryDto): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.UserWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { matricule: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { createdAt: query.order ?? 'desc' },
        select: this.selectFields(),
      }),
      this.prisma.user.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findByRole(
    tenantId: string,
    role: UserRole,
    query: PaginationQueryDto,
  ): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);
    const where: Prisma.UserWhereInput = {
      tenantId,
      role,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { matricule: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: query.size ?? 20,
        orderBy: { lastName: 'asc' },
        select: this.selectFields(),
      }),
      this.prisma.user.count({ where }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: {
        ...this.selectFields(),
        elevParents: { select: { parent: { select: this.selectFields() } } },
        parentEleves: { select: { eleve: { select: this.selectFields() } } },
        matiereClasses: {
          select: {
            id: true,
            matiere: { select: { id: true, code: true, libelle: true } },
            classe: { select: { id: true, nom: true } },
            anneeScolaire: true,
          },
        },
        surveillantCycles: { select: { cycle: { select: { id: true, code: true, libelle: true } } } },
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return user;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateUserDto>): Promise<unknown> {
    await this.findOne(tenantId, id);

    const data: Prisma.UserUncheckedUpdateInput = {};
    if (dto.firstName) data.firstName = dto.firstName;
    if (dto.lastName) data.lastName = dto.lastName;
    if (dto.telephone !== undefined) data.telephone = dto.telephone;
    if (dto.adresse !== undefined) data.adresse = dto.adresse;
    if (dto.specialite !== undefined) data.specialite = dto.specialite;
    if (dto.profession !== undefined) data.profession = dto.profession;
    if (dto.classeId !== undefined) data.classeId = dto.classeId;
    if (dto.genre) data.genre = dto.genre as Prisma.UserUpdateInput['genre'];

    const updated = await this.prisma.user.update({ where: { id }, data, select: this.selectFields() });
    return updated;
  }

  async deactivate(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.user.update({ where: { id }, data: { actif: false } });
  }

  async resetPassword(tenantId: string, id: string): Promise<{ tempPassword: string }> {
    await this.findOne(tenantId, id);
    const tmpPwd = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tmpPwd, 12);
    const user = await this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePwd: true },
    });
    await this.sendCredentialsByWhatsapp(user, tmpPwd);
    return { tempPassword: tmpPwd };
  }

  async assignerCycles(tenantId: string, surveillantId: string, cycleIds: string[]): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: surveillantId, tenantId } });
    if (!user || user.role !== 'SURVEILLANT') {
      throw new BadRequestException('Utilisateur introuvable ou n\'est pas un surveillant');
    }

    await this.prisma.surveillantCycle.deleteMany({ where: { surveillantId } });

    if (cycleIds.length > 0) {
      await this.prisma.surveillantCycle.createMany({
        data: cycleIds.map((cycleId) => ({ tenantId, surveillantId, cycleId })),
        skipDuplicates: true,
      });
    }
  }

  private generateTempPassword(): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$';
    return Array.from(randomBytes(16))
      .map((b) => chars[b % chars.length])
      .join('')
      .slice(0, 16);
  }

  private selectFields() {
    return {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      telephone: true,
      adresse: true,
      role: true,
      actif: true,
      mustChangePwd: true,
      username: true,
      tenantId: true,
      matricule: true,
      dateNaissance: true,
      lieuNaissance: true,
      genre: true,
      numeroUrgence: true,
      classeId: true,
      specialite: true,
      dateEmbauche: true,
      numeroCNPS: true,
      profession: true,
      lieuTravail: true,
      lienParente: true,
      photoUrl: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  private sanitize(user: Record<string, unknown>): Record<string, unknown> {
    const { passwordHash: _, ...rest } = user as { passwordHash: string } & Record<string, unknown>;
    return rest;
  }

  private async sendCredentialsByWhatsapp(
    user: {
      tenantId: string;
      telephone: string | null;
      email: string | null;
      username: string | null;
      matricule: string | null;
      firstName: string;
      role: UserRole;
    },
    tempPassword: string,
  ): Promise<void> {
    const telephone = String(user.telephone ?? '').trim();
    if (!telephone) return;

    const loginIdentifier =
      telephone ||
      String(user.email ?? '').trim() ||
      String(user.username ?? '').trim() ||
      String(user.matricule ?? '').trim();

    const label = this.roleLabel(user.role);
    const message = [
      `NouraSchool - Accès ${label}`,
      `Identifiant: ${loginIdentifier}`,
      `Mot de passe provisoire: ${tempPassword}`,
      'Vous devrez modifier ce mot de passe lors de votre première connexion.',
    ].join('\n');

    await this.whatsapp.sendMessage(user.tenantId, telephone, message).catch(() => undefined);
  }

  private roleLabel(role: UserRole): string {
    const labels: Partial<Record<UserRole, string>> = {
      ADMIN: 'administrateur',
      ENSEIGNANT: 'professeur',
      ELEVE: 'élève',
      PARENT: 'parent',
      SURVEILLANT: 'surveillant',
      CAISSIER: 'caissier',
      RH: 'ressources humaines',
      GESTIONNAIRE: 'gestionnaire',
    };
    return labels[role] ?? 'utilisateur';
  }
}
