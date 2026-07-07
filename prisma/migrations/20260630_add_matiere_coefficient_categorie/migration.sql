-- Add coefficient and categorie fields back to Matiere table
ALTER TABLE "Matiere" ADD COLUMN IF NOT EXISTS "coefficient" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "Matiere" ADD COLUMN IF NOT EXISTS "categorie" TEXT;
