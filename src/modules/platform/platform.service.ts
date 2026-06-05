import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';
import { CreateTenantDto } from '@/modules/platform/dto/create-tenant.dto';
import { CreateUserDto } from '@/modules/platform/dto/create-user.dto';
import { rethrowServiceError } from '@/common/utils/service-error.util';
import { StorageService } from '@/infrastructure/storage/storage.service';

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findTenants() {
    const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
    return tenants.map((tenant) => ({
      ...tenant,
      logoUrl: this.storage.resolveUrl(tenant.logoUrl) ?? tenant.logoUrl,
    }));
  }
  async createTenant(dto: CreateTenantDto) {
    try {
      const dateExpiration = dto.durationMonths
        ? new Date(Date.now() + dto.durationMonths * 30 * 24 * 60 * 60 * 1000)
        : undefined;
      const slug = await this.ensureUniqueTenantSlug(dto.slug ?? this.schoolCode(dto.nom));
      const [
        codeAccesEleve,
        codeAccesEnseignant,
        codeAccesCaissier,
        codeAccesAdmin,
        codeAccesSurveillant,
        codeAccesRh,
      ] = await Promise.all([
        this.generateUniqueCode('codeAccesEleve'),
        this.generateUniqueCode('codeAccesEnseignant'),
        this.generateUniqueCode('codeAccesCaissier'),
        this.generateUniqueCode('codeAccesAdmin'),
        this.generateUniqueCode('codeAccesSurveillant'),
        this.generateUniqueCode('codeAccesRh'),
      ]);
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
          codeAccesEleve,
          codeAccesEnseignant,
          codeAccesCaissier,
          codeAccesAdmin,
          codeAccesSurveillant,
          codeAccesRh,
        } as any,
      });
    } catch (error) {
      rethrowServiceError(error, 'création tenant');
    }
  }
  async findTenantById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    return tenant ? { ...tenant, logoUrl: this.storage.resolveUrl(tenant.logoUrl) ?? tenant.logoUrl } : null;
  }
  async updateTenant(id: string, dto: Partial<CreateTenantDto>) {
    const slug = dto.slug || dto.nom
      ? await this.ensureUniqueTenantSlug(dto.slug ?? this.schoolCode(dto.nom ?? ''), id)
      : undefined;

    const tenant = await this.prisma.tenant.update({
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
    return { ...tenant, logoUrl: this.storage.resolveUrl(tenant.logoUrl) ?? tenant.logoUrl };
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
    const [totalTenants, tenantActifs, totalUsers, utilisateursPlateforme, totalInscriptions, totalPaiements, tenantParPlan] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { actif: true } }),
      this.prisma.user.count(),
      this.prisma.plateformeUtilisateur.count(),
      this.prisma.inscription.count(),
      this.prisma.paiement.count(),
      this.prisma.tenant.groupBy({ by: ['plan'], _count: { _all: true } }),
    ]);

    const tenantsSuspendus = totalTenants - tenantActifs;

    const derniersTenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, nom: true, plan: true, actif: true, createdAt: true, logoUrl: true },
    });

    const croissanceMensuelle = await this.prisma.tenant.groupBy({
      by: ['createdAt'],
      _count: { _all: true },
      orderBy: { createdAt: 'asc' },
    });

    // Agréger par mois
    const parMois: Record<string, number> = {};
    for (const row of croissanceMensuelle) {
      const key = new Date(row.createdAt).toISOString().slice(0, 7);
      parMois[key] = (parMois[key] ?? 0) + row._count._all;
    }

    const derniersTenantsResolved = derniersTenants.map((tenant) => ({
      ...tenant,
      logoUrl: this.storage.resolveUrl((tenant as any).logoUrl) ?? (tenant as any).logoUrl,
    }));

    return {
      tenants: totalTenants,
      tenantActifs,
      tenantsSuspendus,
      users: totalUsers,
      utilisateurs: totalUsers,
      utilisateursPlateforme,
      inscriptions: totalInscriptions,
      paiements: totalPaiements,
      parPlan: tenantParPlan.map((p) => ({ plan: p.plan, count: p._count._all })),
      derniersTenants: derniersTenantsResolved,
      croissanceMensuelle: Object.entries(parMois).map(([mois, count]) => ({ mois, count })),
    };
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

  private async generateUniqueCode(field: string): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    while (true) {
      const bytes = randomBytes(10);
      let code = '';
      for (let i = 0; i < 10; i++) code += chars[bytes[i] % chars.length];
      const existing = await this.prisma.tenant.findFirst({
        where: { [field]: code } as any,
        select: { id: true },
      });
      if (!existing) return code;
    }
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
