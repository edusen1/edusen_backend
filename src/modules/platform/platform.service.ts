import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@/config/prisma.service';
import { CreateTenantDto } from '@/modules/platform/dto/create-tenant.dto';
import { CreateUserDto } from '@/modules/platform/dto/create-user.dto';
import { rethrowServiceError } from '@/common/utils/service-error.util';

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  findTenants() { return this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } }); }
  async createTenant(dto: CreateTenantDto) {
    try {
      const dateExpiration = dto.durationMonths
        ? new Date(Date.now() + dto.durationMonths * 30 * 24 * 60 * 60 * 1000)
        : undefined;
      const slug = await this.ensureUniqueTenantSlug(dto.slug ?? this.schoolCode(dto.nom));
      return await this.prisma.tenant.create({
        data: {
          slug,
          nom: dto.nom,
          emailContact: dto.emailContact,
          telephone: dto.telephone,
          adresse: dto.adresse,
          logoUrl: dto.logoUrl,
          plan: dto.plan ?? 'TRIAL',
          dateExpiration,
          actif: dto.actif ?? true,
        },
      });
    } catch (error) {
      rethrowServiceError(error, 'création tenant');
    }
  }
  findTenantById(id: string) { return this.prisma.tenant.findUnique({ where: { id } }); }
  async updateTenant(id: string, dto: Partial<CreateTenantDto>) {
    const slug = dto.slug || dto.nom
      ? await this.ensureUniqueTenantSlug(dto.slug ?? this.schoolCode(dto.nom ?? ''), id)
      : undefined;

    return this.prisma.tenant.update({
      where: { id },
      data: {
        slug,
        nom: dto.nom,
        emailContact: dto.emailContact,
        telephone: dto.telephone,
        adresse: dto.adresse,
        logoUrl: dto.logoUrl,
        plan: dto.plan,
        actif: dto.actif,
      },
    });
  }
  suspendTenant(id: string) { return this.prisma.tenant.update({ where: { id }, data: { actif: false } }); }
  reactivateTenant(id: string) { return this.prisma.tenant.update({ where: { id }, data: { actif: true } }); }
  deleteTenant(id: string) { return this.prisma.tenant.delete({ where: { id } }); }

  listUsers() { return this.prisma.plateformeUtilisateur.findMany({ orderBy: { createdAt: 'desc' } }); }
  getUser(id: string) { return this.prisma.plateformeUtilisateur.findUnique({ where: { id } }); }

  async createUser(dto: CreateUserDto) {
    try {
      const password = dto.password ?? Math.random().toString(36).slice(2, 14);
      const motDePasse = await bcrypt.hash(password, 12);
      return await this.prisma.plateformeUtilisateur.create({
        data: {
          nom: dto.nom,
          prenom: dto.prenom,
          email: dto.email,
          telephone: dto.telephone,
          rolePlateforme: dto.rolePlateforme ?? 'GESTIONNAIRE',
          motDePasse,
        },
      });
    } catch (error) {
      rethrowServiceError(error, 'création utilisateur plateforme');
    }
  }

  deleteUser(id: string) { return this.prisma.plateformeUtilisateur.delete({ where: { id } }); }
  setUserActive(id: string, actif: boolean) {
    return this.prisma.plateformeUtilisateur.update({ where: { id }, data: { actif } });
  }

  async stats() {
    const [tenants, utilisateurs, utilisateursPlateforme] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.user.count(),
      this.prisma.plateformeUtilisateur.count(),
    ]);
    return { tenants, users: utilisateurs, utilisateurs, utilisateursPlateforme };
  }

  auditLogs() {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }

  private schoolCode(value: string): string {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const compact = normalized.replace(/[^a-z0-9]/g, '');
    if (compact.length > 0 && compact.length <= 15) {
      return compact;
    }

    const initials = normalized
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join('');

    return initials || compact.slice(0, 15) || 'ecole';
  }

  private async ensureUniqueTenantSlug(base: string, excludeTenantId?: string): Promise<string> {
    const normalizedBase = (this.schoolCode(base) || 'ecole').slice(0, 90);
    let candidate = normalizedBase;
    let index = 2;

    while (await this.prisma.tenant.findFirst({
      where: {
        slug: candidate,
        ...(excludeTenantId ? { id: { not: excludeTenantId } } : {}),
      },
      select: { id: true },
    })) {
      candidate = `${normalizedBase}${index}`;
      index++;
    }

    return candidate;
  }
}
