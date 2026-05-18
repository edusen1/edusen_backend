import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@/config/prisma.service';
import { CreateTenantDto } from '@/modules/platform/dto/create-tenant.dto';
import { CreateUserDto } from '@/modules/platform/dto/create-user.dto';
import { BadRequestException } from '@nestjs/common';
import { rethrowServiceError } from '@/common/utils/service-error.util';

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  findTenants() { return this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } }); }
  async createTenant(dto: CreateTenantDto) {
    try {
      return await this.prisma.tenant.create({ data: dto });
    } catch (error) {
      rethrowServiceError(error, 'création tenant');
    }
  }
  findTenantById(id: string) { return this.prisma.tenant.findUnique({ where: { id } }); }
  updateTenant(id: string, dto: Partial<CreateTenantDto>) { return this.prisma.tenant.update({ where: { id }, data: dto }); }
  suspendTenant(id: string) { return this.prisma.tenant.update({ where: { id }, data: { actif: false } }); }
  reactivateTenant(id: string) { return this.prisma.tenant.update({ where: { id }, data: { actif: true } }); }
  deleteTenant(id: string) { return this.prisma.tenant.delete({ where: { id } }); }

  listUsers() { return this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } }); }
  getUser(id: string) { return this.prisma.user.findUnique({ where: { id } }); }

  async createUser(dto: CreateUserDto) {
    try {
      if (!dto.tenantId) {
        throw new BadRequestException('tenantId est requis');
      }
      const passwordHash = await bcrypt.hash(dto.password, 12);
      return await this.prisma.user.create({
        data: {
          firstName: dto.prenom,
          lastName: dto.nom,
          email: dto.email,
          role: dto.role,
          passwordHash,
          mustChangePwd: true,
          tenantId: dto.tenantId,
        },
      });
    } catch (error) {
      rethrowServiceError(error, 'création utilisateur plateforme');
    }
  }

  deleteUser(id: string) { return this.prisma.user.delete({ where: { id } }); }
  setUserActive(id: string, actif: boolean) { return this.prisma.user.update({ where: { id }, data: { actif } }); }

  async stats() {
    const [tenants, users] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.user.count(),
    ]);
    return { tenants, users };
  }
}
