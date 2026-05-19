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
  enfantProfil(@Headers('x-tenant-id') tenantId: string, @Param('eleveId') eleveId: string) {
    return this.crud.findOne(this.crud.v1Config('eleves'), tenantId, eleveId);
  }

  @Get('enfants/:eleveId/notes')
  enfantNotes(@Headers('x-tenant-id') tenantId: string, @Param('eleveId') eleveId: string, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('notes'), tenantId, { ...query, eleveId });
  }

  @Get('enfants/:eleveId/bulletins')
  enfantBulletins(@Headers('x-tenant-id') tenantId: string, @Param('eleveId') eleveId: string, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('bulletins'), tenantId, { ...query, eleveId });
  }

  @Get('enfants/:eleveId/emploi-du-temps')
  enfantEmploiDuTemps(@Headers('x-tenant-id') tenantId: string, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('emplois-du-temps'), tenantId, query);
  }

  @Get('enfants/:eleveId/absences')
  enfantAbsences(@Headers('x-tenant-id') tenantId: string, @Param('eleveId') eleveId: string, @Query() query: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('absences-eleves'), tenantId, { ...query, eleveId });
  }

  @Get('paiements')
  paiements(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser, @Query() query?: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('paiements'), tenantId, { ...(query ?? {}), parentId: user?.sub });
  }

  @Get('notifications')
  notifications(@Headers('x-tenant-id') tenantId: string, @CurrentUser() user?: JwtUser, @Query() query?: QueryParams) {
    return this.crud.findAll(this.crud.v1Config('notifications'), tenantId, {
      ...(query ?? {}),
      destinataireId: user?.sub,
    });
  }
}
