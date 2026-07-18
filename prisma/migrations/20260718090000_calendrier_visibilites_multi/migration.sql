-- Calendrier scolaire : visibilité multi-acteurs
-- Passage de `visibilite` (enum simple) à `visibilites` (tableau d'enum),
-- pour permettre de cibler plusieurs acteurs à la fois.

-- 1. Renommer ADMIN_ONLY -> ADMIN (idempotent)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'VisibiliteEvenement' AND e.enumlabel = 'ADMIN_ONLY'
  ) THEN
    ALTER TYPE "VisibiliteEvenement" RENAME VALUE 'ADMIN_ONLY' TO 'ADMIN';
  END IF;
END $$;

-- 2. Nouveaux acteurs
ALTER TYPE "VisibiliteEvenement" ADD VALUE IF NOT EXISTS 'SURVEILLANTS';
ALTER TYPE "VisibiliteEvenement" ADD VALUE IF NOT EXISTS 'CAISSE';
ALTER TYPE "VisibiliteEvenement" ADD VALUE IF NOT EXISTS 'RH';

-- 3. Nouvelle colonne tableau
ALTER TABLE "CalendrierScolaire"
  ADD COLUMN IF NOT EXISTS "visibilites" "VisibiliteEvenement"[] NOT NULL DEFAULT ARRAY['TOUS']::"VisibiliteEvenement"[];

-- 4. Reprise des données depuis l'ancienne colonne simple puis suppression
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CalendrierScolaire' AND column_name = 'visibilite'
  ) THEN
    UPDATE "CalendrierScolaire" SET "visibilites" = ARRAY["visibilite"];
    ALTER TABLE "CalendrierScolaire" DROP COLUMN "visibilite";
  END IF;
END $$;
