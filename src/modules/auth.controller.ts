import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import type { MultipartFastifyRequest } from '@/common/types/multipart-request.types';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { AuthService } from '@/modules/auth/auth.service';
import { LoginDto } from '@/modules/auth/dto/login.dto';
import { ForgotPasswordDto } from '@/modules/auth/dto/forgot-password.dto';
import { ResetPasswordDto } from '@/modules/auth/dto/reset-password.dto';
import { ChangePasswordDto } from '@/modules/auth/dto/change-password.dto';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '@/common/decorators/roles.decorator';
import { DomainService } from '@/modules/domain.service';

class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

class ProfileChangeRequestDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  message!: string;
}

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly domain: DomainService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('/health')
  @ApiOperation({ summary: 'Healthcheck public' })
  health() {
    return { ok: true };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion utilisateur par identifiants' })
  login(@Body() dto: LoginDto) {
    const login = (dto.login ?? dto.telephone ?? '').trim();
    if (!login) {
      throw new BadRequestException('Identifiant requis');
    }
    return this.authService.login({ login, password: dto.password });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotation du refresh token' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demande de réinitialisation de mot de passe' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'Si le compte existe, un email a été envoyé.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Réinitialisation du mot de passe' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Mot de passe réinitialisé avec succès' };
  }

  @Get('me')
  @ApiOperation({ summary: 'Informations de l\'utilisateur connecté' })
  me(@CurrentUser() user: JwtUser) {
    return this.authService.me(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Déconnexion (révocation du refresh token)' })
  async logout(@CurrentUser() user: JwtUser) {
    await this.authService.logout(user.sub);
    return { message: 'Déconnecté avec succès' };
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mise à jour du profil' })
  updateProfile(
    @CurrentUser() user: JwtUser,
    @Body() dto: { firstName?: string; lastName?: string; email?: string; telephone?: string | null },
  ) {
    return this.authService.updateProfile(user.sub, dto);
  }

  @Post('switch-role')
  @HttpCode(HttpStatus.OK)
  switchRole(@CurrentUser() user: JwtUser, @Body() dto: { role: string }) {
    return this.authService.switchRole(user.sub, dto.role);
  }

  @Post('mark-seen')
  @HttpCode(HttpStatus.OK)
  async markSeen(@CurrentUser() user: JwtUser, @Body() dto: { feature: string }) {
    if (!dto.feature) return;
    await this.prisma.userFeatureSeen.upsert({
      where: { userId_feature: { userId: user.sub, feature: dto.feature } },
      update: { seenAt: new Date() },
      create: { userId: user.sub, feature: dto.feature, seenAt: new Date() },
    });
    return { ok: true };
  }

  @Get('badges')
  async getBadges(@CurrentUser() user: JwtUser, @Headers('x-tenant-id') tenantId?: string) {
    const tid = tenantId?.trim() || user.tenantId;
    const seenRecords = await this.prisma.userFeatureSeen.findMany({
      where: { userId: user.sub },
    });
    const seenMap = new Map(seenRecords.map((s) => [s.feature, s.seenAt]));

    const badges: Record<string, number> = {};

    // Reductions : count updated after last seen
    const reductionsSeen = seenMap.get('reductions') ?? new Date(0);
    if (user.role === 'ADMIN') {
      badges.reductions = await this.prisma.demandeReduction.count({
        where: { tenantId: tid, statut: 'EN_ATTENTE', createdAt: { gt: reductionsSeen } },
      });
    } else {
      badges.reductions = await this.prisma.demandeReduction.count({
        where: { tenantId: tid, demandePar: user.sub, updatedAt: { gt: reductionsSeen }, statut: { in: ['APPROUVEE', 'REJETEE'] } },
      });
    }

    // Alertes
    const alertesSeen = seenMap.get('alertes') ?? new Date(0);
    const today = new Date();
    const startDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const absToday = await this.prisma.absenceEleve.count({ where: { tenantId: tid, date: { gte: startDay } } });
    const reclamations = await this.prisma.reclamation.count({ where: { tenantId: tid, statut: 'EN_ATTENTE' } });
    const convocations = await this.prisma.convocation.count({ where: { tenantId: tid, statut: 'EN_ATTENTE' } });
    const paiementsAtt = await this.prisma.paiement.count({ where: { tenantId: tid, statut: 'EN_ATTENTE' } });
    // Only show if seenAt is before today (badges reset daily)
    if (alertesSeen < startDay) {
      const total = absToday + reclamations + convocations;
      if (total > 0) badges.alertes = total;
    }
    if (seenMap.get('paiements') == null || (seenMap.get('paiements') as Date) < startDay) {
      if (paiementsAtt > 0) badges.paiements = paiementsAtt;
    }
    if (seenMap.get('reclamations') == null || (seenMap.get('reclamations') as Date) < startDay) {
      if (reclamations > 0) badges.reclamations = reclamations;
    }
    if (seenMap.get('convocations') == null || (seenMap.get('convocations') as Date) < startDay) {
      if (convocations > 0) badges.convocations = convocations;
    }

    return badges;
  }

  @Post('profile-change-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Signaler une correction de profil à l’administrateur de l’école' })
  requestProfileChange(
    @CurrentUser() user: JwtUser,
    @Body() dto: ProfileChangeRequestDto,
  ) {
    return this.domain.requestProfileChange(user.sub, dto.message);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Changement de mot de passe' })
  async changePassword(@CurrentUser() user: JwtUser, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
    return { message: 'Mot de passe changé avec succès' };
  }

  @Post('me/photo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload de la photo de profil' })
  async uploadPhoto(@CurrentUser() user: JwtUser, @Req() req: MultipartFastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('La requête doit être multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('Aucun fichier fourni');

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Format non supporté. Utilisez JPEG, PNG, WebP ou GIF.');
    }

    const buffer = await file.toBuffer();
    const url = await this.authService.uploadProfilePhoto(user.sub, buffer, file.mimetype, file.filename);
    return { photoUrl: url };
  }
}
