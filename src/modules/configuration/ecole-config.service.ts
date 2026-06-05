import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { UpdateEcoleConfigDto } from './dto/update-ecole-config.dto';
import { UpdateApparenceDto } from './dto/update-apparence.dto';

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
}

export interface EcoleIdentityResponse {
  nom: string;
  logoUrl?: string;
}

export interface ApparenceResponse {
  themeColor: string;
  sidebarMode: string;
  displayMode: string;
}

@Injectable()
export class EcoleConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async getEcoleConfig(tenantId: string): Promise<EcoleConfigResponse> {
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
      typeEtablissement: 'PRIVE',
    };
  }

  async getEcoleIdentity(tenantId: string): Promise<EcoleIdentityResponse> {
    const config = await this.getEcoleConfig(tenantId);
    return {
      nom: config.nom,
      logoUrl: config.logoUrl,
    };
  }

  async updateEcoleConfig(tenantId: string, dto: UpdateEcoleConfigDto): Promise<EcoleConfigResponse> {
    const previousConfig = await this.prisma.ecoleConfig.findUnique({
      where: { tenantId },
      select: { logoS3Key: true },
    });
    const logoPatch = await this.resolveLogoPatch(tenantId, dto.logoUrl);
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
    };

    const config = await this.prisma.ecoleConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data, ...(logoPatch ?? { logoUrl: null, logoS3Key: null }) },
      update: {
        ...data,
        ...(logoPatch ?? {}),
      },
    });

    if (logoPatch?.logoS3Key && previousConfig?.logoS3Key && previousConfig.logoS3Key !== logoPatch.logoS3Key) {
      await this.storage.delete(previousConfig.logoS3Key).catch(() => undefined);
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

    return this.toResponse(config);
  }

  async getApparence(tenantId: string): Promise<ApparenceResponse> {
    const config = await this.prisma.ecoleConfig.findUnique({
      where: { tenantId },
      select: { themeColor: true, sidebarMode: true, displayMode: true },
    });

    return {
      themeColor: config?.themeColor ?? 'blue',
      sidebarMode: config?.sidebarMode ?? 'light',
      displayMode: config?.displayMode ?? 'light',
    };
  }

  async updateApparence(tenantId: string, dto: UpdateApparenceDto): Promise<ApparenceResponse> {
    const apparenceData = {
      themeColor: dto.themeColor,
      sidebarMode: dto.sidebarMode,
      displayMode: dto.displayMode,
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

    return apparenceData;
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
    if (logoUrl === undefined) {
      return null;
    }

    if (!logoUrl) {
      return { logoUrl: null, logoS3Key: null };
    }

    if (/^https?:\/\//i.test(logoUrl)) {
      // URL complète (déjà stockée en base ou envoyée telle quelle) — normaliser l'hôte
      return { logoUrl: this.storage.resolveUrl(logoUrl) ?? logoUrl, logoS3Key: null };
    }

    const match = logoUrl.match(/^data:image\/(png|jpe?g|svg\+xml|webp);base64,(.+)$/i);
    if (!match) {
      throw new BadRequestException('Logo invalide');
    }

    const subtype = match[1].toLowerCase();
    const contentType = `image/${subtype === 'jpg' ? 'jpeg' : subtype}`;
    const extension = subtype === 'svg+xml' ? 'svg' : subtype === 'jpeg' ? 'jpg' : subtype;
    const buffer = Buffer.from(match[2], 'base64');

    if (!buffer.length || buffer.length > 2_000_000) {
      throw new BadRequestException('Logo invalide ou trop volumineux');
    }

    const key = this.storage.buildKey('logos', tenantId, `logo.${extension}`);
    await this.storage.upload(key, buffer, contentType);
    // Stocker la clé brute — resolveUrl() est appliqué à la lecture
    return { logoUrl: key, logoS3Key: key };
  }
}
