import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import type { JwtUser } from '@/common/types/auth.types';

type CodeType = 'ELEVE' | 'ENSEIGNANT' | 'CAISSIER' | 'ADMIN' | 'SURVEILLANT' | 'RH';

const ROLE_FILTER: Record<CodeType, object> = {
  ELEVE:       { role: UserRole.ELEVE },
  ENSEIGNANT:  { role: UserRole.ENSEIGNANT },
  CAISSIER:    { role: UserRole.CAISSIER },
  ADMIN:       { role: { in: [UserRole.ADMIN, UserRole.GESTIONNAIRE] } },
  SURVEILLANT: { role: UserRole.SURVEILLANT },
  RH:          { role: UserRole.RH },
};

const LOCKOUT_KEY = 'auth:lockout:';
const RATELIMIT_FORGOT_KEY = 'auth:ratelimit:forgot:';
const REFRESH_TOKEN_DAYS = Number(process.env.AUTH_REFRESH_TOKEN_DAYS ?? 1);
const REFRESH_TOKEN_SECONDS = REFRESH_TOKEN_DAYS * 24 * 60 * 60;
const LOCKOUT_MAX_ATTEMPTS = Number(process.env.AUTH_LOCKOUT_MAX_ATTEMPTS ?? 5);
const LOCKOUT_TTL = Number(process.env.AUTH_LOCKOUT_TTL_SECONDS ?? 600);
const FORGOT_PER_EMAIL = Number(process.env.AUTH_FORGOT_PER_EMAIL ?? 3);
const FORGOT_WINDOW = Number(process.env.AUTH_FORGOT_WINDOW_SECONDS ?? 900);
const RESET_TOKEN_TTL = Number(process.env.AUTH_RESET_TOKEN_TTL_SECONDS ?? 3600);
const PASSWORD_MIN_LENGTH = Number(process.env.PASSWORD_MIN_LENGTH ?? 12);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly mailService: MailService,
  ) {}

  // ==================== LOGIN ====================

  async login(dto: { login: string; password: string; code?: string }): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number;
    refreshExpiresIn: number;
    passwordChangeRequired: boolean;
  }> {
    const normalizedLogin = dto.login.trim().toLowerCase();
    const rawLogin = dto.login.trim();
    const lockoutKey = LOCKOUT_KEY + this.normalizeLockoutKey(dto.login);

    const { count: attempts, lastEpoch } = await this.redis.getLockoutAttempts(lockoutKey);
    if (attempts >= LOCKOUT_MAX_ATTEMPTS) {
      throw new UnauthorizedException('COMPTE_VERROUILLE');
    }
    this.checkExponentialDelay(attempts, lastEpoch);

    if (!dto.code) {
      throw new UnauthorizedException('CODE_ACCES_REQUIS');
    }

    // Résolution du tenant + type d'accès via le code opaque
    const { tenant, type } = await this.resolveTenantByCode(dto.code);

    const roleFilter = ROLE_FILTER[type];

    const loginConditions = [
      { telephone: normalizedLogin },
      { matricule: { equals: rawLogin, mode: Prisma.QueryMode.insensitive } },
    ];

    const user = await this.prisma.user.findFirst({
      where: {
        tenantId: tenant.id,
        ...roleFilter,
        OR: loginConditions,
      },
      include: { tenant: true },
    });

    if (!user) {
      await this.redis.incrementLockout(lockoutKey, LOCKOUT_TTL);
      throw new UnauthorizedException('IDENTIFIANTS_INVALIDES');
    }

    if (!user.actif) throw new UnauthorizedException('USER_INACTIVE');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      const newAttempts = await this.redis.incrementLockout(lockoutKey, LOCKOUT_TTL);
      if (newAttempts >= LOCKOUT_MAX_ATTEMPTS) {
        throw new UnauthorizedException('COMPTE_VERROUILLE');
      }
      throw new UnauthorizedException('IDENTIFIANTS_INVALIDES');
    }

    await this.redis.del(lockoutKey);

    const payload: JwtUser = {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
      email: user.email ?? undefined,
      telephone: user.telephone ?? undefined,
      isPlatform: false,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refreshToken = await this.createRefreshToken(user.id);
    const mustChange = user.mustChangePwd ?? true;

    this.logger.log(`Login success userId=${user.id} role=${user.role} type=${type}`);
    return { accessToken, refreshToken, expiresIn: 900, refreshExpiresIn: REFRESH_TOKEN_SECONDS, passwordChangeRequired: mustChange };
  }

  async getSchoolByCode(code: string): Promise<{ nom: string; type: CodeType }> {
    const { tenant, type } = await this.resolveTenantByCode(code);
    return { nom: tenant.nom, type };
  }

  private async resolveTenantByCode(code: string): Promise<{
    tenant: { id: string; nom: string; slug: string; actif: boolean };
    type: CodeType;
  }> {
    const codeFields: Array<[string, CodeType]> = [
      ['codeAccesEleve', 'ELEVE'],
      ['codeAccesEnseignant', 'ENSEIGNANT'],
      ['codeAccesCaissier', 'CAISSIER'],
      ['codeAccesAdmin', 'ADMIN'],
      ['codeAccesSurveillant', 'SURVEILLANT'],
      ['codeAccesRh', 'RH'],
    ];

    for (const [field, type] of codeFields) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tenant = await this.prisma.tenant.findFirst({
        where: { [field]: code } as any,
        select: { id: true, nom: true, slug: true, actif: true },
      });
      if (tenant) {
        if (!tenant.actif) throw new UnauthorizedException('TENANT_INACTIF');
        return { tenant, type };
      }
    }

    throw new NotFoundException('CODE_ACCES_INVALIDE');
  }

  private async loginPlatformUser(
    dto: { login: string; password: string },
    lockoutKey: string,
    normalizedLogin: string,
  ): Promise<{
    accessToken: string;
    refreshToken: null;
    expiresIn: number;
    refreshExpiresIn: number;
    passwordChangeRequired: boolean;
  }> {
    const pu = await this.prisma.plateformeUtilisateur.findUnique({
      where: { email: normalizedLogin },
    });

    if (!pu) {
      await this.redis.incrementLockout(lockoutKey, LOCKOUT_TTL);
      throw new UnauthorizedException('IDENTIFIANTS_INVALIDES');
    }

    if (!pu.actif) {
      throw new UnauthorizedException('USER_INACTIVE');
    }

    const valid = await bcrypt.compare(dto.password, pu.motDePasse);
    if (!valid) {
      const newAttempts = await this.redis.incrementLockout(lockoutKey, LOCKOUT_TTL);
      if (newAttempts >= LOCKOUT_MAX_ATTEMPTS) {
        throw new UnauthorizedException('COMPTE_VERROUILLE');
      }
      throw new UnauthorizedException('IDENTIFIANTS_INVALIDES');
    }

    await this.redis.del(lockoutKey);

    const payload: JwtUser = {
      sub: pu.id,
      role: pu.rolePlateforme as 'SUPER_ADMIN' | 'GESTIONNAIRE',
      email: pu.email,
      isPlatform: true,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    this.logger.log(`Platform login success userId=${pu.id} role=${pu.rolePlateforme}`);
    return { accessToken, refreshToken: null, expiresIn: 900, refreshExpiresIn: 0, passwordChangeRequired: false };
  }

  // ==================== REFRESH ====================

  async refresh(refreshTokenValue: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    refreshExpiresIn: number;
  }> {
    const normalizedRefreshToken = (refreshTokenValue ?? '').trim();
    if (!normalizedRefreshToken || normalizedRefreshToken === 'null' || normalizedRefreshToken === 'undefined') {
      throw new UnauthorizedException('REFRESH_TOKEN_INVALID');
    }

    const tokenHash = createHash('sha256').update(normalizedRefreshToken).digest('hex');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('REFRESH_TOKEN_INVALID');

    if (stored.revoked) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revoked: false },
        data: { revoked: true },
      });
      throw new UnauthorizedException('REFRESH_TOKEN_INVALID');
    }

    if (stored.expiresAt < new Date()) {
      await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
      throw new UnauthorizedException('REFRESH_TOKEN_EXPIRED');
    }

    if (!stored.user.actif) throw new UnauthorizedException('USER_INACTIVE');

    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
    const newRefreshToken = await this.createRefreshToken(stored.userId);

    const payload: JwtUser = {
      sub: stored.user.id,
      role: stored.user.role,
      tenantId: stored.user.tenantId,
      email: stored.user.email ?? undefined,
      telephone: stored.user.telephone ?? undefined,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });
    return { accessToken, refreshToken: newRefreshToken, expiresIn: 900, refreshExpiresIn: REFRESH_TOKEN_SECONDS };
  }

  // ==================== ME ====================

  async me(user: JwtUser): Promise<unknown> {
    if (user.isPlatform) {
      const pu = await this.prisma.plateformeUtilisateur.findUnique({
        where: { id: user.sub },
        select: { id: true, email: true, nom: true, prenom: true, rolePlateforme: true, actif: true },
      });
      if (!pu) throw new UnauthorizedException('Utilisateur introuvable');
      return { ...pu, role: pu.rolePlateforme, isPlatform: true };
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        actif: true,
        mustChangePwd: true,
        telephone: true,
        photoUrl: true,
      },
    });

    if (!dbUser) throw new UnauthorizedException('Utilisateur introuvable');

    let cycles: string[] = [];
    if (dbUser.role === 'SURVEILLANT') {
      const sc = await this.prisma.surveillantCycle.findMany({
        where: { surveillantId: user.sub },
        include: { cycle: true },
      });
      cycles = sc.map((s: { cycle: { code: string } }) => s.cycle.code);
    }

    return {
      id: dbUser.id,
      email: dbUser.email,
      nom: dbUser.lastName,
      prenom: dbUser.firstName,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      role: dbUser.role,
      tenantId: dbUser.tenantId,
      actif: dbUser.actif,
      mustChangePwd: dbUser.mustChangePwd,
      telephone: dbUser.telephone,
      photoUrl: dbUser.photoUrl,
      cycles,
    };
  }

  // ==================== UPDATE PROFILE ====================

  async updateProfile(userId: string, dto: { firstName?: string; lastName?: string; email?: string; telephone?: string | null }): Promise<unknown> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    const data: Prisma.UserUpdateInput = {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
      ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
      ...(dto.telephone !== undefined ? { telephone: dto.telephone?.trim() || null } : {}),
    };

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data,
        select: { id: true, email: true, firstName: true, lastName: true, telephone: true, role: true },
      });

      return {
        id: updated.id,
        email: updated.email,
        nom: updated.lastName,
        prenom: updated.firstName,
        firstName: updated.firstName,
        lastName: updated.lastName,
        telephone: updated.telephone,
        role: updated.role,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('EMAIL_DEJA_UTILISE');
      }
      throw error;
    }
  }

  // ==================== LOGOUT ====================

  async logout(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  // ==================== FORGOT PASSWORD ====================

  async forgotPassword(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const rateKey = RATELIMIT_FORGOT_KEY + this.normalizeLockoutKey(normalizedEmail);

    const count = await this.redis.getCount(rateKey);
    if (count >= FORGOT_PER_EMAIL) {
      throw new BadRequestException('TOO_MANY_REQUESTS');
    }
    await this.redis.incr(rateKey);
    await this.redis.expire(rateKey, FORGOT_WINDOW);

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { username: normalizedEmail }],
      },
    });

    if (!user) return; // silent - ne pas révéler l'existence

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL * 1000);

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const frontendBase =
      process.env.FRONTEND_RESET_URL ?? 'http://localhost:4200/reset-password';
    const resetUrl = `${frontendBase}?token=${rawToken}`;

    this.mailService.sendPasswordReset(user.email ?? '', resetUrl);
  }

  // ==================== RESET PASSWORD ====================

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token || !newPassword) throw new BadRequestException('RESET_TOKEN_INVALIDE');
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      throw new BadRequestException('MOT_DE_PASSE_TROP_COURT');
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const stored = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });

    if (!stored) throw new BadRequestException('RESET_TOKEN_INVALIDE');

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash, mustChangePwd: false },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revoked: false },
        data: { revoked: true },
      }),
    ]);
  }

  // ==================== CHANGE PASSWORD ====================

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('MOT_DE_PASSE_ACTUEL_INCORRECT');

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      throw new BadRequestException('MOT_DE_PASSE_TROP_COURT');
    }

    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException('NOUVEAU_MOT_DE_PASSE_IDENTIQUE');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePwd: false },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
    ]);
  }

  // ==================== HELPERS ====================

  private async createRefreshToken(userId: string): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000);

    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { userId, OR: [{ revoked: true }, { expiresAt: { lt: new Date() } }] },
      }),
      this.prisma.refreshToken.create({
        data: { userId, tokenHash, expiresAt, revoked: false },
      }),
    ]);

    return rawToken;
  }

  private checkExponentialDelay(attempts: number, lastEpoch: number): void {
    if (attempts <= 0 || lastEpoch === 0) return;
    const delaySeconds = Math.min(1 << Math.min(attempts, 7), 120);
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (nowEpoch - lastEpoch < delaySeconds) {
      throw new UnauthorizedException('COMPTE_VERROUILLE');
    }
  }

  private normalizeLockoutKey(login: string): string {
    return (login ?? '').trim().toLowerCase().replace(/[^a-z0-9@.+\-]/g, '_');
  }
}
