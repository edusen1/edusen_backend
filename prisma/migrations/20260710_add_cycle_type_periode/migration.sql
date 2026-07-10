-- Add typePeriode column to Cycle (TRIMESTRE or SEMESTRE)
ALTER TABLE "Cycle" ADD COLUMN "typePeriode" VARCHAR(10) NOT NULL DEFAULT 'TRIMESTRE';
