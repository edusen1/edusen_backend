import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Roles } from '@/common/decorators/roles.decorator';
import { PlatformService } from '@/modules/platform/platform.service';
import { CreateTenantDto } from '@/modules/platform/dto/create-tenant.dto';
import { CreateUserDto } from '@/modules/platform/dto/create-user.dto';

@Roles('SUPER_ADMIN', 'GESTIONNAIRE')
@Controller('platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('tenants')
  findTenants() { return this.platformService.findTenants(); }

  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) { return this.platformService.createTenant(dto); }

  @Post('tenants/auto-register')
  autoRegisterTenant(@Body() dto: CreateTenantDto) { return this.platformService.createTenant(dto); }

  @Get('tenants/:id')
  findTenantById(@Param('id') id: string) { return this.platformService.findTenantById(id); }

  @Put('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() dto: Partial<CreateTenantDto>) { return this.platformService.updateTenant(id, dto); }

  @Roles('SUPER_ADMIN')
  @Post('tenants/:id/suspend')
  suspendTenant(@Param('id') id: string) { return this.platformService.suspendTenant(id); }

  @Roles('SUPER_ADMIN')
  @Post('tenants/:id/reactivate')
  reactivateTenant(@Param('id') id: string) { return this.platformService.reactivateTenant(id); }

  @Post('tenants/:id/logo')
  async uploadLogo(@Param('id') id: string, @Req() req: FastifyRequest, @Body() body?: { logoUrl?: string }) {
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw new BadRequestException('Aucun logo fourni');

      const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
      if (!allowed.includes(file.mimetype)) {
        throw new BadRequestException('Format invalide. PNG, JPEG, WebP ou SVG uniquement.');
      }

      const buffer = await file.toBuffer();
      if (buffer.byteLength > 2 * 1024 * 1024) {
        throw new BadRequestException('Logo trop lourd. Maximum 2 Mo.');
      }

      return this.platformService.uploadTenantLogo(id, buffer, file.mimetype, file.filename);
    }

    if (body?.logoUrl !== undefined) {
      const tenant = await this.platformService.updateTenant(id, { logoUrl: body.logoUrl });
      return { logoUrl: tenant.logoUrl };
    }

    throw new BadRequestException('Aucun logo fourni');
  }

  @Roles('SUPER_ADMIN')
  @Delete('tenants/:id')
  deleteTenant(@Param('id') id: string) { return this.platformService.deleteTenant(id); }

  @Get('utilisateurs')
  listUsers() { return this.platformService.listUsers(); }

  @Post('utilisateurs')
  createUser(@Body() dto: CreateUserDto) { return this.platformService.createUser(dto); }

  @Get('utilisateurs/:id')
  getUser(@Param('id') id: string) { return this.platformService.getUser(id); }

  @Delete('utilisateurs/:id')
  deleteUser(@Param('id') id: string) { return this.platformService.deleteUser(id); }

  @Patch('utilisateurs/:id/actif')
  setUserActive(@Param('id') id: string, @Query('actif') actif?: string) {
    return this.platformService.setUserActive(id, actif !== 'false');
  }

  @Get('stats')
  stats() { return this.platformService.stats(); }

  @Get('audit-logs')
  auditLogs(
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('action') action?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.platformService.auditLogs(Number(page ?? 0), Number(size ?? 20), { action, tenantId });
  }
}
