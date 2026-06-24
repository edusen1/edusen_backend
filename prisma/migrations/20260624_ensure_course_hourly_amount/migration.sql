-- Rattrapage idempotent : couvre les environnements où la migration initiale
-- a été marquée appliquée sans que les colonnes aient été créées.
ALTER TABLE "EcoleConfig"
ADD COLUMN IF NOT EXISTS "montantHoraireDefaut" DOUBLE PRECISION;

ALTER TABLE "Cours"
ADD COLUMN IF NOT EXISTS "montantHoraire" DOUBLE PRECISION;
