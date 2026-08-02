// Force UTC timezone for consistent timestamps across all environments
process.env.TZ = 'UTC';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import { AppModule } from '@/app.module';
import { AppLoggerService } from '@/common/logger/app-logger.service';

const color = {
  cyan: '\u001b[1;36m',
  green: '\u001b[1;32m',
  blue: '\u001b[1;34m',
  dim: '\u001b[2m',
  reset: '\u001b[0m',
};

function registerProcessErrorHandlers(logger: AppLoggerService): void {
  process.on('unhandledRejection', (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const trace = reason instanceof Error ? reason.stack : undefined;
    logger.error(`[UnhandledRejection] ${msg}`, trace, 'Process');
    // On logge mais on NE crash PAS le process.
  });

  process.on('uncaughtException', (error: Error) => {
    const isWwebError =
      error.stack?.includes('whatsapp-web.js') ||
      error.stack?.includes('puppeteer') ||
      error.message.includes('Execution context');

    if (isWwebError) {
      logger.error(`[UncaughtException/WhatsApp] ${error.message} — process maintenu`, error.stack, 'Process');
      return;
    }

    logger.fatal(`[UncaughtException] ${error.message}`, error.stack, 'Process');
    process.exit(1); // Crash uniquement sur des erreurs non-WhatsApp.
  });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      bodyLimit: Number(process.env.HTTP_BODY_LIMIT_BYTES ?? 5 * 1024 * 1024),
      requestTimeout: Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 60_000),
      keepAliveTimeout: Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS ?? 72_000),
    }),
    { bufferLogs: true },
  );
  const logger = app.get(AppLoggerService);
  app.useLogger(logger);
  app.flushLogs();
  registerProcessErrorHandlers(logger);

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(compress, {
    global: true,
    threshold: Number(process.env.HTTP_COMPRESSION_THRESHOLD_BYTES ?? 1024),
  });

  const defaultAllowedOrigins = [
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:4300',
    'http://127.0.0.1:4300',
    'https://medaaris.com',
    'https://sablettes.medaaris.com',
    'https://noukhbetelasr.medaaris.com',
    'https://noura.medaaris.com',
    'https://zeinelabidine.medaaris.com',
  ];
  const normalizeOrigin = (origin: string) => origin.trim().replace(/\/$/, '').toLowerCase();
  const allowedOrigins = new Set(
    [
      ...defaultAllowedOrigins,
      ...(process.env.ALLOWED_ORIGINS ?? '').split(','),
      ...(process.env.CORS_ORIGINS ?? '').split(','),
    ]
      .map(normalizeOrigin)
      .filter(Boolean),
  );
  const allowedDomainSuffixes = (process.env.CORS_ALLOWED_DOMAIN_SUFFIXES ?? '.medaaris.com')
    .split(',')
    .map((suffix) => suffix.trim().toLowerCase())
    .filter(Boolean);
  const isAllowedOrigin = (origin: string) => {
    if (allowedOrigins.has(origin) || allowedOrigins.has('*')) return true;
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' && !url.hostname.startsWith('localhost') && url.hostname !== '127.0.0.1') {
        return false;
      }
      return allowedDomainSuffixes.some((suffix) => url.hostname === suffix.replace(/^\./, '') || url.hostname.endsWith(suffix));
    } catch {
      return false;
    }
  };
  await app.register(cors, {
    origin: (origin, cb) => {
      const normalizedOrigin = origin ? normalizeOrigin(origin) : '';
      if (!origin || isAllowedOrigin(normalizedOrigin)) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Correlation-Id', 'Accept', 'Origin'],
    exposedHeaders: ['X-Total-Count', 'X-Correlation-Id', 'X-Response-Time-Ms', 'Server-Timing'],
    preflight: true,
    strictPreflight: false,
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } }); // 5 MB max
  await app.register(rateLimit, {
    max: Number(process.env.HTTP_RATE_LIMIT_MAX ?? 240),
    timeWindow: process.env.HTTP_RATE_LIMIT_WINDOW ?? '1 minute',
    keyGenerator: (request) => request.ip,
    skipOnError: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Edusen API')
    .setDescription('Backend multi-tenant pour la gestion scolaire')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  const env = process.env.NODE_ENV ?? 'development';
  await app.listen(port, '0.0.0.0');

  const url = `http://0.0.0.0:${port}`;
  const line = `${color.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${color.reset}`;
  logger.log(line, 'Bootstrap');
  logger.log(`${color.green}🎓  Edusen Backend — démarrage réussi${color.reset}`, 'Bootstrap');
  logger.log(line, 'Bootstrap');
  logger.log(`${color.blue}🌍  Environnement${color.reset} : ${env}`, 'Bootstrap');
  logger.log(`${color.blue}🚀  API${color.reset}           : ${url}/api`, 'Bootstrap');
  logger.log(`${color.blue}📖  Swagger${color.reset}       : ${url}/docs`, 'Bootstrap');
  logger.log(`${color.blue}❤️   Health check${color.reset}  : ${url}/api/health`, 'Bootstrap');
  logger.log(`${color.blue}🗄️   Base de données${color.reset}: PostgreSQL connectée`, 'Bootstrap');
  logger.log(`${color.blue}⚡  Moteur HTTP${color.reset}   : Fastify`, 'Bootstrap');
  logger.log(`${color.dim}CORS autorisés: ${Array.from(allowedOrigins).join(', ')}${color.reset}`, 'Bootstrap');
  logger.log(line, 'Bootstrap');
}

void bootstrap().catch((error: unknown) => {
  const logger = new AppLoggerService();
  const message = error instanceof Error ? error.message : String(error);
  const trace = error instanceof Error ? error.stack : undefined;

  logger.fatal(`[BootstrapFailure] ${message}`, trace, 'Bootstrap');
  process.exit(1);
});
