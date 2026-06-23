import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function rethrowServiceError(error: unknown, action: string): never {
  if (error instanceof HttpException) {
    throw error;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new ConflictException('Donnée déjà existante');
    }
    if (error.code === 'P2025') {
      throw new NotFoundException('Ressource introuvable');
    }
    throw new BadRequestException('Données invalides');
  }

  throw new InternalServerErrorException('Erreur serveur');
}
