import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { AppCacheService } from '@/infrastructure/cache/app-cache.service';
import { UpdateEcoleConfigDto } from './dto/update-ecole-config.dto';
import { UpdateApparenceDto } from './dto/update-apparence.dto';
import { SaveApparencePaletteDto } from './dto/save-apparence-palette.dto';

export interface EcoleConfigResponse {
  nom: string;
  slogan?: string;
  adresse: string;
  ville: string;
  pays: string;
  telephone: string;
  email: string;
  siteWeb?: string;
  numeroAgrement?: string;
  typeEtablissement: string;
  logoUrl?: string;
  cachetUrl?: string;
  montantHoraireDefaut?: number;
}

export interface EcoleIdentityResponse {
  nom: string;
  logoUrl?: string;
}

export interface ApparenceResponse {
  themeColor: string;
  sidebarMode: string;
  displayMode: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
}

export interface ApparencePaletteResponse {
  id: string;
  libelle: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
}

const DEFAULT_APPARENCE: ApparenceResponse = {
  themeColor: 'blue',
  sidebarMode: 'light',
  displayMode: 'light',
  primaryColor: '#03a9f3',
  secondaryColor: '#16a34a',
  backgroundColor: '#2f7d6f',
  textColor: '#1f2937',
};

@Injectable()
export class EcoleConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cache: AppCacheService,
  ) {}

  async getEcoleConfig(tenantId: string): Promise<EcoleConfigResponse> {
    return this.cache.getOrSet(this.configCacheKey(tenantId), 300, () =>
      this.prisma.withReadRetry('ecole config', () => this.loadEcoleConfig(tenantId)),
    );
  }

  private async loadEcoleConfig(tenantId: string): Promise<EcoleConfigResponse> {
    const config = await this.prisma.ecoleConfig.findUnique({ where: { tenantId } });

    if (config) {
      return this.toResponse(config);
    }

    // Fallback: seed from Tenant base fields when no EcoleConfig row exists yet
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant introuvable');
    }

    return {
      nom: tenant.nom,
      adresse: tenant.adresse ?? '',
      ville: '',
      pays: 'SN',
      telephone: tenant.telephone ?? '',
      email: tenant.emailContact ?? '',
      logoUrl: this.storage.resolveUrl(tenant.logoUrl) ?? undefined,
      cachetUrl: undefined,
      typeEtablissement: 'PRIVE',
      montantHoraireDefaut: undefined,
    };
  }

  async getEcoleIdentity(tenantId?: string): Promise<EcoleIdentityResponse> {
    const resolvedTenantId = await this.resolveTenantId(tenantId);
    const config = await this.getEcoleConfig(resolvedTenantId);
    return {
      nom: config.nom,
      logoUrl: config.logoUrl,
    };
  }

  /**
   * Résout le tenant à utiliser pour l'identité affichée publiquement.
   * Appelée sans tenant depuis la page de connexion (avant authentification) :
   * on retombe alors sur l'établissement par défaut (déploiement mono-école),
   * surchargé au besoin par la variable d'env DEFAULT_TENANT_ID.
   */
  private async resolveTenantId(tenantId?: string): Promise<string> {
    const trimmed = tenantId?.trim();
    if (trimmed) {
      return trimmed;
    }

    const fallback = process.env.DEFAULT_TENANT_ID?.trim();
    if (fallback) {
      return fallback;
    }

    const tenant = await this.prisma.tenant.findFirst({
      where: { actif: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('Aucun établissement configuré');
    }
    return tenant.id;
  }

  async updateEcoleConfig(tenantId: string, dto: UpdateEcoleConfigDto): Promise<EcoleConfigResponse> {
    const previousConfig = await this.prisma.ecoleConfig.findUnique({
      where: { tenantId },
      select: { logoS3Key: true, cachetS3Key: true },
    });
    const logoPatch = await this.resolveLogoPatch(tenantId, dto.logoUrl);
    const cachetPatch = await this.resolveCachetPatch(tenantId, dto.cachetUrl);
    const data = {
      nom: dto.nom,
      slogan: dto.slogan ?? null,
      adresse: dto.adresse,
      ville: dto.ville,
      pays: dto.pays,
      telephone: dto.telephone,
      email: dto.email,
      siteWeb: dto.siteWeb ?? null,
      numeroAgrement: dto.numeroAgrement ?? null,
      typeEtablissement: 'PRIVE', // forced per business rules — never trust the client value
      montantHoraireDefaut: dto.montantHoraireDefaut ?? null,
    };

    const config = await this.prisma.ecoleConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...data,
        ...(logoPatch ?? { logoUrl: null, logoS3Key: null }),
        ...(cachetPatch ?? { cachetUrl: null, cachetS3Key: null }),
      },
      update: {
        ...data,
        ...(logoPatch ?? {}),
        ...(cachetPatch ?? {}),
      },
    });

    if (logoPatch?.logoS3Key && previousConfig?.logoS3Key && previousConfig.logoS3Key !== logoPatch.logoS3Key) {
      await this.storage.delete(previousConfig.logoS3Key).catch(() => undefined);
    }
    if (cachetPatch?.cachetS3Key && previousConfig?.cachetS3Key && previousConfig.cachetS3Key !== cachetPatch.cachetS3Key) {
      await this.storage.delete(previousConfig.cachetS3Key).catch(() => undefined);
    }

    // Keep Tenant base fields in sync for coherence across the platform
    const codeEcole = await this.ensureUniqueTenantSlug(this.schoolCode(dto.nom), tenantId);
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        slug: codeEcole,
        nom: dto.nom,
        emailContact: dto.email,
        telephone: dto.telephone,
        adresse: dto.adresse,
        ...(logoPatch ? { logoUrl: logoPatch.logoUrl } : {}),
      },
    });

    await this.invalidateTenantCache(tenantId);
    return this.toResponse(config);
  }

  async getApparence(tenantId: string): Promise<ApparenceResponse> {
    return this.cache.getOrSet(this.apparenceCacheKey(tenantId), 300, () =>
      this.prisma.withReadRetry('ecole apparence', () => this.loadApparence(tenantId)),
    );
  }

  private async loadApparence(tenantId: string): Promise<ApparenceResponse> {
    const config = await this.prisma.ecoleConfig.findUnique({
      where: { tenantId },
      select: {
        themeColor: true,
        sidebarMode: true,
        displayMode: true,
        primaryColor: true,
        secondaryColor: true,
        backgroundColor: true,
        textColor: true,
      },
    });

    return {
      themeColor: config?.themeColor ?? DEFAULT_APPARENCE.themeColor,
      sidebarMode: config?.sidebarMode ?? DEFAULT_APPARENCE.sidebarMode,
      displayMode: config?.displayMode ?? DEFAULT_APPARENCE.displayMode,
      primaryColor: config?.primaryColor ?? DEFAULT_APPARENCE.primaryColor,
      secondaryColor: config?.secondaryColor ?? DEFAULT_APPARENCE.secondaryColor,
      backgroundColor: config?.backgroundColor ?? DEFAULT_APPARENCE.backgroundColor,
      textColor: config?.textColor ?? DEFAULT_APPARENCE.textColor,
    };
  }

  async updateApparence(tenantId: string, dto: UpdateApparenceDto): Promise<ApparenceResponse> {
    const apparenceData = {
      themeColor: dto.reset ? DEFAULT_APPARENCE.themeColor : dto.themeColor,
      sidebarMode: dto.reset ? DEFAULT_APPARENCE.sidebarMode : dto.sidebarMode,
      displayMode: dto.reset ? DEFAULT_APPARENCE.displayMode : dto.displayMode,
      primaryColor: this.normalizeHex(dto.reset ? DEFAULT_APPARENCE.primaryColor : dto.primaryColor ?? DEFAULT_APPARENCE.primaryColor),
      secondaryColor: this.normalizeHex(dto.reset ? DEFAULT_APPARENCE.secondaryColor : dto.secondaryColor ?? DEFAULT_APPARENCE.secondaryColor),
      backgroundColor: this.normalizeHex(dto.reset ? DEFAULT_APPARENCE.backgroundColor : dto.backgroundColor ?? DEFAULT_APPARENCE.backgroundColor),
      textColor: this.normalizeHex(dto.reset ? DEFAULT_APPARENCE.textColor : dto.textColor ?? DEFAULT_APPARENCE.textColor),
    };

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant introuvable');

    await this.prisma.ecoleConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        nom: tenant.nom,
        adresse: tenant.adresse ?? '',
        ville: '',
        pays: 'SN',
        telephone: tenant.telephone ?? '',
        email: tenant.emailContact ?? '',
        typeEtablissement: 'PRIVE',
        ...apparenceData,
      },
      update: apparenceData,
    });

    await this.invalidateTenantCache(tenantId);
    return apparenceData;
  }

  async getApparencePalettes(tenantId: string): Promise<ApparencePaletteResponse[]> {
    return this.cache.getOrSet(this.palettesCacheKey(tenantId), 300, () =>
      this.prisma.withReadRetry('ecole palettes', () => this.loadApparencePalettes(tenantId)),
    );
  }

  private async loadApparencePalettes(tenantId: string): Promise<ApparencePaletteResponse[]> {
    const palettes = await this.prisma.ecolePaletteConfig.findMany({
      where: { tenantId, actif: true },
      orderBy: [{ createdAt: 'asc' }, { libelle: 'asc' }],
      select: {
        id: true,
        libelle: true,
        primaryColor: true,
        secondaryColor: true,
        backgroundColor: true,
        textColor: true,
      },
    });

    return palettes.map((palette) => this.toPaletteResponse(palette));
  }

  async saveApparencePalette(tenantId: string, dto: SaveApparencePaletteDto): Promise<ApparencePaletteResponse> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Tenant introuvable');

    const data = {
      libelle: dto.libelle.trim(),
      primaryColor: this.normalizeHex(dto.primaryColor),
      secondaryColor: this.normalizeHex(dto.secondaryColor),
      backgroundColor: this.normalizeHex(dto.backgroundColor),
      textColor: this.normalizeHex(dto.textColor),
      actif: true,
    };

    if (dto.id?.trim()) {
      const existing = await this.prisma.ecolePaletteConfig.findFirst({
        where: { id: dto.id.trim(), tenantId, actif: true },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Palette introuvable');

      const updated = await this.prisma.ecolePaletteConfig.update({
        where: { id: existing.id },
        data,
      });
      await this.invalidateTenantCache(tenantId);
      return this.toPaletteResponse(updated);
    }

    const created = await this.prisma.ecolePaletteConfig.create({
      data: { tenantId, ...data },
    });
    await this.invalidateTenantCache(tenantId);
    return this.toPaletteResponse(created);
  }

  async deleteApparencePalette(tenantId: string, paletteId: string): Promise<void> {
    const result = await this.prisma.ecolePaletteConfig.updateMany({
      where: { id: paletteId, tenantId, actif: true },
      data: { actif: false },
    });
    if (result.count === 0) {
      throw new NotFoundException('Palette introuvable');
    }
    await this.invalidateTenantCache(tenantId);
  }

  private configCacheKey(tenantId: string): string {
    return `tenant:${tenantId}:ecole-config:v1`;
  }

  private apparenceCacheKey(tenantId: string): string {
    return `tenant:${tenantId}:apparence:v1`;
  }

  private palettesCacheKey(tenantId: string): string {
    return `tenant:${tenantId}:apparence-palettes:v1`;
  }

  private async invalidateTenantCache(tenantId: string): Promise<void> {
    await this.cache.invalidate(
      this.configCacheKey(tenantId),
      this.apparenceCacheKey(tenantId),
      this.palettesCacheKey(tenantId),
    );
  }

  private normalizeHex(value: string): string {
    return value.trim().toLowerCase();
  }

  private toPaletteResponse(palette: {
    id: string;
    libelle: string;
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    textColor: string;
  }): ApparencePaletteResponse {
    return {
      id: palette.id,
      libelle: palette.libelle,
      primaryColor: palette.primaryColor,
      secondaryColor: palette.secondaryColor,
      backgroundColor: palette.backgroundColor,
      textColor: palette.textColor,
    };
  }

  private toResponse(config: {
    nom: string;
    slogan: string | null;
    adresse: string;
    ville: string;
    pays: string;
    telephone: string;
    email: string;
    siteWeb: string | null;
    numeroAgrement: string | null;
    typeEtablissement: string;
    logoUrl: string | null;
    cachetUrl: string | null;
    montantHoraireDefaut: number | null;
  }): EcoleConfigResponse {
    return {
      nom: config.nom,
      slogan: config.slogan ?? undefined,
      adresse: config.adresse,
      ville: config.ville,
      pays: config.pays,
      telephone: config.telephone,
      email: config.email,
      siteWeb: config.siteWeb ?? undefined,
      numeroAgrement: config.numeroAgrement ?? undefined,
      typeEtablissement: 'PRIVE',
      logoUrl: this.storage.resolveUrl(config.logoUrl) ?? undefined,
      cachetUrl: this.storage.resolveUrl(config.cachetUrl) ?? undefined,
      montantHoraireDefaut: config.montantHoraireDefaut ?? undefined,
    };
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

  private async ensureUniqueTenantSlug(base: string, excludeTenantId: string): Promise<string> {
    const normalizedBase = (this.schoolCode(base) || 'ecole').slice(0, 90);
    let candidate = normalizedBase;
    let index = 2;

    while (await this.prisma.tenant.findFirst({
      where: { slug: candidate, id: { not: excludeTenantId } },
      select: { id: true },
    })) {
      candidate = `${normalizedBase}${index}`;
      index++;
    }

    return candidate;
  }

  private async resolveLogoPatch(
    tenantId: string,
    logoUrl?: string,
  ): Promise<{ logoUrl: string | null; logoS3Key: string | null } | null> {
    return (await this.resolveImagePatch(tenantId, 'logos', 'logo', logoUrl, 'Logo')) as { logoUrl: string | null; logoS3Key: string | null } | null;
  }

  private async resolveCachetPatch(
    tenantId: string,
    cachetUrl?: string,
  ): Promise<{ cachetUrl: string | null; cachetS3Key: string | null } | null> {
    return (await this.resolveImagePatch(tenantId, 'cachets', 'cachet', cachetUrl, 'Cachet')) as { cachetUrl: string | null; cachetS3Key: string | null } | null;
  }

  private async resolveImagePatch(
    tenantId: string,
    folder: string,
    basename: string,
    imageUrl?: string,
    label = 'Image',
  ): Promise<Record<string, string | null> | null> {
    if (imageUrl === undefined) {
      return null;
    }

    if (!imageUrl) {
      return { [`${basename}Url`]: null, [`${basename}S3Key`]: null };
    }

    if (/^https?:\/\//i.test(imageUrl)) {
      // URL complète (déjà stockée en base ou envoyée telle quelle) — normaliser l'hôte
      return { [`${basename}Url`]: this.storage.resolveUrl(imageUrl) ?? imageUrl, [`${basename}S3Key`]: null };
    }

    const match = imageUrl.match(/^data:image\/(png|jpe?g|svg\+xml|webp);base64,(.+)$/i);
    if (!match) {
      throw new BadRequestException(`${label} invalide`);
    }

    const subtype = match[1].toLowerCase();
    const contentType = `image/${subtype === 'jpg' ? 'jpeg' : subtype}`;
    const extension = subtype === 'svg+xml' ? 'svg' : subtype === 'jpeg' ? 'jpg' : subtype;
    const buffer = Buffer.from(match[2], 'base64');

    if (!buffer.length || buffer.length > 2_000_000) {
      throw new BadRequestException(`${label} invalide ou trop volumineux`);
    }

    const key = this.storage.buildKey(folder, tenantId, `${basename}.${extension}`);
    await this.storage.upload(key, buffer, contentType);
    // Stocker la clé brute — resolveUrl() est appliqué à la lecture
    return { [`${basename}Url`]: key, [`${basename}S3Key`]: key };
  }
}
