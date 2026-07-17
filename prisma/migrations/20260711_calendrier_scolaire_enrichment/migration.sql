-- Enums for CalendrierScolaire
DO $$ BEGIN
  CREATE TYPE "TypeEvenementCalendrier" AS ENUM (
    'RENTREE','FIN_ANNEE','DEBUT_TRIMESTRE','FIN_TRIMESTRE','REPRISE_COURS',
    'VACANCES','JOUR_FERIE','PONT',
    'DEVOIR_SURVEILLE','COMPOSITION','EXAMEN_BLANC','EXAMEN_OFFICIEL','RATTRAPAGE','REMISE_COPIES',
    'CONSEIL_CLASSE','CONSEIL_DISCIPLINE','REUNION_PARENTS','REUNION_PEDAGOGIQUE','ASSEMBLEE_GENERALE',
    'JOURNEE_PORTES_OUVERTES','JOURNEE_CULTURELLE','JOURNEE_SPORTIVE','REMISE_PRIX','SORTIE_PEDAGOGIQUE','SEMAINE_REVISION','PUBLICATION_BULLETINS','DISTRIBUTION_CARTES',
    'DATE_LIMITE_INSCRIPTION','DATE_LIMITE_PAIEMENT','FORMATION_ENSEIGNANTS','AUTRE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "StatutEvenement" AS ENUM ('PLANIFIE','CONFIRME','ANNULE','REPORTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "VisibiliteEvenement" AS ENUM ('TOUS','ADMIN_ONLY','ENSEIGNANTS','PARENTS','ELEVES');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migrate existing type column: convert VARCHAR to enum
-- First add new columns
ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "heureDebut" VARCHAR(5);
ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "heureFin" VARCHAR(5);
ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "statut" "StatutEvenement" NOT NULL DEFAULT 'PLANIFIE';
ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "visibilite" "VisibiliteEvenement" NOT NULL DEFAULT 'TOUS';
ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "classeId" UUID;
ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "niveauId" UUID;
ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "couleur" VARCHAR(7);
ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "important" BOOLEAN NOT NULL DEFAULT false;

-- Convert type column from VARCHAR to enum
ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "type_new" "TypeEvenementCalendrier" NOT NULL DEFAULT 'AUTRE';

-- Map old values to new enum
UPDATE "CalendrierScolaire" SET "type_new" = CASE
  WHEN type = 'rentree' OR type = 'reprise' THEN 'RENTREE'::"TypeEvenementCalendrier"
  WHEN type = 'vacances' THEN 'VACANCES'::"TypeEvenementCalendrier"
  WHEN type = 'conseil' THEN 'CONSEIL_CLASSE'::"TypeEvenementCalendrier"
  WHEN type = 'fin' THEN 'FIN_ANNEE'::"TypeEvenementCalendrier"
  WHEN type = 'composition' THEN 'COMPOSITION'::"TypeEvenementCalendrier"
  WHEN type = 'examen' THEN 'EXAMEN_OFFICIEL'::"TypeEvenementCalendrier"
  ELSE 'AUTRE'::"TypeEvenementCalendrier"
END WHERE type IS NOT NULL;

ALTER TABLE "CalendrierScolaire" DROP COLUMN IF EXISTS "type";
ALTER TABLE "CalendrierScolaire" RENAME COLUMN "type_new" TO "type";

-- Add index
CREATE INDEX IF NOT EXISTS "calendrier_scolaires_tenant_type_idx" ON "CalendrierScolaire" ("tenantId", "type");
