import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { DomainService } from '@/modules/domain.service';
import { LegacyCrudService } from '@/modules/legacy-crud.service';

type QueryParams = Record<string, string | string[] | undefined>;

@Roles('PARENT')
@Controller('parent')
export class ParentController {
  constructor(
    private readonly domain: DomainService,
    private readonly crud: LegacyCrudService,
  ) {}

  @Get('profil')
  profil(@CurrentUser() user?: JwtUser) {
    return user ? this.domain.studentProfil(user.sub) : null;
  }

  @Get('enfants')
  enfants(@CurrentUser() user?: JwtUser) {
    return user ? this.crud.parentChildren(user.sub) : [];
  }

  @Get('enfants/:eleveId/profil')
  async enfantProfil(@CurrentUser() user: JwtUser, @Param('eleveId') eleveId: string) {
    await this.domain.assertParentChild(user.sub, eleveId);
    return this.domain.studentProfil(eleveId);
  }

  @Get('enfants/:eleveId/notes')
  async enfantNotes(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: JwtUser,
    @Param('eleveId') eleveId: string,
    @Query() query: QueryParams,
  ) {
    await this.domain.assertParentChild(user.sub, eleveId);
    return this.domain.studentNotes(tenantId, eleveId, typeof query.trimestre === 'string' ? query.trimestre : undefined);
  }

  @Get('enfants/:eleveId/bulletins')
  async enfantBulletins(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: JwtUser,
    @Param('eleveId') eleveId: string,
  ) {
    await this.domain.assertParentChild(user.sub, eleveId);
    return this.domain.studentBulletins(tenantId, eleveId);
  }

  @Get('enfants/:eleveId/emploi-du-temps')
  async enfantEmploiDuTemps(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: JwtUser,
    @Param('eleveId') eleveId: string,
  ) {
    await this.domain.assertParentChild(user.sub, eleveId);
    return this.domain.studentEmploiDuTemps(tenantId, eleveId);
  }

  @Get('enfants/:eleveId/absences')
  async enfantAbsences(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: JwtUser,
    @Param('eleveId') eleveId: string,
  ) {
    await this.domain.assertParentChild(user.sub, eleveId);
    return this.domain.studentAbsences(tenantId, eleveId);
  }

  @Get('paiements')
  paiements(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser) {
    return user ? this.domain.parentPaiements(tenantId, user.sub) : [];
  }

  @Get('notifications')
  notifications(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser, @Query() query?: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('notifications'), tenantId, {
      ...(query ?? {}),
      destinataireId: user?.sub,
    });
  }
}
