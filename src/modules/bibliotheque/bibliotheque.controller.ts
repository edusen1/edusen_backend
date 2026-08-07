import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { BibliothequeService } from './bibliotheque.service';

type Payload = Record<string, unknown>;

/**
 * Bibliothèque.
 *
 * Le catalogue et les emprunts sont gérés par l'administration ; chaque élève et
 * chaque enseignant consulte ses propres emprunts via `/bibliotheque/mes-emprunts`,
 * sans jamais voir ceux des autres.
 */
@Controller('bibliotheque')
export class BibliothequeController {
  constructor(private readonly bibliotheque: BibliothequeService) {}

  private tenant(tenantId: string | undefined, user?: JwtUser): string {
    const tid = tenantId?.trim() || user?.tenantId;
    if (!tid) throw new BadRequestException('Tenant introuvable');
    return tid;
  }

  // ── Catalogue ─────────────────────────────────────────────────────

  /** Consultable par tous : un élève doit pouvoir chercher un ouvrage. */
  @Get('ouvrages')
  listOuvrages(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query() query: Record<string, string>,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.listOuvrages(this.tenant(tenantId, user), query);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Post('ouvrages')
  createOuvrage(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.createOuvrage(this.tenant(tenantId, user), body);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Patch('ouvrages/:id')
  updateOuvrage(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.updateOuvrage(this.tenant(tenantId, user), id, body);
  }

  /** Retrait du catalogue : l'ouvrage est archivé, jamais effacé. */
  @Roles('ADMIN')
  @Delete('ouvrages/:id')
  archiverOuvrage(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.archiverOuvrage(this.tenant(tenantId, user), id);
  }

  // ── Emprunts ──────────────────────────────────────────────────────

  @Roles('ADMIN', 'SURVEILLANT')
  @Get('emprunts')
  listEmprunts(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query() query: Record<string, string>,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.listEmprunts(this.tenant(tenantId, user), query);
  }

  /** Situation d'un emprunteur, affichée avant de valider un prêt. */
  @Roles('ADMIN', 'SURVEILLANT')
  @Get('emprunteurs/:id/situation')
  situationEmprunteur(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.situationEmprunteur(this.tenant(tenantId, user), id);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Post('emprunts')
  creerEmprunt(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.creerEmprunt(this.tenant(tenantId, user), body, user?.sub);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Post('emprunts/:id/retour')
  retourner(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.retournerEmprunt(this.tenant(tenantId, user), id);
  }

  @Roles('ADMIN', 'SURVEILLANT')
  @Post('emprunts/:id/perte')
  declarerPerte(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: { observations?: string },
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.declarerPerte(this.tenant(tenantId, user), id, body?.observations);
  }

  /** Encaissement d'une amende : crée l'écriture de caisse et la relie à l'emprunt. */
  @Roles('ADMIN', 'CAISSIER')
  @Post('emprunts/:id/amende/regler')
  reglerAmende(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.reglerAmende(this.tenant(tenantId, user), id, body ?? {}, user?.sub);
  }

  /**
   * Emprunts de l'utilisateur connecté. L'identifiant vient du jeton et non
   * d'un paramètre : sans cela, n'importe qui consulterait les emprunts d'autrui.
   */
  @Get('mes-emprunts')
  mesEmprunts(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    if (!user?.sub) throw new BadRequestException('Utilisateur inconnu');
    return this.bibliotheque.mesEmprunts(this.tenant(tenantId, user), user.sub);
  }

  // ── Tarifs ────────────────────────────────────────────────────────

  @Get('tarifs')
  getTarifs(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.getTarifs(this.tenant(tenantId, user));
  }

  @Roles('ADMIN')
  @Put('tarifs')
  updateTarifs(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body() body: Payload,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.bibliotheque.updateTarifs(this.tenant(tenantId, user), body as never);
  }
}
