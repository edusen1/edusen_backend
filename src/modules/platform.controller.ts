import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
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

  @Get('tenants/:id')
  findTenantById(@Param('id') id: string) { return this.platformService.findTenantById(id); }

  @Put('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() dto: Partial<CreateTenantDto>) { return this.platformService.updateTenant(id, dto); }

  @Post('tenants/auto-register')
  autoRegisterTenant(@Body() dto: CreateTenantDto) { return this.platformService.createTenant(dto); }

  @Roles('SUPER_ADMIN')
  @Post('tenants/:id/suspend')
  suspendTenant(@Param('id') id: string) { return this.platformService.suspendTenant(id); }

  @Roles('SUPER_ADMIN')
  @Post('tenants/:id/reactivate')
  reactivateTenant(@Param('id') id: string) { return this.platformService.reactivateTenant(id); }

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
  auditLogs() { return { message: 'Audit logs à connecter' }; }
}
