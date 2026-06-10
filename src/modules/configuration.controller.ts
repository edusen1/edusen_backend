import { Controller, Get, Headers } from '@nestjs/common';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { EcoleConfigService } from '@/modules/configuration/ecole-config.service';

@Controller('configuration')
export class ConfigurationController {
  constructor(private readonly ecoleConfig: EcoleConfigService) {}

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
}
