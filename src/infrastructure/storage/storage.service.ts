import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

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
}
