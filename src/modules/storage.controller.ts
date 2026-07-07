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

    const cleanKey = key.split('?')[0];
    const object = await this.storage.getObject(cleanKey);
    if (!object.Body) {
      return reply?.status(404).send({ message: 'Fichier introuvable' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    const isPhoto = key.includes('/photos/');
    reply?.header('Content-Type', object.ContentType ?? 'application/octet-stream');
    reply?.header('Cache-Control', isPhoto ? 'no-cache' : 'public, max-age=86400, stale-while-revalidate=604800');
    reply?.header('Content-Disposition', 'inline');
    reply?.header('Content-Length', String(buffer.length));

    return reply?.send(buffer);
  }
}
