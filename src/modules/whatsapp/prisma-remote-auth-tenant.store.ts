import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';

/**
 * Store RemoteAuth pour whatsapp-web.js — version multi-tenant.
 * Chaque instance est liée à un tenantId unique.
 * La session est sauvegardée sous forme de zip binaire dans WhatsappSession.sessionData.
 */
export class PrismaRemoteAuthTenantStore {
  private readonly logger = new Logger(PrismaRemoteAuthTenantStore.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantId: string,
    private readonly dataPath: string,
  ) {}

  async sessionExists(_: { session: string }): Promise<boolean> {
    const record = await this.prisma.whatsappSession.findUnique({
      where: { tenantId: this.tenantId },
      select: { sessionData: true },
    });
    const exists = !!(record?.sessionData);
    this.logger.log(`sessionExists(tenant=${this.tenantId}) → ${exists}`);
    return exists;
  }

  async save({ session }: { session: string }): Promise<void> {
    const zipPath = join(this.dataPath, `${session}.zip`);
    if (!existsSync(zipPath)) {
      this.logger.error(`save — zip introuvable : ${zipPath}`);
      return;
    }
    try {
      const data = readFileSync(zipPath);
      await this.prisma.whatsappSession.upsert({
        where: { tenantId: this.tenantId },
        create: { tenantId: this.tenantId, sessionData: data },
        update: { sessionData: data },
      });
      this.logger.log(`save(tenant=${this.tenantId}) — ${data.length} octets sauvegardés`);
    } catch (err) {
      this.logger.error(`save — échec : ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async extract({ session }: { session: string }): Promise<void> {
    try {
      const record = await this.prisma.whatsappSession.findUnique({
        where: { tenantId: this.tenantId },
        select: { sessionData: true },
      });
      if (record?.sessionData) {
        mkdirSync(this.dataPath, { recursive: true });
        writeFileSync(join(this.dataPath, `${session}.zip`), record.sessionData);
        this.logger.log(`extract(tenant=${this.tenantId}) — session restaurée (${record.sessionData.length} octets)`);
      } else {
        this.logger.warn(`extract(tenant=${this.tenantId}) — aucune session en base, nouveau QR requis`);
      }
    } catch (err) {
      this.logger.error(`extract — échec : ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async delete(_: { session: string }): Promise<void> {
    await this.prisma.whatsappSession.updateMany({
      where: { tenantId: this.tenantId },
      data: { sessionData: null, connected: false, phoneNumber: null, displayName: null, connectedAt: null },
    });
    this.logger.log(`delete(tenant=${this.tenantId}) — session effacée`);
  }
}
