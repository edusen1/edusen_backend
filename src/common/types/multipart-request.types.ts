import type { FastifyRequest } from 'fastify';

interface MultipartFileLike {
  mimetype: string;
  filename: string;
  toBuffer(): Promise<Buffer>;
}

export type MultipartFastifyRequest = FastifyRequest & {
  isMultipart(): boolean;
  file(): Promise<MultipartFileLike | undefined>;
};
