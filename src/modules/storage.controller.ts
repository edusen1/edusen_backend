import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '@/common/decorators/public.decorator';
import { StorageService } from '@/infrastructure/storage/storage.service';

@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('file')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Access-Control-Allow-Origin', '*')
  async getFile(@Query('key') key?: string, @Res() reply?: FastifyReply) {
    if (!key) {
      return reply?.status(400).send({ message: 'Clé de fichier manquante' });
    }

    const object = await this.storage.getObject(key);
    if (!object.Body) {
      return reply?.status(404).send({ message: 'Fichier introuvable' });
    }

    reply?.header('Content-Type', object.ContentType ?? 'application/octet-stream');
    reply?.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    reply?.header('Content-Disposition', 'inline');
    if (object.ContentLength != null) {
      reply?.header('Content-Length', String(object.ContentLength));
    }

    return reply?.send(object.Body as never);
  }
}
