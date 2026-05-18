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
      throw new ConflictException(`Conflit de données pendant: ${action}`);
    }
    if (error.code === 'P2025') {
      throw new NotFoundException(`Ressource introuvable pendant: ${action}`);
    }
    throw new BadRequestException(`Erreur de données pendant: ${action}`);
  }

  throw new InternalServerErrorException(`Erreur inattendue pendant: ${action}`);
}
