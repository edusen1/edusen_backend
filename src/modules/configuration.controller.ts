import { Controller, Get, Headers } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { EcoleConfigService } from '@/modules/configuration/ecole-config.service';

@Controller('configuration')
export class ConfigurationController {
  constructor(private readonly ecoleConfig: EcoleConfigService) {}

  @Get('ecole-identite')
  getEcoleIdentity(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    const tid = tenantId?.trim() || user?.tenantId;
    return this.ecoleConfig.getEcoleIdentity(tid!);
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
