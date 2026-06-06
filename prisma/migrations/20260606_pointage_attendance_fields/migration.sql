-- Étend le modèle Pointage pour gérer la présence journalière (registre RH)
ALTER TABLE "Pointage"
  ADD COLUMN IF NOT EXISTS "date" DATE,
  ADD COLUMN IF NOT EXISTS "statut" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "heureArrivee" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "heureDepart" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "observations" TEXT;

-- Valeurs par défaut pour permettre l'insertion sans typePointage/dateHeure explicites
ALTER TABLE "Pointage" ALTER COLUMN "typePointage" SET DEFAULT 'ENTREE';
ALTER TABLE "Pointage" ALTER COLUMN "dateHeure" SET DEFAULT CURRENT_TIMESTAMP;
