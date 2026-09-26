import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { EcoleConfigService } from '@/modules/configuration/ecole-config.service';
import { FournitureService } from '@/modules/configuration/fourniture.service';

@Controller('configuration')
export class ConfigurationController {
  constructor(
    private readonly ecoleConfig: EcoleConfigService,
    private readonly fournitureService: FournitureService,
  ) {}

  // Public : appelé par la page de connexion (avant authentification) pour
  // afficher le nom et le logo de l'établissement. Sans tenant fourni, le
  // service retombe sur l'établissement par défaut (déploiement mono-école).
  @Public()
  @Get('ecole-identite')
  getEcoleIdentity(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.ecoleConfig.getEcoleIdentity(tid);
  }

  @Get('apparence')
  getApparence(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.ecoleConfig.getApparence(tid!);
  }

  // -------------------- FOURNITURES --------------------

  @Roles('ADMIN')
  @Get('fournitures')
  getFournitures(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
    @Query('niveauId') niveauId?: string,
  ) {
    const tid = (tenantId?.trim() || user?.tenantId)!;
    if (niveauId) return this.fournitureService.findByNiveau(tid, niveauId);
    return this.fournitureService.findAll(tid);
  }

  @Roles('ADMIN')
  @Post('fournitures')
  createFourniture(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: { niveauId: string; nom: string; quantite?: number; description?: string; obligatoire?: boolean; ordre?: number; serie?: string | null },
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = (tenantId?.trim() || user?.tenantId)!;
    return this.fournitureService.create(tid, body);
  }

  @Roles('ADMIN')
  @Put('fournitures/:id')
  updateFourniture(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: { nom?: string; quantite?: number; description?: string; obligatoire?: boolean; ordre?: number; serie?: string | null },
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = (tenantId?.trim() || user?.tenantId)!;
    return this.fournitureService.update(tid, id, body);
  }

  @Roles('ADMIN')
  @Delete('fournitures/:id')
  deleteFourniture(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = (tenantId?.trim() || user?.tenantId)!;
    return this.fournitureService.remove(tid, id);
  }
}
