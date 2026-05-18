import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  size?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'desc' ? 'desc' : 'asc'))
  order?: 'asc' | 'desc' = 'asc';
}

export interface PageResult<T> {
  data: T[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export function buildPageResult<T>(
  data: T[],
  total: number,
  page: number,
  size: number,
): PageResult<T> {
  return { data, total, page, size, totalPages: Math.ceil(total / size) };
}
