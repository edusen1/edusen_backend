import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  HeadBucketCommand,
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
  private readonly presignedTtl: number;
  private readonly configured: boolean;

  constructor() {
    const region = process.env.S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT ?? process.env.S3_ENDPOINT_OVERRIDE ?? undefined;
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false';

    this.bucket = process.env.S3_BUCKET ?? 'noura-school-files';
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

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; bucket: string }> {
    if (!this.configured) return { ok: false, latencyMs: 0, bucket: this.bucket };
    const start = Date.now();
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, latencyMs: Date.now() - start, bucket: this.bucket };
    } catch {
      return { ok: false, latencyMs: Date.now() - start, bucket: this.bucket };
    }
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
    if (!this.configured) {
      throw new InternalServerErrorException('Stockage objet non configuré');
    }
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
      const errMsg = (err as Error).message ?? 'unknown';
      this.logger.error(`[Storage] Upload failed key=${key}: ${errMsg}`);
      throw new InternalServerErrorException(
        `Échec de l'upload du fichier : vérifiez la configuration S3 (${errMsg})`,
      );
    }

    this.logger.log(`[Storage] Uploaded key=${key} contentType=${contentType}`);
    return this.buildPublicAccessUrl(key);
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

  private sanitizeName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9.\-_]/g, '')
      .replace(/-+/g, '-');
  }

  buildKey(folder: string, tenantId: string, filename: string): string {
    const parts = filename.split('.');
    const ext = parts.length > 1 ? parts.pop()! : '';
    const unique = randomUUID();
    const safe = `${unique}${ext ? '.' + this.sanitizeName(ext) : ''}`;
    return `${tenantId}/${folder}/${safe}`;
  }

  buildBulletinKey(tenantId: string, eleveId: string, trimestre: string, annee?: string): string {
    const year = annee ? this.sanitizeName(annee) : 'archives';
    const tri = this.sanitizeName(trimestre.replace('/', '-'));
    return `${tenantId}/${year}/bulletins/${eleveId}/${tri}-${randomUUID()}.pdf`;
  }

  buildPhotoKey(tenantId: string, userId: string, role: 'eleves' | 'professeurs' | 'personnel' = 'eleves'): string {
    return `${tenantId}/photos/${role}/${userId}`;
  }

  buildDocumentKey(tenantId: string, type: string, annee: string, userId: string, filename: string): string {
    const parts = filename.split('.');
    const ext = parts.length > 1 ? parts.pop()! : '';
    const safe = `${randomUUID()}${ext ? '.' + this.sanitizeName(ext) : ''}`;
    return `${tenantId}/${this.sanitizeName(annee)}/${type}/${userId}/${safe}`;
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

    // Data URLs (base64) stockés directement quand S3 n'est pas configuré
    if (stored.startsWith('data:')) return stored;

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
