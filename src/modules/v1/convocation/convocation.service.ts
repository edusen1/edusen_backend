import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { MailService } from '@/infrastructure/mail/mail.service';
import { buildPageResult, PageResult, PaginationQueryDto } from '@/shared/dto/pagination-query.dto';
import { rethrowServiceError } from '@/common/utils/service-error.util';

export interface CreateConvocationDto {
  parentId: string;
  eleveId: string;
  motif: string;
  dateConvocation: string;
}

@Injectable()
export class ConvocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async create(tenantId: string, dto: CreateConvocationDto, creePar?: string): Promise<unknown> {
    try {
      const convocation = await this.prisma.convocation.create({
        data: {
          tenantId,
          parentId: dto.parentId,
          eleveId: dto.eleveId,
          motif: dto.motif,
          dateConvocation: new Date(dto.dateConvocation),
          statut: 'EN_ATTENTE',
          creePar,
        },
      });

      const parent = await this.prisma.user.findUnique({ where: { id: dto.parentId } });
      const eleve = await this.prisma.user.findUnique({ where: { id: dto.eleveId } });

      if (parent?.email && eleve) {
        const dateFormatted = new Date(dto.dateConvocation).toLocaleDateString('fr-FR', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        this.mailService.sendConvocation(
          parent.email,
          parent.firstName,
          `${eleve.firstName} ${eleve.lastName}`,
          dateFormatted,
          dto.motif,
        );
      }

      return convocation;
    } catch (error) {
      rethrowServiceError(error, 'creation convocation');
    }
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & { parentId?: string; eleveId?: string },
  ): Promise<PageResult<unknown>> {
    const skip = ((query.page ?? 1) - 1) * (query.size ?? 20);

    const [data, total] = await Promise.all([
      this.prisma.convocation.findMany({
        where: {
          tenantId,
          ...(query.parentId ? { parentId: query.parentId } : {}),
          ...(query.eleveId ? { eleveId: query.eleveId } : {}),
        },
        skip,
        take: query.size ?? 20,
        orderBy: { dateConvocation: 'desc' },
      }),
      this.prisma.convocation.count({
        where: {
          tenantId,
          ...(query.parentId ? { parentId: query.parentId } : {}),
          ...(query.eleveId ? { eleveId: query.eleveId } : {}),
        },
      }),
    ]);

    return buildPageResult(data, total, query.page ?? 1, query.size ?? 20);
  }

  async findOne(tenantId: string, id: string): Promise<unknown> {
    const c = await this.prisma.convocation.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Convocation introuvable');
    return c;
  }

  async updateStatut(tenantId: string, id: string, statut: string, compteRendu?: string): Promise<unknown> {
    await this.findOne(tenantId, id);
    return this.prisma.convocation.update({ where: { id }, data: { statut, compteRendu } });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.findOne(tenantId, id);
    await this.prisma.convocation.delete({ where: { id } });
  }
}
