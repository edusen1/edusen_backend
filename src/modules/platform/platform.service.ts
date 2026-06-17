import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';
import { CreateTenantDto } from '@/modules/platform/dto/create-tenant.dto';
import { CreateUserDto } from '@/modules/platform/dto/create-user.dto';
import { rethrowServiceError } from '@/common/utils/service-error.util';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { MailService } from '@/infrastructure/mail/mail.service';

const PLATFORM_USER_SELECT = {
  id: true,
  nom: true,
  prenom: true,
  email: true,
  telephone: true,
  rolePlateforme: true,
  actif: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mailService: MailService,
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
      const tenant = await this.prisma.tenant.create({
        data: {
          slug,
          nom: dto.nom.trim(),
          emailContact: this.cleanEmail(dto.emailContact),
          telephone: this.clean(dto.telephone),
          adresse: this.clean(dto.adresse),
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

      const initialAdmin = await this.createInitialTenantAdmin(tenant.id, tenant.nom, dto);
      return {
        ...tenant,
        logoUrl: this.storage.resolveUrl(tenant.logoUrl) ?? tenant.logoUrl,
        ...(initialAdmin ? { initialAdmin } : {}),
      };
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
        nom: dto.nom?.trim(),
        emailContact: this.cleanEmail(dto.emailContact),
        telephone: this.clean(dto.telephone),
        adresse: this.clean(dto.adresse),
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

  async uploadTenantLogo(id: string, buffer: Buffer, contentType: string, filename?: string) {
    const key = this.storage.buildKey('logos/tenants', id, filename || 'logo');
    const stored = await this.storage.upload(key, buffer, contentType);
    const tenant = await this.updateTenant(id, { logoUrl: stored });
    return { logoUrl: tenant.logoUrl };
  }

  listUsers() {
    return this.prisma.plateformeUtilisateur.findMany({
      orderBy: { createdAt: 'desc' },
      select: PLATFORM_USER_SELECT,
    });
  }

  getUser(id: string) {
    return this.prisma.plateformeUtilisateur.findUnique({
      where: { id },
      select: PLATFORM_USER_SELECT,
    });
  }

  async createUser(dto: CreateUserDto) {
    try {
      const password = dto.password ?? this.generateTempPassword();
      const motDePasse = await bcrypt.hash(password, 12);
      const user = await this.prisma.plateformeUtilisateur.create({
        data: {
          nom: dto.nom.trim(),
          prenom: dto.prenom.trim(),
          email: dto.email.trim().toLowerCase(),
          telephone: this.clean(dto.telephone),
          rolePlateforme: dto.rolePlateforme ?? 'GESTIONNAIRE',
          motDePasse,
        },
        select: PLATFORM_USER_SELECT,
      });
      this.mailService.sendCompteCree(user.email, user.prenom, user.nom, password);
      return { ...user, temporaryPassword: password };
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
      nbTenants: totalTenants,
      nbTenantsActifs: tenantActifs,
      nbUtilisateurs: totalUsers,
      nbPlateformeUtilisateurs: utilisateursPlateforme,
      inscriptions: totalInscriptions,
      paiements: totalPaiements,
      parPlan: tenantParPlan.map((p) => ({ plan: p.plan, count: p._count._all })),
      derniersTenants: derniersTenantsResolved,
      croissanceMensuelle: Object.entries(parMois).map(([mois, count]) => ({ mois, count })),
    };
  }

  async auditLogs(page = 0, size = 20, filters?: { action?: string; tenantId?: string }) {
    const safePage = Math.max(0, Number(page) || 0);
    const safeSize = Math.min(100, Math.max(1, Number(size) || 20));
    const where = {
      ...(filters?.action ? { action: { contains: filters.action, mode: 'insensitive' as const } } : {}),
      ...(filters?.tenantId ? { tenantId: filters.tenantId } : {}),
    };
    const [content, totalElements] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: safePage * safeSize,
        take: safeSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const totalPages = Math.ceil(totalElements / safeSize);
    return {
      content,
      page: safePage,
      size: safeSize,
      totalElements,
      totalPages,
      first: safePage === 0,
      last: totalPages === 0 || safePage >= totalPages - 1,
    };
  }

  private async createInitialTenantAdmin(tenantId: string, tenantName: string, dto: CreateTenantDto) {
    const email = this.cleanEmail(dto.initialAdminEmail);
    if (!email) {
      return null;
    }

    const password = process.env.TENANT_INITIAL_ADMIN_PASSWORD || this.generateTempPassword();
    const passwordHash = await bcrypt.hash(password, 12);
    const names = this.splitAdminName(tenantName);
    const admin = await this.prisma.user.upsert({
      where: { tenantId_email: { tenantId, email } },
      create: {
        tenantId,
        email,
        telephone: this.clean(dto.initialAdminTelephone),
        username: email,
        firstName: names.firstName,
        lastName: names.lastName,
        passwordHash,
        role: 'ADMIN',
        actif: true,
        mustChangePwd: true,
      },
      update: {
        telephone: this.clean(dto.initialAdminTelephone),
        role: 'ADMIN',
        actif: true,
      },
      select: { id: true, email: true, telephone: true, firstName: true, lastName: true, role: true },
    });
    this.mailService.sendCompteCree(admin.email ?? email, admin.firstName, admin.lastName, password, tenantName);
    return { ...admin, temporaryPassword: password };
  }

  private clean(value?: string | null): string | undefined {
    const cleanValue = value?.trim();
    return cleanValue || undefined;
  }

  private cleanEmail(value?: string | null): string | undefined {
    const cleanValue = value?.trim().toLowerCase();
    return cleanValue || undefined;
  }

  private generateTempPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@$!';
    const bytes = randomBytes(14);
    return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
  }

  private splitAdminName(tenantName: string): { firstName: string; lastName: string } {
    const cleanName = tenantName.trim() || 'Ecole';
    return { firstName: 'Admin', lastName: cleanName.slice(0, 100) };
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
