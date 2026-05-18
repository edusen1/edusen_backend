import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCycleDto {
  @IsString()
  code!: string;

  @IsString()
  libelle!: string;
}

export class CreateNiveauDto {
  @IsUUID()
  cycleId!: string;

  @IsString()
  code!: string;

  @IsString()
  libelle!: string;

  ordre!: number;
}

export class CreateBatimentDto {
  @IsString()
  nom!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateSalleDto {
  @IsUUID()
  batimentId!: string;

  @IsString()
  nom!: string;

  @IsOptional()
  capacite?: number;

  @IsOptional()
  @IsString()
  typeSalle?: string;
}

export class CreateAnneeDto {
  @IsString()
  libelle!: string;

  @IsString()
  dateDebut!: string;

  @IsString()
  dateFin!: string;
}

export class CreateClasseDto {
  @IsUUID()
  niveauId!: string;

  @IsUUID()
  anneeAcademiqueId!: string;

  @IsOptional()
  @IsUUID()
  salleId?: string;

  @IsString()
  nom!: string;

  @IsOptional()
  effectifMax?: number;
}
