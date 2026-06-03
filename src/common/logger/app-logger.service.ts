import { Injectable, LoggerService } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as winston from 'winston';
import DailyRotateFile = require('winston-daily-rotate-file');

const appLogLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  http: 4,
  verbose: 5,
  debug: 6,
} as const;

const appLogColors: Record<keyof typeof appLogLevels, string> = {
  fatal: 'red bold',
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
};

type AppLogLevel = keyof typeof appLogLevels;

@Injectable()
export class AppLoggerService implements LoggerService {
  private static logger: winston.Logger | undefined;

  private readonly logger: winston.Logger;

  constructor() {
    this.logger = AppLoggerService.getLogger();
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, this.getContext(optionalParams));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const { trace, context } = this.getTraceAndContext(optionalParams);
    this.write('error', message, context, trace);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, this.getContext(optionalParams));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, this.getContext(optionalParams));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, this.getContext(optionalParams));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    const { trace, context } = this.getTraceAndContext(optionalParams);
    this.write('fatal', message, context, trace);
  }

  private static getLogger(): winston.Logger {
    if (AppLoggerService.logger) {
      return AppLoggerService.logger;
    }

    winston.addColors(appLogColors);

    const logDir = path.join(process.cwd(), process.env.LOG_DIR ?? 'logs');
    mkdirSync(logDir, { recursive: true });

    const level = AppLoggerService.resolveLevel(process.env.LOG_LEVEL, process.env.NODE_ENV);
    const fileFormat = AppLoggerService.createFormat(false);
    const consoleFormat = AppLoggerService.createFormat(true);

    AppLoggerService.logger = winston.createLogger({
      level,
      levels: appLogLevels,
      exitOnError: false,
      transports: [
        new DailyRotateFile({
          level,
          dirname: logDir,
          filename: 'application-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: process.env.LOG_MAX_SIZE ?? '30m',
          maxFiles: process.env.LOG_MAX_FILES ?? '20d',
          format: fileFormat,
        }),
        new DailyRotateFile({
          level: 'error',
          dirname: logDir,
          filename: 'error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: process.env.LOG_MAX_SIZE ?? '30m',
          maxFiles: process.env.LOG_MAX_FILES ?? '20d',
          format: fileFormat,
        }),
      ],
    });

    if (process.env.NODE_ENV !== 'test') {
      AppLoggerService.logger.add(
        new winston.transports.Console({
          level,
          format: consoleFormat,
        }),
      );
    }

    return AppLoggerService.logger;
  }

  private static resolveLevel(rawLevel: string | undefined, nodeEnv: string | undefined): AppLogLevel {
    const fallback = nodeEnv === 'production' ? 'info' : 'debug';
    const normalized = rawLevel === 'log' ? 'info' : rawLevel;

    if (normalized && normalized in appLogLevels) {
      return normalized as AppLogLevel;
    }

    return fallback;
  }

  private static createFormat(colorize: boolean): winston.Logform.Format {
    return winston.format.combine(
      winston.format.timestamp(),
      ...(colorize ? [winston.format.colorize({ all: true })] : []),
      winston.format.printf((info) => {
        const timestamp = typeof info.timestamp === 'string' ? info.timestamp : new Date().toISOString();
        const context = typeof info.context === 'string' && info.context ? `[${info.context}] ` : '';
        const trace = typeof info.trace === 'string' && info.trace ? `\n${info.trace}` : '';
        const message = AppLoggerService.stringifyMessage(info.message);

        return `${timestamp} ${info.level.toUpperCase()} ${context}${message}${trace}`;
      }),
    );
  }

  private write(level: AppLogLevel, message: unknown, context?: string, trace?: string): void {
    this.logger.log({
      level,
      message: AppLoggerService.stringifyMessage(message),
      context,
      trace,
    });
  }

  private getContext(optionalParams: unknown[]): string | undefined {
    const lastParam = optionalParams.at(-1);
    return typeof lastParam === 'string' ? lastParam : undefined;
  }

  private getTraceAndContext(optionalParams: unknown[]): { trace?: string; context?: string } {
    if (optionalParams.length === 0) {
      return {};
    }

    const errorParam = optionalParams.find((param): param is Error => param instanceof Error);
    const stringParams = optionalParams.filter((param): param is string => typeof param === 'string');

    if (stringParams.length >= 2) {
      return {
        trace: stringParams[0],
        context: stringParams[stringParams.length - 1],
      };
    }

    if (stringParams.length === 1) {
      const value = stringParams[0];
      const looksLikeTrace = value.includes('\n') || value.includes(' at ') || value.startsWith('Error');
      return looksLikeTrace ? { trace: value } : { context: value };
    }

    return { trace: errorParam?.stack };
  }

  private static stringifyMessage(message: unknown): string {
    if (message instanceof Error) {
      return message.stack ?? message.message;
    }

    if (typeof message === 'string') {
      return message;
    }

    if (typeof message === 'bigint') {
      return message.toString();
    }

    if (typeof message === 'object' && message !== null) {
      try {
        return JSON.stringify(message);
      } catch {
        return String(message);
      }
    }

    return String(message);
  }
}
