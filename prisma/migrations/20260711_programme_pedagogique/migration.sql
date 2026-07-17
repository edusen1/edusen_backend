-- Programme Pedagogique
DO $$ BEGIN
  CREATE TYPE "StatutProgramme" AS ENUM ('BROUILLON','VALIDE','EN_COURS','TERMINE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ProgrammePedagogique" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "niveauId" UUID NOT NULL,
  "matiereId" UUID NOT NULL,
  "anneeAcademiqueId" UUID NOT NULL,
  "titre" TEXT NOT NULL,
  "description" TEXT,
  "statut" "StatutProgramme" NOT NULL DEFAULT 'BROUILLON',
  "valideParCellule" BOOLEAN NOT NULL DEFAULT false,
  "dateValidation" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "programmes_pedagogiques_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProgrammePedagogique_tenantId_niveauId_matiereId_anneeAcademiqueId_key"
  ON "ProgrammePedagogique" ("tenantId", "niveauId", "matiereId", "anneeAcademiqueId");
CREATE INDEX IF NOT EXISTS "programmes_pedagogiques_tenant_annee_idx"
  ON "ProgrammePedagogique" ("tenantId", "anneeAcademiqueId");

ALTER TABLE "ProgrammePedagogique" DROP CONSTRAINT IF EXISTS "ProgrammePedagogique_tenantId_fkey";
ALTER TABLE "ProgrammePedagogique" ADD CONSTRAINT "ProgrammePedagogique_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgrammePedagogique" DROP CONSTRAINT IF EXISTS "ProgrammePedagogique_anneeAcademiqueId_fkey";
ALTER TABLE "ProgrammePedagogique" ADD CONSTRAINT "ProgrammePedagogique_anneeAcademiqueId_fkey"
  FOREIGN KEY ("anneeAcademiqueId") REFERENCES "AnneeAcademique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Chapitres
CREATE TABLE IF NOT EXISTS "ChapitreProgamme" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "programmeId" UUID NOT NULL,
  "numero" INTEGER NOT NULL,
  "titre" TEXT NOT NULL,
  "description" TEXT,
  "objectifs" TEXT,
  "competences" TEXT,
  "ressources" TEXT,
  "prerequis" TEXT,
  "periode" VARCHAR(20) NOT NULL,
  "semaineDebut" INTEGER,
  "semaineFin" INTEGER,
  "dateLimite" DATE NOT NULL,
  "volumeHoraire" DOUBLE PRECISION,
  "nbSeances" INTEGER,
  "evaluationPrevue" BOOLEAN NOT NULL DEFAULT false,
  "typeEvaluation" VARCHAR(50),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "chapitres_programme_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChapitreProgamme_programmeId_numero_idx"
  ON "ChapitreProgamme" ("programmeId", "numero");

ALTER TABLE "ChapitreProgamme" DROP CONSTRAINT IF EXISTS "ChapitreProgamme_programmeId_fkey";
ALTER TABLE "ChapitreProgamme" ADD CONSTRAINT "ChapitreProgamme_programmeId_fkey"
  FOREIGN KEY ("programmeId") REFERENCES "ProgrammePedagogique"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enrichir CahierTexte
ALTER TABLE "CahierTexte" ADD COLUMN IF NOT EXISTS "chapitreId" UUID;
ALTER TABLE "CahierTexte" DROP CONSTRAINT IF EXISTS "CahierTexte_chapitreId_fkey";
ALTER TABLE "CahierTexte" ADD CONSTRAINT "CahierTexte_chapitreId_fkey"
  FOREIGN KEY ("chapitreId") REFERENCES "ChapitreProgamme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
