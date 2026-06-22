import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const READ_RETRY_ATTEMPTS = Math.max(0, Number(process.env.PRISMA_READ_RETRY_ATTEMPTS ?? 2));
const READ_RETRY_DELAY_MS = Math.max(25, Number(process.env.PRISMA_READ_RETRY_DELAY_MS ?? 150));

function databaseUrlWithPoolLimits(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;

  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(Math.max(1, Number(process.env.DATABASE_CONNECTION_LIMIT ?? 8))));
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', String(Math.max(1, Number(process.env.DATABASE_POOL_TIMEOUT_SECONDS ?? 10))));
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: { url: databaseUrlWithPoolLimits(process.env.DATABASE_URL) },
      },
    });
  }

  async withReadRetry<T>(operation: string, execute: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= READ_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await execute();
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'P1001' || attempt === READ_RETRY_ATTEMPTS) throw error;

        const delayMs = READ_RETRY_DELAY_MS * (attempt + 1);
        this.logger.warn(`[${operation}] Database read P1001; retry ${attempt + 1}/${READ_RETRY_ATTEMPTS} in ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error('Unreachable Prisma retry state');
  }

  async onModuleInit(): Promise<void> {
    const maxAttempts = 10;
    const retryDelayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) {
          this.logger.log(`Database connected after ${attempt} attempts`);
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        this.logger.warn(`Database connection attempt ${attempt}/${maxAttempts} failed: ${message}`);
        if (attempt === maxAttempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
