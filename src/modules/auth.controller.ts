import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { JwtUser } from '@/common/types/auth.types';
import { AuthService } from '@/modules/auth/auth.service';
import { LoginDto } from '@/modules/auth/dto/login.dto';
import { ForgotPasswordDto } from '@/modules/auth/dto/forgot-password.dto';
import { ResetPasswordDto } from '@/modules/auth/dto/reset-password.dto';
import { ChangePasswordDto } from '@/modules/auth/dto/change-password.dto';
import { IsNotEmpty, IsString } from 'class-validator';

class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

@ApiTags('Auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
    return this.authService.login({ login: dto.telephone, password: dto.password });
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

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Changement de mot de passe' })
  async changePassword(@CurrentUser() user: JwtUser, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
    return { message: 'Mot de passe changé avec succès' };
  }
}
