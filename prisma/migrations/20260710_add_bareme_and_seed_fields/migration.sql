-- Add moyenneMaximale and seeded to Cycle
ALTER TABLE "Cycle" ADD COLUMN IF NOT EXISTS "moyenneMaximale" DOUBLE PRECISION NOT NULL DEFAULT 20;
ALTER TABLE "Cycle" ADD COLUMN IF NOT EXISTS "seeded" BOOLEAN NOT NULL DEFAULT false;

-- Add seeded to Niveau
ALTER TABLE "Niveau" ADD COLUMN IF NOT EXISTS "seeded" BOOLEAN NOT NULL DEFAULT false;

-- Add noteMaximum to MatiereNiveau
ALTER TABLE "MatiereNiveau" ADD COLUMN IF NOT EXISTS "noteMaximum" DOUBLE PRECISION NOT NULL DEFAULT 20;
