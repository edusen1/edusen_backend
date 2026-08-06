import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { MultipartFastifyRequest } from '@/common/types/multipart-request.types';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PrismaService } from '@/config/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { PlatformService } from '@/modules/platform/platform.service';
import { CreateTenantDto } from '@/modules/platform/dto/create-tenant.dto';
import { CreateUserDto } from '@/modules/platform/dto/create-user.dto';
import * as os from 'os';

@Roles('SUPER_ADMIN', 'GESTIONNAIRE')
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platformService: PlatformService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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
    const loadAvg = os.loadaverage();

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
        loadAvg: loadAvg.map((l) => Math.round(l * 100) / 100),
      },
      os: {
        platform: os.platform(),
        totalMemory: Math.round(os.totalmem() / 1024 / 1024),
        freeMemory: Math.round(os.freemem() / 1024 / 1024),
        uptime: Math.floor(os.uptime()),
      },
      redis: { ok: redisOk, latencyMs: redisLatency },
      database: { ok: dbOk, latencyMs: dbLatency },
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

    const [connexions24h, connexions7d, totalAudit24h] = await Promise.all([
      this.prisma.auditLog.count({
        where: { action: { contains: 'CONNEXION' }, createdAt: { gte: last24h } },
      }),
      this.prisma.auditLog.count({
        where: { action: { contains: 'CONNEXION' }, createdAt: { gte: last7d } },
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

    const ipMap = new Map<string, { count: number; actions: Set<string> }>();
    for (const log of recentLogs) {
      const ip = log.ipAddress!;
      const entry = ipMap.get(ip);
      if (entry) {
        entry.count++;
        entry.actions.add(log.action);
      } else {
        ipMap.set(ip, { count: 1, actions: new Set([log.action]) });
      }
    }
    const topIps = Array.from(ipMap.entries())
      .map(([ip, v]) => ({ ip, count: v.count, actions: v.actions.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Actions sensibles des 24h
    const sensitiveActions = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: {
        createdAt: { gte: last24h },
        action: { in: ['SUPPRESSION', 'CONNEXION', 'DECONNEXION', 'APPROBATION', 'REJET', 'ACTIVATION'] },
      },
      _count: true,
    });

    return {
      connexions24h,
      connexions7d,
      totalAudit24h,
      uniqueIps24h: ipMap.size,
      topIps,
      sensitiveActions: sensitiveActions.map((a) => ({
        action: a.action,
        count: a._count,
      })),
      timestamp: new Date().toISOString(),
    };
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
