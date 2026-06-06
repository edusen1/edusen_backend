-- Alignement du schéma Prisma avec la base existante
-- Cette migration ajoute les colonnes récentes utilisées par le frontend et l'authentification.

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "numeroIdentificationNational" VARCHAR(10);

ALTER TABLE "Inscription"
ADD COLUMN IF NOT EXISTS "fraisInscription" DOUBLE PRECISION;
