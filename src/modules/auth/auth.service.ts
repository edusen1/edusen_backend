import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import type { JwtUser } from '@/common/types/auth.types';
import { buildPhoneLoginVariants, normalizePhoneForCountry } from '@/common/utils/phone.util';
import { AsyncSemaphore, mapWithConcurrency } from '@/common/utils/async.util';
import { PASSWORD_MIN_LENGTH } from './auth.constants';

const LOCKOUT_KEY = 'auth:lockout:';
const RATELIMIT_FORGOT_KEY = 'auth:ratelimit:forgot:';
const ACCESS_TOKEN_SECONDS = Number(process.env.AUTH_ACCESS_TOKEN_SECONDS ?? 86400); // 24h par défaut
const ACCESS_TOKEN_EXPIRY = `${ACCESS_TOKEN_SECONDS}s` as `${number}s`;
const REFRESH_TOKEN_DAYS = Number(process.env.AUTH_REFRESH_TOKEN_DAYS ?? 30);
const REFRESH_TOKEN_SECONDS = REFRESH_TOKEN_DAYS * 24 * 60 * 60;
const LOCKOUT_MAX_ATTEMPTS = Number(process.env.AUTH_LOCKOUT_MAX_ATTEMPTS ?? 5);
const LOCKOUT_TTL = Number(process.env.AUTH_LOCKOUT_TTL_SECONDS ?? 600);
const FORGOT_PER_EMAIL = Number(process.env.AUTH_FORGOT_PER_EMAIL ?? 3);
const FORGOT_WINDOW = Number(process.env.AUTH_FORGOT_WINDOW_SECONDS ?? 900);
const RESET_TOKEN_TTL = Number(process.env.AUTH_RESET_TOKEN_TTL_SECONDS ?? 3600);
const LOGIN_PASSWORD_COMPARE_CONCURRENCY = Math.max(1, Number(process.env.AUTH_PASSWORD_COMPARE_CONCURRENCY ?? 4));
const LOGIN_CANDIDATE_CONCURRENCY = Math.max(1, Number(process.env.AUTH_LOGIN_CANDIDATE_CONCURRENCY ?? 2));
const LOGIN_MAX_CANDIDATES = Math.max(1, Number(process.env.AUTH_LOGIN_MAX_CANDIDATES ?? 12));
const loginPasswordSemaphore = new AsyncSemaphore(LOGIN_PASSWORD_COMPARE_CONCURRENCY);
// PASSWORD_MIN_LENGTH est désormais centralisé dans auth.constants.ts pour rester
// aligné avec les DTO (évite l'erreur MOT_DE_PASSE_TROP_COURT sur un mot de passe
// pourtant accepté par la validation de la requête).

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly mailService: MailService,
    private readonly storage: StorageService,
  ) {}

  // ==================== LOGIN ====================

  async login(dto: { login: string; password: string }): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number;
    refreshExpiresIn: number;
    passwordChangeRequired: boolean;
  }> {
    const login = dto.login.trim().toLowerCase();
    const rawLogin = dto.login.trim();
    const lockoutKey = LOCKOUT_KEY + this.normalizeLockoutKey(dto.login);

    const { count: attempts, lastEpoch } = await this.redis.getLockoutAttempts(lockoutKey);
    if (attempts >= LOCKOUT_MAX_ATTEMPTS) {
      throw new UnauthorizedException('COMPTE_VERROUILLE');
    }
    this.checkExponentialDelay(attempts, lastEpoch);

    const schoolLogin = await this.loginTenantUser({ login: dto.login, password: dto.password }, lockoutKey, login, rawLogin);
    if (schoolLogin) {
      return schoolLogin;
    }

    return this.loginPlatformUser({ login: dto.login, password: dto.password }, lockoutKey, login, rawLogin);
  }

  private async loginTenantUser(
    dto: { login: string; password: string },
    lockoutKey: string,
    normalizedLogin: string,
    rawLogin: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    refreshExpiresIn: number;
    passwordChangeRequired: boolean;
  } | null> {
    const loginConditions: Prisma.UserWhereInput[] = [
      ...this.phoneLoginVariants(rawLogin).map((telephone) => ({ telephone })),
      { email: { equals: normalizedLogin, mode: Prisma.QueryMode.insensitive } },
      { username: { equals: normalizedLogin, mode: Prisma.QueryMode.insensitive } },
      { matricule: { equals: rawLogin, mode: Prisma.QueryMode.insensitive } },
    ];

    const candidates = await this.prisma.user.findMany({
      where: {
        OR: loginConditions,
      },
      take: LOGIN_MAX_CANDIDATES + 1,
      select: {
        id: true,
        tenantId: true,
        passwordHash: true,
        actif: true,
        mustChangePwd: true,
        role: true,
        email: true,
        telephone: true,
        tenant: { select: { actif: true } },
      },
    });

    if (!candidates.length) {
      return null;
    }

    // A crafted identifier must not trigger unbounded bcrypt work across tenants.
    if (candidates.length > LOGIN_MAX_CANDIDATES) {
      throw new UnauthorizedException('IDENTIFIANTS_AMBIGUS');
    }

    const comparisons = await mapWithConcurrency(candidates, LOGIN_CANDIDATE_CONCURRENCY, async (candidate) => ({
      candidate,
      matches: await loginPasswordSemaphore.run(() => bcrypt.compare(dto.password, candidate.passwordHash)),
    }));
    const matches = comparisons.filter((comparison) => comparison.matches).map((comparison) => comparison.candidate);

    if (!matches.length) {
      return null;
    }

    if (matches.length > 1) {
      throw new UnauthorizedException('IDENTIFIANTS_AMBIGUS');
    }

    const user = matches[0];
    if (!user.actif) throw new UnauthorizedException('USER_INACTIVE');
    if (!user.tenant.actif) throw new UnauthorizedException('TENANT_INACTIF');

    await this.redis.del(lockoutKey);

    const payload: JwtUser & { userId: string; accountType: 'TENANT'; groups: string[] } = {
      sub: user.id,
      userId: user.id,
      role: user.role,
      groups: [user.role],
      accountType: 'TENANT',
      tenantId: user.tenantId,
      email: user.email ?? undefined,
      telephone: user.telephone ?? undefined,
      isPlatform: false,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = await this.createRefreshToken(user.id);
    const mustChange = user.mustChangePwd ?? true;

    this.logger.log(`Login success userId=${user.id} role=${user.role} tenantId=${user.tenantId}`);
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_SECONDS, refreshExpiresIn: REFRESH_TOKEN_SECONDS, passwordChangeRequired: mustChange };
  }

  private async loginPlatformUser(
    dto: { login: string; password: string },
    lockoutKey: string,
    normalizedLogin: string,
    rawLogin: string,
  ): Promise<{
    accessToken: string;
    refreshToken: null;
    expiresIn: number;
    refreshExpiresIn: number;
    passwordChangeRequired: boolean;
  }> {
    const phoneVariants = this.phoneLoginVariants(rawLogin);
    const pu = await this.prisma.plateformeUtilisateur.findFirst({
      where: {
        OR: [
          { email: { equals: normalizedLogin, mode: Prisma.QueryMode.insensitive } },
          ...phoneVariants.map((telephone) => ({ telephone })),
        ],
      },
    });

    if (!pu) {
      await this.redis.incrementLockout(lockoutKey, LOCKOUT_TTL);
      throw new UnauthorizedException('IDENTIFIANTS_INVALIDES');
    }

    if (!pu.actif) {
      throw new UnauthorizedException('USER_INACTIVE');
    }

    const valid = await loginPasswordSemaphore.run(() => bcrypt.compare(dto.password, pu.motDePasse));
    if (!valid) {
      const newAttempts = await this.redis.incrementLockout(lockoutKey, LOCKOUT_TTL);
      if (newAttempts >= LOCKOUT_MAX_ATTEMPTS) {
        throw new UnauthorizedException('COMPTE_VERROUILLE');
      }
      throw new UnauthorizedException('IDENTIFIANTS_INVALIDES');
    }

    await this.redis.del(lockoutKey);

    const payload: JwtUser & { userId: string; accountType: 'PLATFORM'; groups: string[] } = {
      sub: pu.id,
      userId: pu.id,
      role: pu.rolePlateforme as 'SUPER_ADMIN' | 'GESTIONNAIRE',
      groups: [pu.rolePlateforme],
      accountType: 'PLATFORM',
      email: pu.email,
      isPlatform: true,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: ACCESS_TOKEN_EXPIRY });
    this.logger.log(`Platform login success userId=${pu.id} role=${pu.rolePlateforme}`);
    return { accessToken, refreshToken: null, expiresIn: ACCESS_TOKEN_SECONDS, refreshExpiresIn: 0, passwordChangeRequired: false };
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

    const accessToken = this.jwtService.sign(payload, { expiresIn: ACCESS_TOKEN_EXPIRY });
    return { accessToken, refreshToken: newRefreshToken, expiresIn: ACCESS_TOKEN_SECONDS, refreshExpiresIn: REFRESH_TOKEN_SECONDS };
  }

  // ==================== ME ====================

  async me(user: JwtUser): Promise<unknown> {
    if (user.isPlatform) {
      const pu = await this.prisma.plateformeUtilisateur.findUnique({
        where: { id: user.sub },
        select: { id: true, email: true, telephone: true, nom: true, prenom: true, rolePlateforme: true, actif: true },
      });
      if (!pu) throw new UnauthorizedException('Utilisateur introuvable');
      return { ...pu, role: pu.rolePlateforme, isPlatform: true, accountType: 'PLATFORM', groups: [pu.rolePlateforme] };
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
    let surveillantScope: 'GENERAL' | 'CYCLES' | null = null;
    if (dbUser.role === 'SURVEILLANT') {
      const sc = await this.prisma.surveillantCycle.findMany({
        where: { surveillantId: user.sub },
        include: { cycle: true },
      });
      cycles = sc.map((s: { cycle: { code: string } }) => s.cycle.code);
      surveillantScope = cycles.length ? 'CYCLES' : 'GENERAL';
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
      photoUrl: this.storage.resolveUrl(dbUser.photoUrl),
      cycles,
      surveillantScope,
    };
  }

  // ==================== UPDATE PROFILE ====================

  async updateProfile(userId: string, dto: { firstName?: string; lastName?: string; email?: string; telephone?: string | null }): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true },
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    const phoneCountry = await this.resolveTenantPhoneCountry(user.tenantId);

    const data: Prisma.UserUpdateInput = {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
      ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
      ...(dto.telephone !== undefined
        ? { telephone: normalizePhoneForCountry(dto.telephone, phoneCountry) ?? null }
        : {}),
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

  private phoneLoginVariants(login: string): string[] {
    return buildPhoneLoginVariants(login);
  }

  private async resolveTenantPhoneCountry(tenantId: string): Promise<string> {
    const config = await this.prisma.ecoleConfig.findUnique({
      where: { tenantId },
      select: { pays: true },
    });
    return config?.pays ?? 'SN';
  }

  // ==================== UPLOAD PHOTO ====================

  async uploadProfilePhoto(userId: string, buffer: Buffer, contentType: string, originalName: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, tenantId: true } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    const key = this.storage.buildPhotoKey(user.tenantId, userId);
    await this.storage.upload(key, buffer, contentType);

    const resolvedUrl = this.storage.resolveUrl(key)!;
    await this.prisma.user.update({ where: { id: userId }, data: { photoUrl: key } });
    this.logger.log(`[Auth] Photo updated userId=${userId} key=${key}`);
    return resolvedUrl;
  }
}
