import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | null;
  private readonly presignedTtl: number;

  constructor() {
    const region = process.env.S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT ?? process.env.S3_ENDPOINT_OVERRIDE ?? undefined;
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false';

    this.bucket = process.env.S3_BUCKET ?? 'noura-school-files';
    this.publicBaseUrl = process.env.S3_PUBLIC_URL ?? process.env.S3_PUBLIC_BASE_URL ?? null;
    this.presignedTtl = Number(process.env.S3_PRESIGNED_TTL_SECONDS ?? 900);

    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle } : {}),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
    });
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      this.logger.error(`[Storage] Upload failed key=${key}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Echec de l upload du fichier');
    }

    this.logger.log(`[Storage] Uploaded key=${key} contentType=${contentType}`);
    return this.publicBaseUrl ? `${this.publicBaseUrl.replace(/\/$/, '')}/${this.bucket}/${key}` : key;
  }

  async getPresignedUrl(key: string, ttlSeconds?: number): Promise<string> {
    try {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      return await getSignedUrl(this.client, command, {
        expiresIn: ttlSeconds ?? this.presignedTtl,
      });
    } catch (err) {
      this.logger.error(`[Storage] Presign failed key=${key}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Echec de generation du lien securise');
    }
  }

  async getObject(key: string): Promise<GetObjectCommandOutput> {
    try {
      return await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (err) {
      const error = err as { name?: string; code?: string; message?: string };
      this.logger.warn(`[Storage] Get object failed key=${key}: ${error.message ?? 'unknown error'}`);
      throw new NotFoundException('Fichier introuvable');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      this.logger.error(`[Storage] Delete failed key=${key}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Echec de suppression du fichier');
    }
    this.logger.log(`[Storage] Deleted key=${key}`);
  }

  buildKey(folder: string, tenantId: string, filename: string): string {
    const ext = filename.includes('.') ? filename.split('.').pop() : '';
    const unique = randomUUID();
    return `${folder}/${tenantId}/${unique}${ext ? '.' + ext : ''}`;
  }

  buildBulletinKey(tenantId: string, eleveId: string, trimestre: string): string {
    return `bulletins/${tenantId}/${eleveId}/${trimestre.replace('/', '-')}_${randomUUID()}.pdf`;
  }

  buildPhotoKey(tenantId: string, userId: string): string {
    return `photos/${tenantId}/${userId}`;
  }

  buildPublicAccessUrl(key: string): string {
    const base = process.env.API_PUBLIC_URL ?? process.env.PUBLIC_API_URL ?? 'http://localhost:3000/api';
    return `${base.replace(/\/$/, '')}/storage/file?key=${encodeURIComponent(key)}`;
  }

  /**
   * Normalise une valeur stockée en base (clé brute ou URL complète avec n'importe quel hôte)
   * vers l'URL publique correcte (S3_PUBLIC_URL actuel). Gère la migration transparente
   * si l'hôte MinIO a changé depuis la création de l'enregistrement.
   */
  resolveUrl(stored: string | null | undefined): string | null {
    if (!stored) return null;

    if (!stored.startsWith('http')) {
      return this.buildPublicAccessUrl(stored);
    }

    try {
      const parsed = new URL(stored);
      const segments = parsed.pathname.split('/').filter(Boolean);

      // URLs déjà résolues vers notre endpoint public: ne pas retransformer
      if (segments[0] === 'storage' && segments[1] === 'file') {
        return stored;
      }

      // URLs MinIO/S3 classiques: on ne réécrit que les hôtes MinIO connus
      if ((parsed.hostname.includes('minio') || parsed.pathname.includes(`/${this.bucket}/`)) && segments.length >= 2) {
        const key = segments.slice(1).join('/');
        return this.buildPublicAccessUrl(key);
      }
    } catch {
      // fallback below
    }

    return stored;
  }
}
