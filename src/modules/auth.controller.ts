import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
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
  @Roles('ADMIN', 'SUPER_ADMIN', 'GESTIONNAIRE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mise à jour du profil' })
  updateProfile(
    @CurrentUser() user: JwtUser,
    @Body() dto: { firstName?: string; lastName?: string; email?: string; telephone?: string | null },
  ) {
    return this.authService.updateProfile(user.sub, dto);
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
  async uploadPhoto(@CurrentUser() user: JwtUser, @Req() req: FastifyRequest) {
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
