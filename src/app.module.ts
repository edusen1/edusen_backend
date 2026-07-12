import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppAuthGuard } from '@/common/guards/app-auth.guard';
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { AuditInterceptor } from '@/common/interceptors/audit.interceptor';
import { AppLoggerService } from '@/common/logger/app-logger.service';
import { RequestContextService } from '@/common/performance/request-context.service';
import { PrismaService } from '@/config/prisma.service';
import { AuthController } from '@/modules/auth.controller';
import { PlatformController } from '@/modules/platform.controller';
import { V1Controller } from '@/modules/v1.controller';
import { AdminController } from '@/modules/admin.controller';
import { ConfigurationController } from '@/modules/configuration.controller';
import { TeacherController } from '@/modules/teacher.controller';
import { StudentController } from '@/modules/student.controller';
import { ParentController } from '@/modules/parent.controller';
import { CaisseController } from '@/modules/caisse.controller';
import { StorageController } from '@/modules/storage.controller';
import { TenantMiddleware } from '@/common/guards/tenant.middleware';
import { AuthService } from '@/modules/auth/auth.service';
import { PlatformService } from '@/modules/platform/platform.service';
import { SchoolService } from '@/modules/school/school.service';
import { DomainService } from '@/modules/domain.service';
import { LegacyCrudService } from '@/modules/legacy-crud.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { AppCacheService } from '@/infrastructure/cache/app-cache.service';
import { StorageService } from '@/infrastructure/storage/storage.service';
import { EcoleConfigService } from '@/modules/configuration/ecole-config.service';
import { AcademiqueConfigService } from '@/modules/configuration/academique-config.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { ClasseService } from '@/modules/classes/classe.service';
import { HealthController } from '@/modules/health.controller';
import { EmploiDuTempsService } from '@/modules/v1/emploi-du-temps/emploi-du-temps.service';
import { BulletinService } from '@/modules/v1/bulletin/bulletin.service';
import { MensualitesSchedulerService } from '@/modules/mensualites-scheduler.service';
import { FeriesSyncService } from '@/modules/feries-sync.service';
import { ProgrammeService } from '@/modules/programme/programme.service';
import { BulletinDocumentService } from '@/modules/bulletin-document.service';
import { PaymentReceiptDocumentService } from '@/modules/payment-receipt-document.service';
import { SchoolCardDocumentService } from '@/modules/school-card-document.service';
import { PresenceProfesseurService } from '@/modules/presence-professeur.service';
import { PushNotificationService } from '@/modules/push-notification.service';
import { DemandeReductionService } from '@/modules/v1/demande-reduction/demande-reduction.service';
import { EleveDocumentService } from '@/modules/eleve-document.service';
import { CommunicationService } from '@/modules/communication.service';
import { RapportDocumentService } from '@/modules/rapport-document.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'c1573798629c7fea139ab064c71e40ebb243491a3c6c16f42faba2d13e9d838b',
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    PlatformController,
    V1Controller,
    AdminController,
    ConfigurationController,
    TeacherController,
    StudentController,
    ParentController,
    CaisseController,
    StorageController,
  ],
  providers: [
    AppLoggerService,
    RequestContextService,
    PrismaService,
    RedisService,
    AppCacheService,
    AuthService,
    PlatformService,
    SchoolService,
    DomainService,
    LegacyCrudService,
    MailService,
    StorageService,
    EcoleConfigService,
    AcademiqueConfigService,
    WhatsappService,
    ClasseService,
    EmploiDuTempsService,
    BulletinService,
    BulletinDocumentService,
    PaymentReceiptDocumentService,
    SchoolCardDocumentService,
    PresenceProfesseurService,
    PushNotificationService,
    MensualitesSchedulerService,
    FeriesSyncService,
    ProgrammeService,
    DemandeReductionService,
    EleveDocumentService,
    CommunicationService,
    RapportDocumentService,
    { provide: APP_GUARD, useClass: AppAuthGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
