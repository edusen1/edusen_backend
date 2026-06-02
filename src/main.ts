import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { AppModule } from '@/app.module';

const logger = new Logger('Bootstrap');
const color = {
  cyan: '\u001b[1;36m',
  green: '\u001b[1;32m',
  blue: '\u001b[1;34m',
  dim: '\u001b[2m',
  reset: '\u001b[0m',
};

// Empêcher le process de crasher sur des rejections non gérées
// (notamment les erreurs internes de whatsapp-web.js / Puppeteer)
process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error(`[UnhandledRejection] ${msg}`);
  // On logge mais on NE crash PAS le process
});

process.on('uncaughtException', (error: Error) => {
  const isWwebError =
    error.stack?.includes('whatsapp-web.js') ||
    error.stack?.includes('puppeteer') ||
    error.message.includes('Execution context');
  if (isWwebError) {
    logger.error(`[UncaughtException/WhatsApp] ${error.message} — process maintenu`);
  } else {
    logger.error(`[UncaughtException] ${error.stack ?? error.message}`);
    process.exit(1); // Crash uniquement sur des erreurs non-WhatsApp
  }
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  const defaultAllowedOrigins = [
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'https://noura-school.assanediallo.com',
    'https://nouraschool.assanediallo.com',
  ];
  const normalizeOrigin = (origin: string) => origin.trim().replace(/\/$/, '').toLowerCase();
  const allowedOrigins = new Set(
    [
      ...defaultAllowedOrigins,
      ...(process.env.ALLOWED_ORIGINS ?? '').split(','),
    ]
      .map(normalizeOrigin)
      .filter(Boolean),
  );
  await app.register(cors, {
    origin: (origin, cb) => {
      const normalizedOrigin = origin ? normalizeOrigin(origin) : '';
      if (!origin || allowedOrigins.has(normalizedOrigin) || allowedOrigins.has('*')) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'Accept', 'Origin'],
    exposedHeaders: ['X-Total-Count'],
    preflight: true,
    strictPreflight: false,
  });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('NouraSchool API')
    .setDescription('Migration complète vers NestJS + Fastify')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  const env  = process.env.NODE_ENV ?? 'development';
  await app.listen(port, '0.0.0.0');

  const url = `http://0.0.0.0:${port}`;
  const line = `${color.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${color.reset}`;
  logger.log(line);
  logger.log(`${color.green}🎓  NouraSchool Backend — démarrage réussi${color.reset}`);
  logger.log(line);
  logger.log(`${color.blue}🌍  Environnement${color.reset} : ${env}`);
  logger.log(`${color.blue}🚀  API${color.reset}           : ${url}/api`);
  logger.log(`${color.blue}📖  Swagger${color.reset}       : ${url}/docs`);
  logger.log(`${color.blue}❤️   Health check${color.reset}  : ${url}/api/health`);
  logger.log(`${color.blue}🗄️   Base de données${color.reset}: PostgreSQL connectée`);
  logger.log(`${color.blue}⚡  Moteur HTTP${color.reset}   : Fastify`);
  logger.log(`${color.dim}CORS autorisés: ${Array.from(allowedOrigins).join(', ')}${color.reset}`);
  logger.log(line);
}

void bootstrap();
