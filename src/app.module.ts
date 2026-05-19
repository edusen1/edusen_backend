import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppAuthGuard } from '@/common/guards/app-auth.guard';
import { GlobalExceptionFilter } from '@/common/filters/global-exception.filter';
import { ResponseInterceptor } from '@/common/interceptors/response.interceptor';
import { PrismaService } from '@/config/prisma.service';
import { AuthController } from '@/modules/auth.controller';
import { PlatformController } from '@/modules/platform.controller';
import { V1Controller } from '@/modules/v1.controller';
import { AdminController } from '@/modules/admin.controller';
import { TeacherController } from '@/modules/teacher.controller';
import { StudentController } from '@/modules/student.controller';
import { ParentController } from '@/modules/parent.controller';
import { CaisseController } from '@/modules/caisse.controller';
import { TenantMiddleware } from '@/common/guards/tenant.middleware';
import { AuthService } from '@/modules/auth/auth.service';
import { PlatformService } from '@/modules/platform/platform.service';
import { SchoolService } from '@/modules/school/school.service';
import { DomainService } from '@/modules/domain.service';
import { LegacyCrudService } from '@/modules/legacy-crud.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { StorageService } from '@/infrastructure/storage/storage.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'change-me-in-production',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [
    AuthController,
    PlatformController,
    V1Controller,
    AdminController,
    TeacherController,
    StudentController,
    ParentController,
    CaisseController,
  ],
  providers: [
    PrismaService,
    RedisService,
    AuthService,
    PlatformService,
    SchoolService,
    DomainService,
    LegacyCrudService,
    MailService,
    StorageService,
    { provide: APP_GUARD, useClass: AppAuthGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
