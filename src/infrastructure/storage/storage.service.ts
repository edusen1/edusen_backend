import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  HeadObjectCommand,
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
  private readonly configured: boolean;

  constructor() {
    const region = process.env.S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT ?? process.env.S3_ENDPOINT_OVERRIDE ?? undefined;
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false';

    this.bucket = process.env.S3_BUCKET ?? 'noura-school-files';
    this.publicBaseUrl = process.env.S3_PUBLIC_URL ?? process.env.S3_PUBLIC_BASE_URL ?? null;
    this.presignedTtl = Number(process.env.S3_PRESIGNED_TTL_SECONDS ?? 900);

    const accessKeyId = process.env.S3_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID ?? '';
    const secretAccessKey = process.env.S3_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? '';
    this.configured = Boolean(
      accessKeyId
      && secretAccessKey
      && (endpoint || process.env.S3_REGION || process.env.AWS_REGION),
    );

    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle } : {}),
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async uploadPrivate(key: string, buffer: Buffer, contentType: string): Promise<void> {
    if (!this.configured) {
      throw new InternalServerErrorException('Stockage objet non configure');
    }

    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }));
    } catch (err) {
      this.logger.error(`[Storage] Private upload failed key=${key}: ${(err as Error).message}`);
      throw new InternalServerErrorException('Echec du stockage prive');
    }
  }

  async getPrivateBuffer(key: string): Promise<Buffer | null> {
    if (!this.configured) return null;

    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) return null;
      const body = response.Body as { transformToByteArray?: () => Promise<Uint8Array> };
      if (body.transformToByteArray) {
        return Buffer.from(await body.transformToByteArray());
      }
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (err) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return null;
      this.logger.error(`[Storage] Private download failed key=${key}: ${error.name ?? 'unknown error'}`);
      throw new InternalServerErrorException('Echec de lecture du stockage prive');
    }
  }

  async privateObjectExists(key: string): Promise<boolean> {
    if (!this.configured) return false;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
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
    const base =
      process.env.API_PUBLIC_URL ??
      process.env.PUBLIC_API_URL ??
      process.env.BACKEND_PUBLIC_URL ??
      process.env.APP_PUBLIC_URL ??
      (process.env.NODE_ENV === 'production'
        ? 'https://backend.medaaris.com/api'
        : 'http://localhost:3000/api');
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

      if (parsed.pathname.endsWith('/storage/file')) {
        const key = parsed.searchParams.get('key');
        if (key) {
          return this.buildPublicAccessUrl(key);
        }
      }

      // URLs déjà résolues vers notre endpoint public: ne pas retransformer
      if (segments[0] === 'storage' && segments[1] === 'file') {
        const key = parsed.searchParams.get('key');
        return key ? this.buildPublicAccessUrl(key) : stored;
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
