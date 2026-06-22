import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { finalize, Observable } from 'rxjs';
import { AppLoggerService } from '@/common/logger/app-logger.service';
import { RequestContextService } from '@/common/performance/request-context.service';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  private readonly slowRequestMs = Number(process.env.SLOW_REQUEST_MS ?? 750);

  constructor(
    private readonly requestContext: RequestContextService,
    private readonly logger: AppLoggerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const response = http.getResponse<FastifyReply>();
    const correlationId = this.readHeader(request, 'x-correlation-id') ?? randomUUID();
    const startedAt = performance.now();
    const requestContext = {
      correlationId,
      tenantId: this.readHeader(request, 'x-tenant-id'),
      method: request.method,
      path: request.url,
      startedAt,
    };

    return new Observable((subscriber) => {
      this.requestContext.run(requestContext, () => {
        next
          .handle()
          .pipe(
            finalize(() => {
              const durationMs = performance.now() - startedAt;
              response.header('x-correlation-id', correlationId);
              response.header('x-response-time-ms', durationMs.toFixed(0));
              response.header('server-timing', `app;dur=${durationMs.toFixed(1)}`);

              if (durationMs >= this.slowRequestMs) {
                this.logger.warn(
                  `[SlowRequest] durationMs=${durationMs.toFixed(1)} method=${request.method} path=${request.url} tenant=${requestContext.tenantId ?? '-'} correlationId=${correlationId}`,
                  ResponseInterceptor.name,
                );
              }
            }),
          )
          .subscribe(subscriber);
      });
    });
  }

  private readHeader(request: FastifyRequest, header: string): string | undefined {
    const value = request.headers[header];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' && first.trim() ? first.trim() : undefined;
  }
}
