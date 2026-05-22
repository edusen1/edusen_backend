import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { AppModule } from '@/app.module';

const logger = new Logger('Bootstrap');

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

  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS
    ?? 'http://localhost:4200,https://nouraschool.assanediallo.com,http://127.0.0.1:4200'
  ).split(',').map((o) => o.trim());
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'Accept'],
    exposedHeaders: ['X-Total-Count'],
  });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('NouraSchool API')
    .setDescription('Migration compl�te vers NestJS + Fastify')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.PORT ?? 3000);
  const env  = process.env.NODE_ENV ?? 'development';
  await app.listen(port, '0.0.0.0');

  const url = `http://0.0.0.0:${port}`;
  logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.log('🎓  NouraSchool Backend — démarrage réussi');
  logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.log(`🌍  Environnement : ${env}`);
  logger.log(`🚀  API en écoute : ${url}/api`);
  logger.log(`📖  Swagger docs  : ${url}/docs`);
  logger.log(`❤️   Health check  : ${url}/api/health`);
  logger.log(`🗄️   Base de données PostgreSQL connectée`);
  logger.log(`⚡  Moteur HTTP   : Fastify`);
  logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

void bootstrap();
