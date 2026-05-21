import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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
      logoUrl: tenant.logoUrl ?? undefined,
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
      create: { tenantId, ...data, logoUrl: dto.logoUrl ?? null },
      update: {
        ...data,
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
      },
    });

    // Keep Tenant base fields in sync for coherence across the platform
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        nom: dto.nom,
        emailContact: dto.email,
        telephone: dto.telephone,
        adresse: dto.adresse,
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
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
      logoUrl: config.logoUrl ?? undefined,
    };
  }
}
