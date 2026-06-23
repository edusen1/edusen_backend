import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'node:crypto';
import { PrismaService } from '@/config/prisma.service';

type PushPayload = {
  title: string;
  body?: string | null;
  data?: Record<string, string>;
};

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async registerToken(tenantId: string | undefined, userId: string | undefined, payload: { token?: string; platform?: string; userAgent?: string }) {
    const token = String(payload.token ?? '').trim();
    if (!tenantId || !userId || !token) return { success: false };

    await this.prisma.pushToken.upsert({
      where: { token },
      create: {
        tenantId,
        userId,
        token,
        platform: String(payload.platform ?? 'web').slice(0, 40),
        userAgent: payload.userAgent ? String(payload.userAgent).slice(0, 500) : null,
      },
      update: {
        tenantId,
        userId,
        platform: String(payload.platform ?? 'web').slice(0, 40),
        userAgent: payload.userAgent ? String(payload.userAgent).slice(0, 500) : null,
        actif: true,
      },
    });

    return { success: true };
  }

  async unregisterToken(token: unknown, userId?: string) {
    const cleanToken = String(token ?? '').trim();
    if (!cleanToken) return { success: false };
    await this.prisma.pushToken.updateMany({
      where: { token: cleanToken, ...(userId ? { userId } : {}) },
      data: { actif: false },
    });
    return { success: true };
  }

  async sendToUser(tenantId: string, userId: string, payload: PushPayload): Promise<void> {
    const tokens = await this.prisma.pushToken.findMany({
      where: { tenantId, userId, actif: true },
      select: { token: true },
    });
    await this.sendToTokens(tokens.map((row) => row.token), payload);
  }

  async sendToUsers(tenantId: string, userIds: string[], payload: PushPayload): Promise<void> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return;
    const tokens = await this.prisma.pushToken.findMany({
      where: { tenantId, userId: { in: ids }, actif: true },
      select: { token: true },
    });
    await this.sendToTokens(tokens.map((row) => row.token), payload);
  }

  private async sendToTokens(tokens: string[], payload: PushPayload): Promise<void> {
    const projectId = this.config.get<string>('FCM_PROJECT_ID');
    if (!projectId || !tokens.length) return;

    const accessToken = await this.getAccessToken();
    if (!accessToken) return;

    await Promise.all(tokens.map(async (token) => {
      try {
        const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: {
                title: payload.title,
                body: payload.body ?? '',
              },
              data: payload.data ?? {},
              webpush: {
                fcmOptions: { link: '/' },
              },
            },
          }),
        });
        if (response.status === 404 || response.status === 410) {
          await this.prisma.pushToken.updateMany({ where: { token }, data: { actif: false } });
        }
        if (!response.ok) {
          this.logger.warn(`FCM send failed (${response.status})`);
        }
      } catch (error) {
        this.logger.warn(`FCM send error: ${(error as Error).message}`);
      }
    }));
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60000) {
      return this.accessToken.value;
    }

    const clientEmail = this.config.get<string>('FCM_CLIENT_EMAIL');
    const privateKey = this.config.get<string>('FCM_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    if (!clientEmail || !privateKey) return null;

    const now = Math.floor(Date.now() / 1000);
    const assertion = [
      this.base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
      this.base64Url(JSON.stringify({
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })),
    ].join('.');
    const signature = createSign('RSA-SHA256').update(assertion).sign(privateKey, 'base64url');
    const jwt = `${assertion}.${signature}`;

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json() as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;
      this.accessToken = {
        value: data.access_token,
        expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
      };
      return this.accessToken.value;
    } catch (error) {
      this.logger.warn(`FCM auth error: ${(error as Error).message}`);
      return null;
    }
  }

  private base64Url(value: string): string {
    return Buffer.from(value).toString('base64url');
  }
}
