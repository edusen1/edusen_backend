import { BadRequestException, Body, Controller, Delete, Get, Logger, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { MultipartFastifyRequest } from '@/common/types/multipart-request.types';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PrismaService } from '@/config/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { PlatformService } from '@/modules/platform/platform.service';
import { FeatureService } from '@/modules/feature/feature.service';
import { CreateTenantDto } from '@/modules/platform/dto/create-tenant.dto';
import { CreateUserDto } from '@/modules/platform/dto/create-user.dto';
import * as os from 'os';

@Roles('SUPER_ADMIN', 'GESTIONNAIRE')
@Controller('platform')
export class PlatformController {
  private readonly logger = new Logger(PlatformController.name);

  constructor(
    private readonly platformService: PlatformService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly featureService: FeatureService,
  ) {}

  @Get('tenants')
  findTenants() { return this.platformService.findTenants(); }

  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) { return this.platformService.createTenant(dto); }

  @Post('tenants/auto-register')
  autoRegisterTenant(@Body() dto: CreateTenantDto) { return this.platformService.createTenant(dto); }

  @Get('tenants/:id')
  findTenantById(@Param('id') id: string) { return this.platformService.findTenantById(id); }

  @Put('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() dto: Partial<CreateTenantDto>) { return this.platformService.updateTenant(id, dto); }

  @Roles('SUPER_ADMIN')
  @Post('tenants/:id/suspend')
  suspendTenant(@Param('id') id: string) { return this.platformService.suspendTenant(id); }

  @Roles('SUPER_ADMIN')
  @Post('tenants/:id/reactivate')
  reactivateTenant(@Param('id') id: string) { return this.platformService.reactivateTenant(id); }

  @Post('tenants/:id/logo')
  async uploadLogo(@Param('id') id: string, @Req() req: MultipartFastifyRequest, @Body() body?: { logoUrl?: string }) {
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw new BadRequestException('Aucun logo fourni');

      const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
      if (!allowed.includes(file.mimetype)) {
        throw new BadRequestException('Format invalide. PNG, JPEG, WebP ou SVG uniquement.');
      }

      const buffer = await file.toBuffer();
      if (buffer.byteLength > 2 * 1024 * 1024) {
        throw new BadRequestException('Logo trop lourd. Maximum 2 Mo.');
      }

      return this.platformService.uploadTenantLogo(id, buffer, file.mimetype, file.filename);
    }

    if (body?.logoUrl !== undefined) {
      const tenant = await this.platformService.updateTenant(id, { logoUrl: body.logoUrl });
      return { logoUrl: tenant.logoUrl };
    }

    throw new BadRequestException('Aucun logo fourni');
  }

  @Roles('SUPER_ADMIN')
  @Delete('tenants/:id')
  deleteTenant(@Param('id') id: string) { return this.platformService.deleteTenant(id); }

  @Get('utilisateurs')
  listUsers() { return this.platformService.listUsers(); }

  @Post('utilisateurs')
  createUser(@Body() dto: CreateUserDto) { return this.platformService.createUser(dto); }

  @Get('utilisateurs/:id')
  getUser(@Param('id') id: string) { return this.platformService.getUser(id); }

  @Delete('utilisateurs/:id')
  deleteUser(@Param('id') id: string) { return this.platformService.deleteUser(id); }

  @Patch('utilisateurs/:id/actif')
  setUserActive(@Param('id') id: string, @Query('actif') actif?: string) {
    return this.platformService.setUserActive(id, actif !== 'false');
  }

  @Get('stats')
  stats() { return this.platformService.stats(); }

  @Get('audit-logs')
  auditLogs(
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Query('action') action?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.platformService.auditLogs(Number(page ?? 0), Number(size ?? 20), { action, tenantId });
  }

  // ── Platform Configuration ─────────────────────────────────────────

  @Get('configuration')
  async getConfiguration() {
    const limits = await this.prisma.planLimit.findMany({ orderBy: [{ plan: 'asc' }, { limitKey: 'asc' }] });

    const limitsMap: Record<string, Record<string, number>> = {};
    for (const l of limits) {
      if (!limitsMap[l.plan]) limitsMap[l.plan] = {};
      limitsMap[l.plan][l.limitKey] = l.limitValue;
    }

    return {
      plans: ['TRIAL', 'STARTER', 'STANDARD', 'PREMIUM'],
      limits: limitsMap,
      environment: {
        nodeEnv: process.env.NODE_ENV ?? 'development',
        redisConfigured: Boolean(process.env.REDIS_URL),
        s3Configured: this.storage.isConfigured(),
        s3Bucket: process.env.S3_BUCKET ?? 'noura-school-files',
        s3Endpoint: process.env.S3_ENDPOINT ? process.env.S3_ENDPOINT.replace(/\/\/.*:.*@/, '//***@') : null,
        whatsappProvider: process.env.RELAYIO_BASE_URL ? 'relayio' : null,
        corsOrigins: process.env.ALLOWED_ORIGINS ?? '',
        jwtIssuer: process.env.JWT_ISSUER ?? 'nouraschool',
        jwtAccessTokenLifespan: process.env.JWT_ACCESS_TOKEN_LIFESPAN ?? '15m',
      },
    };
  }

  @Roles('SUPER_ADMIN')
  @Put('configuration/limits/:plan/:key')
  async setConfigLimit(
    @Param('plan') plan: string,
    @Param('key') key: string,
    @Body() body: { value: number },
  ) {
    return this.prisma.planLimit.upsert({
      where: { plan_limitKey: { plan, limitKey: key } },
      create: { plan, limitKey: key, limitValue: body.value },
      update: { limitValue: body.value },
    });
  }

  // ── Feature Flags ──────────────────────────────────────────────────

  @Get('features')
  async getFeatures() {
    const [planFeatures, limits] = await Promise.all([
      this.prisma.planFeature.findMany({ orderBy: [{ plan: 'asc' }, { featureKey: 'asc' }] }),
      this.prisma.planLimit.findMany({ orderBy: [{ plan: 'asc' }, { limitKey: 'asc' }] }),
    ]);
    return { planFeatures, limits };
  }

  @Roles('SUPER_ADMIN')
  @Put('features/:plan/:key')
  async togglePlanFeature(
    @Param('plan') plan: string,
    @Param('key') key: string,
    @Body() body: { actif: boolean },
  ) {
    const result = await this.prisma.planFeature.upsert({
      where: { plan_featureKey: { plan, featureKey: key } },
      create: { plan, featureKey: key, actif: body.actif },
      update: { actif: body.actif },
    });
    await this.featureService.invalidatePlanCache(plan);
    return result;
  }

  @Roles('SUPER_ADMIN')
  @Put('limits/:plan/:key')
  async setPlanLimit(
    @Param('plan') plan: string,
    @Param('key') key: string,
    @Body() body: { value: number },
  ) {
    return this.prisma.planLimit.upsert({
      where: { plan_limitKey: { plan, limitKey: key } },
      create: { plan, limitKey: key, limitValue: body.value },
      update: { limitValue: body.value },
    });
  }

  @Get('tenants/:id/features')
  async getTenantFeatures(@Param('id') id: string) {
    const [tenant, overrides, planFeatures] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id }, select: { plan: true } }),
      this.prisma.tenantFeatureOverride.findMany({ where: { tenantId: id } }),
      this.prisma.planFeature.findMany(),
    ]);
    if (!tenant) throw new BadRequestException('Tenant introuvable');

    const planMap = new Map(planFeatures.filter((f) => f.plan === tenant.plan).map((f) => [f.featureKey, f.actif]));
    const overrideMap = new Map(overrides.map((o) => [o.featureKey, o.actif]));

    // Resolve: override > plan > false
    const allKeys = new Set([...planMap.keys(), ...overrideMap.keys()]);
    const resolved: { featureKey: string; actif: boolean; source: 'override' | 'plan' | 'default' }[] = [];
    for (const key of allKeys) {
      if (overrideMap.has(key)) {
        resolved.push({ featureKey: key, actif: overrideMap.get(key)!, source: 'override' });
      } else if (planMap.has(key)) {
        resolved.push({ featureKey: key, actif: planMap.get(key)!, source: 'plan' });
      } else {
        resolved.push({ featureKey: key, actif: false, source: 'default' });
      }
    }
    return { plan: tenant.plan, overrides, resolved };
  }

  @Roles('SUPER_ADMIN')
  @Put('tenants/:id/features/:key')
  async setTenantFeatureOverride(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() body: { actif: boolean },
  ) {
    const result = await this.prisma.tenantFeatureOverride.upsert({
      where: { tenantId_featureKey: { tenantId: id, featureKey: key } },
      create: { tenantId: id, featureKey: key, actif: body.actif },
      update: { actif: body.actif },
    });
    await this.featureService.invalidateCache(id);
    return result;
  }

  @Roles('SUPER_ADMIN')
  @Delete('tenants/:id/features/:key')
  async deleteTenantFeatureOverride(
    @Param('id') id: string,
    @Param('key') key: string,
  ) {
    try {
      await this.prisma.tenantFeatureOverride.delete({
        where: { tenantId_featureKey: { tenantId: id, featureKey: key } },
      });
    } catch { /* already deleted */ }
    await this.featureService.invalidateCache(id);
    return { ok: true };
  }

  // ── Document Templates ─────────────────────────────────────────────

  @Get('templates')
  async getTemplates(@Query('typeDocument') typeDocument?: string) {
    const where: Record<string, unknown> = {};
    if (typeDocument) where.typeDocument = typeDocument;
    return this.prisma.documentTemplate.findMany({
      where,
      orderBy: [{ typeDocument: 'asc' }, { tenantId: 'asc' }, { nom: 'asc' }],
      select: {
        id: true, tenantId: true, typeDocument: true, nom: true, description: true,
        isDefault: true, styles: true, thumbnailUrl: true, createdAt: true, updatedAt: true,
        tenant: { select: { id: true, nom: true } },
      },
    });
  }

  @Get('templates/:id')
  async getTemplate(@Param('id') id: string) {
    const t = await this.prisma.documentTemplate.findUnique({ where: { id } });
    if (!t) throw new BadRequestException('Template introuvable');
    return t;
  }

  @Roles('SUPER_ADMIN')
  @Post('templates')
  async createTemplate(@Body() body: {
    typeDocument: string; nom: string; description?: string;
    templateHtml: string; styles?: Record<string, unknown>;
    isDefault?: boolean; tenantId?: string;
  }) {
    return this.prisma.documentTemplate.create({ data: body });
  }

  @Roles('SUPER_ADMIN')
  @Put('templates/:id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() body: {
      nom?: string; description?: string; templateHtml?: string;
      styles?: Record<string, unknown>; isDefault?: boolean;
    },
  ) {
    return this.prisma.documentTemplate.update({ where: { id }, data: body });
  }

  @Roles('SUPER_ADMIN')
  @Delete('templates/:id')
  async deleteTemplate(@Param('id') id: string) {
    await this.prisma.documentTemplate.delete({ where: { id } });
    return { ok: true };
  }

  // ── Demandes d'audit (superadmin gère) ──────────────────────────────

  @Get('demandes-audit')
  async getDemandesAudit(
    @Query('statut') statut?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (statut) where['statut'] = statut;
    if (tenantId) where['tenantId'] = tenantId;
    return this.prisma.demandeAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        tenant: { select: { id: true, nom: true } },
        demandeur: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });
  }

  @Roles('SUPER_ADMIN')
  @Patch('demandes-audit/:id/approuver')
  async approuverDemandeAudit(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
    @Body() body: { commentaire?: string; dureeAccesJours?: number },
  ) {
    const duree = body.dureeAccesJours ?? 7;
    const expiration = new Date();
    expiration.setDate(expiration.getDate() + duree);
    return this.prisma.demandeAudit.update({
      where: { id },
      data: {
        statut: 'APPROUVEE',
        traitePar: user.sub,
        commentaire: body.commentaire?.trim() || null,
        dateTraitement: new Date(),
        expirationAcces: expiration,
      },
    });
  }

  // ── Monitoring ──────────────────────────────────────────────────────

  @Get('monitoring/system')
  async monitoringSystem() {
    const mem = process.memoryUsage();
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    // Redis ping
    let redisOk = false;
    let redisLatency = 0;
    try {
      const start = Date.now();
      await this.redis.ping();
      redisLatency = Date.now() - start;
      redisOk = true;
    } catch { /* redis down */ }

    // DB ping
    let dbOk = false;
    let dbLatency = 0;
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - start;
      dbOk = true;
    } catch { /* db down */ }

    // Minio/S3 ping
    let minioResult = { ok: false, latencyMs: 0, bucket: '' };
    try {
      minioResult = await this.storage.healthCheck();
    } catch { /* storage down */ }

    // WhatsApp Relayio ping
    let whatsappOk = false;
    let whatsappLatency = 0;
    const relayioUrl = process.env.RELAYIO_BASE_URL ?? process.env.WHATSAPP_RELAYIO_BASE_URL ?? 'https://relayio-backend.medaaris.com';
    try {
      const start = Date.now();
      const resp = await fetch(`${relayioUrl}/health`, { signal: AbortSignal.timeout(5000) });
      whatsappLatency = Date.now() - start;
      whatsappOk = resp.ok;
    } catch {
      whatsappOk = false;
    }

    return {
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model ?? '—',
        loadAvg: loadAvg.map((l: number) => Math.round(l * 100) / 100),
      },
      os: {
        platform: os.platform(),
        totalMemory: Math.round(os.totalmem() / 1024 / 1024),
        freeMemory: Math.round(os.freemem() / 1024 / 1024),
        uptime: Math.floor(os.uptime()),
      },
      redis: { ok: redisOk, latencyMs: redisLatency },
      database: { ok: dbOk, latencyMs: dbLatency },
      minio: { ok: minioResult.ok, latencyMs: minioResult.latencyMs, bucket: minioResult.bucket, configured: this.storage.isConfigured() },
      whatsapp: { ok: whatsappOk, latencyMs: whatsappLatency, provider: 'relayio', url: relayioUrl },
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('monitoring/tenants-usage')
  async monitoringTenantsUsage() {
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, nom: true, actif: true, plan: true, createdAt: true },
    });

    const usage = await Promise.all(
      tenants.map(async (t) => {
        const [eleves, users, inscriptions, paiements, bulletins, notes] = await Promise.all([
          this.prisma.user.count({ where: { tenantId: t.id, role: 'ELEVE' } }),
          this.prisma.user.count({ where: { tenantId: t.id } }),
          this.prisma.inscription.count({ where: { tenantId: t.id } }),
          this.prisma.paiement.count({ where: { tenantId: t.id } }),
          this.prisma.bulletin.count({ where: { tenantId: t.id } }),
          this.prisma.note.count({ where: { tenantId: t.id } }),
        ]);
        return {
          tenantId: t.id,
          nom: t.nom,
          actif: t.actif,
          plan: t.plan,
          eleves,
          users,
          inscriptions,
          paiements,
          bulletins,
          notes,
        };
      }),
    );

    return usage.sort((a, b) => b.users - a.users);
  }

  @Get('monitoring/security')
  async monitoringSecurity() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    const [connexions24h, connexions7d, echouees24h, echouees1h, totalAudit24h] = await Promise.all([
      this.prisma.auditLog.count({
        where: { action: 'CONNEXION', createdAt: { gte: last24h } },
      }),
      this.prisma.auditLog.count({
        where: { action: 'CONNEXION', createdAt: { gte: last7d } },
      }),
      this.prisma.auditLog.count({
        where: { action: 'CONNEXION_ECHOUEE', createdAt: { gte: last24h } },
      }),
      this.prisma.auditLog.count({
        where: { action: 'CONNEXION_ECHOUEE', createdAt: { gte: lastHour } },
      }),
      this.prisma.auditLog.count({
        where: { createdAt: { gte: last24h } },
      }),
    ]);

    // Top IPs des 24h
    const recentLogs = await this.prisma.auditLog.findMany({
      where: { createdAt: { gte: last24h }, ipAddress: { not: null } },
      select: { ipAddress: true, action: true },
    });

    const ipMap = new Map<string, { count: number; actions: Set<string>; failures: number }>();
    for (const log of recentLogs) {
      const ip = log.ipAddress!;
      const entry = ipMap.get(ip);
      if (entry) {
        entry.count++;
        entry.actions.add(log.action);
        if (log.action === 'CONNEXION_ECHOUEE') entry.failures++;
      } else {
        ipMap.set(ip, { count: 1, actions: new Set([log.action]), failures: log.action === 'CONNEXION_ECHOUEE' ? 1 : 0 });
      }
    }
    const topIps = Array.from(ipMap.entries())
      .map(([ip, v]) => ({ ip, count: v.count, actions: v.actions.size, failures: v.failures }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // IPs suspectes : > 5 échecs en 24h
    const suspiciousIps = Array.from(ipMap.entries())
      .filter(([, v]) => v.failures >= 5)
      .map(([ip, v]) => ({ ip, failures: v.failures, totalActions: v.count }))
      .sort((a, b) => b.failures - a.failures);

    // Actions sensibles des 24h
    const sensitiveActions = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: {
        createdAt: { gte: last24h },
        action: { in: ['SUPPRESSION', 'CONNEXION', 'CONNEXION_ECHOUEE', 'DECONNEXION', 'APPROBATION', 'REJET', 'ACTIVATION'] },
      },
      _count: true,
    });

    return {
      connexions24h,
      connexions7d,
      echouees24h,
      echouees1h,
      totalAudit24h,
      uniqueIps24h: ipMap.size,
      topIps,
      suspiciousIps,
      sensitiveActions: sensitiveActions.map((a) => ({
        action: a.action,
        count: a._count,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('monitoring/storage')
  async monitoringStorage() {
    return this.storage.getStorageStats();
  }

  @Get('monitoring/alerts')
  async monitoringAlerts() {
    const alerts: { level: 'critical' | 'warning' | 'info'; category: string; message: string; recommendation: string }[] = [];

    // 1. Memory check
    const mem = process.memoryUsage();
    const rssMb = Math.round(mem.rss / 1024 / 1024);
    const totalMem = Math.round(os.totalmem() / 1024 / 1024);
    const freeMem = Math.round(os.freemem() / 1024 / 1024);
    const memUsagePct = Math.round(((totalMem - freeMem) / totalMem) * 100);

    if (memUsagePct > 90) {
      alerts.push({ level: 'critical', category: 'MEMOIRE', message: `Memoire systeme a ${memUsagePct}% (${freeMem} Mo libres sur ${totalMem} Mo)`, recommendation: 'Augmentez la RAM du serveur (minimum recommande : 2 Go). Verifiez les fuites memoire avec --inspect.' });
    } else if (memUsagePct > 80) {
      alerts.push({ level: 'warning', category: 'MEMOIRE', message: `Memoire systeme a ${memUsagePct}%`, recommendation: 'Surveillez la tendance. Si ca monte, envisagez de passer de 1 Go a 2 Go de RAM.' });
    }

    if (rssMb > 512) {
      alerts.push({ level: 'warning', category: 'MEMOIRE', message: `RSS du processus Node a ${rssMb} Mo`, recommendation: 'Le processus consomme beaucoup. Verifiez les requetes lourdes, les caches en memoire, et les connexions Prisma.' });
    }

    // 2. Redis check
    let redisOk = false;
    try { await this.redis.ping(); redisOk = true; } catch { /* */ }
    if (!redisOk) {
      alerts.push({ level: 'critical', category: 'REDIS', message: 'Redis est injoignable', recommendation: 'Verifiez que Redis est demarre (docker ps). Sans Redis : pas de rate limiting, pas de sessions, pas de cache OTP. Le limiteur est desactive silencieusement (skipOnError: true).' });
    }

    // 3. DB check
    let dbOk = false;
    let dbLatency = 0;
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - start;
      dbOk = true;
    } catch { /* */ }
    if (!dbOk) {
      alerts.push({ level: 'critical', category: 'BASE_DE_DONNEES', message: 'La base de donnees ne repond pas', recommendation: 'Verifiez PostgreSQL (docker ps, pg_isready). Verifiez DATABASE_CONNECTION_LIMIT (actuellement 8 — augmentez a 20 si le serveur le permet).' });
    } else if (dbLatency > 500) {
      alerts.push({ level: 'warning', category: 'BASE_DE_DONNEES', message: `Latence DB elevee : ${dbLatency} ms`, recommendation: 'Verifiez la charge de la base. Ajoutez des index si certaines requetes sont lentes. Verifiez que le serveur DB est sur le meme reseau.' });
    }

    // 4. Failed logins check
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [echouees1h, echouees24h] = await Promise.all([
      this.prisma.auditLog.count({ where: { action: 'CONNEXION_ECHOUEE', createdAt: { gte: lastHour } } }),
      this.prisma.auditLog.count({ where: { action: 'CONNEXION_ECHOUEE', createdAt: { gte: last24h } } }),
    ]);

    if (echouees1h > 20) {
      alerts.push({ level: 'critical', category: 'SECURITE', message: `${echouees1h} echecs de connexion dans la derniere heure`, recommendation: 'Possible tentative de force brute. Verifiez les IPs suspectes dans l\'onglet Securite. Envisagez de bloquer les IPs via un pare-feu (ufw deny from IP).' });
    } else if (echouees24h > 50) {
      alerts.push({ level: 'warning', category: 'SECURITE', message: `${echouees24h} echecs de connexion en 24h`, recommendation: 'Volume inhabituel. Verifiez si des utilisateurs ont oublie leurs identifiants ou si c\'est une attaque distribuee.' });
    }

    // 5. Suspicious IPs (> 10 failures from same IP)
    const failedLogs = await this.prisma.auditLog.findMany({
      where: { action: 'CONNEXION_ECHOUEE', createdAt: { gte: last24h }, ipAddress: { not: null } },
      select: { ipAddress: true },
    });
    const ipFailMap = new Map<string, number>();
    for (const log of failedLogs) {
      ipFailMap.set(log.ipAddress!, (ipFailMap.get(log.ipAddress!) ?? 0) + 1);
    }
    const bruteForceIps = Array.from(ipFailMap.entries()).filter(([, c]) => c >= 10);
    if (bruteForceIps.length > 0) {
      alerts.push({
        level: 'critical',
        category: 'SECURITE',
        message: `${bruteForceIps.length} IP(s) avec 10+ echecs de connexion : ${bruteForceIps.map(([ip, c]) => `${ip} (${c}x)`).join(', ')}`,
        recommendation: 'Bloquez ces IPs : sudo ufw deny from <IP>. Envisagez un fail2ban ou Cloudflare pour automatiser.',
      });
    }

    // 6. Minio/S3 check
    try {
      const minioCheck = await this.storage.healthCheck();
      if (!minioCheck.ok) {
        alerts.push({ level: 'warning', category: 'STOCKAGE', message: 'Minio/S3 ne repond pas', recommendation: 'Verifiez le service Minio (docker ps). Les uploads de logos, cartes scolaires et fichiers ne fonctionneront pas.' });
      }
    } catch { /* */ }
    if (!this.storage.isConfigured()) {
      alerts.push({ level: 'warning', category: 'STOCKAGE', message: 'Stockage objet (Minio/S3) non configure', recommendation: 'Configurez S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY et S3_BUCKET pour activer le stockage de fichiers.' });
    }

    // 7. WhatsApp Relayio check
    const relayUrl = process.env.RELAYIO_BASE_URL ?? process.env.WHATSAPP_RELAYIO_BASE_URL ?? 'https://relayio-backend.medaaris.com';
    try {
      const resp = await fetch(`${relayUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        alerts.push({ level: 'warning', category: 'WHATSAPP', message: 'Le service WhatsApp Relayio repond mais avec une erreur', recommendation: 'Verifiez les logs Relayio et la validite de la cle API.' });
      }
    } catch {
      alerts.push({ level: 'warning', category: 'WHATSAPP', message: 'WhatsApp Relayio est injoignable', recommendation: `Verifiez que le service est accessible a ${relayUrl}. Sans WhatsApp : pas d'OTP, pas de notifications.` });
    }

    // 8. CPU load
    const load = os.loadavg();
    const cores = os.cpus().length;
    if (load[0] > cores * 2) {
      alerts.push({ level: 'critical', category: 'CPU', message: `Load average tres eleve : ${load[0].toFixed(1)} (${cores} cores)`, recommendation: 'Le serveur est surcharge. Augmentez les vCPU ou optimisez les requetes lourdes. Verifiez les taches cron et les generations de PDF.' });
    } else if (load[0] > cores) {
      alerts.push({ level: 'warning', category: 'CPU', message: `Load average eleve : ${load[0].toFixed(1)} (${cores} cores)`, recommendation: 'Le serveur approche de sa capacite. Surveillez la tendance.' });
    }

    // 7. Disk space (via os)
    const uptimeOs = os.uptime();
    if (uptimeOs < 300) {
      alerts.push({ level: 'info', category: 'SYSTEME', message: `Le serveur a redemarre il y a ${Math.floor(uptimeOs / 60)} minutes`, recommendation: 'Verifiez les logs de demarrage pour identifier la cause du redemarrage (crash, OOM killer, mise a jour).' });
    }

    // 8. No alerts = healthy
    if (alerts.length === 0) {
      alerts.push({ level: 'info', category: 'SYSTEME', message: 'Tous les systemes sont operationnels', recommendation: 'Aucune action requise.' });
    }

    return { alerts, checkedAt: new Date().toISOString() };
  }

  @Roles('SUPER_ADMIN')
  @Patch('demandes-audit/:id/rejeter')
  async rejeterDemandeAudit(
    @Param('id') id: string,
    @CurrentUser() user: { sub: string },
    @Body() body: { commentaire?: string },
  ) {
    return this.prisma.demandeAudit.update({
      where: { id },
      data: {
        statut: 'REJETEE',
        traitePar: user.sub,
        commentaire: body.commentaire?.trim() || null,
        dateTraitement: new Date(),
      },
    });
  }
}
