-- Add CDD duration and end date fields to Personnel
ALTER TABLE "Personnel" ADD COLUMN IF NOT EXISTS "dureeMois" INTEGER;
ALTER TABLE "Personnel" ADD COLUMN IF NOT EXISTS "dateFinContrat" DATE;
