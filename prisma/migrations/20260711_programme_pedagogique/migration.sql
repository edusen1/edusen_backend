-- Programme Pedagogique
DO $$ BEGIN
  CREATE TYPE "StatutProgramme" AS ENUM ('BROUILLON','VALIDE','EN_COURS','TERMINE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "programmes_pedagogiques" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "programmes_pedagogiques_tenant_niveau_matiere_annee_key"
  ON "programmes_pedagogiques" ("tenantId", "niveauId", "matiereId", "anneeAcademiqueId");
CREATE INDEX IF NOT EXISTS "programmes_pedagogiques_tenant_annee_idx"
  ON "programmes_pedagogiques" ("tenantId", "anneeAcademiqueId");

ALTER TABLE "programmes_pedagogiques" DROP CONSTRAINT IF EXISTS "programmes_pedagogiques_tenantId_fkey";
ALTER TABLE "programmes_pedagogiques" ADD CONSTRAINT "programmes_pedagogiques_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "programmes_pedagogiques" DROP CONSTRAINT IF EXISTS "programmes_pedagogiques_anneeAcademiqueId_fkey";
ALTER TABLE "programmes_pedagogiques" ADD CONSTRAINT "programmes_pedagogiques_anneeAcademiqueId_fkey"
  FOREIGN KEY ("anneeAcademiqueId") REFERENCES "annees_academiques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Chapitres
CREATE TABLE IF NOT EXISTS "chapitres_programme" (
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

CREATE INDEX IF NOT EXISTS "chapitres_programme_programme_numero_idx"
  ON "chapitres_programme" ("programmeId", "numero");

ALTER TABLE "chapitres_programme" DROP CONSTRAINT IF EXISTS "chapitres_programme_programmeId_fkey";
ALTER TABLE "chapitres_programme" ADD CONSTRAINT "chapitres_programme_programmeId_fkey"
  FOREIGN KEY ("programmeId") REFERENCES "programmes_pedagogiques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enrichir CahierTexte
ALTER TABLE "cahiers_texte" ADD COLUMN IF NOT EXISTS "chapitreId" UUID;
ALTER TABLE "cahiers_texte" DROP CONSTRAINT IF EXISTS "cahiers_texte_chapitreId_fkey";
ALTER TABLE "cahiers_texte" ADD CONSTRAINT "cahiers_texte_chapitreId_fkey"
  FOREIGN KEY ("chapitreId") REFERENCES "chapitres_programme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
