-- Align the migration history with the current Prisma schema.
-- Some earlier schema changes were applied outside the migration history.

CREATE TYPE "StatutDemandePassage" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');

ALTER TABLE "Appel" DROP CONSTRAINT "Appel_coursId_fkey";
ALTER TABLE "Appel" ALTER COLUMN "coursId" DROP NOT NULL;

ALTER TABLE "EcoleConfig"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "adresse" DROP DEFAULT,
  ALTER COLUMN "ville" DROP DEFAULT,
  ALTER COLUMN "telephone" DROP DEFAULT,
  ALTER COLUMN "email" DROP DEFAULT;

ALTER TABLE "FraisNiveauConfig" ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "PersonnelNiveauAffectation"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Tenant"
  ADD COLUMN "codeAccesAdmin" VARCHAR(16),
  ADD COLUMN "codeAccesCaissier" VARCHAR(16),
  ADD COLUMN "codeAccesEleve" VARCHAR(16),
  ADD COLUMN "codeAccesEnseignant" VARCHAR(16),
  ADD COLUMN "codeAccesRh" VARCHAR(16),
  ADD COLUMN "codeAccesSurveillant" VARCHAR(16);

UPDATE "Tenant"
SET
  "codeAccesAdmin" = COALESCE("codeAccesAdmin", 'A' || substr(replace("id"::text, '-', ''), 1, 15)),
  "codeAccesCaissier" = COALESCE("codeAccesCaissier", 'C' || substr(replace("id"::text, '-', ''), 1, 15)),
  "codeAccesEleve" = COALESCE("codeAccesEleve", 'E' || substr(replace("id"::text, '-', ''), 1, 15)),
  "codeAccesEnseignant" = COALESCE("codeAccesEnseignant", 'P' || substr(replace("id"::text, '-', ''), 1, 15)),
  "codeAccesRh" = COALESCE("codeAccesRh", 'R' || substr(replace("id"::text, '-', ''), 1, 15)),
  "codeAccesSurveillant" = COALESCE("codeAccesSurveillant", 'S' || substr(replace("id"::text, '-', ''), 1, 15));

ALTER TABLE "Tenant"
  ALTER COLUMN "codeAccesAdmin" SET NOT NULL,
  ALTER COLUMN "codeAccesCaissier" SET NOT NULL,
  ALTER COLUMN "codeAccesEleve" SET NOT NULL,
  ALTER COLUMN "codeAccesEnseignant" SET NOT NULL,
  ALTER COLUMN "codeAccesRh" SET NOT NULL,
  ALTER COLUMN "codeAccesSurveillant" SET NOT NULL;

ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "classe_stagiaires"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "dateDebut" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "whatsapp_outbox" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "whatsapp_sessions" ALTER COLUMN "id" DROP DEFAULT;

CREATE TABLE "DemandePassage" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "eleveId" UUID NOT NULL,
  "classeDestId" UUID NOT NULL,
  "anneeAcademiqueId" UUID NOT NULL,
  "motif" TEXT,
  "statut" "StatutDemandePassage" NOT NULL DEFAULT 'EN_ATTENTE',
  "creePar" UUID NOT NULL,
  "traitePar" UUID,
  "motifRefus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DemandePassage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DemandePassage_tenantId_statut_idx" ON "DemandePassage"("tenantId", "statut");
CREATE INDEX "DemandePassage_tenantId_eleveId_idx" ON "DemandePassage"("tenantId", "eleveId");

CREATE UNIQUE INDEX "Tenant_codeAccesEleve_key" ON "Tenant"("codeAccesEleve");
CREATE UNIQUE INDEX "Tenant_codeAccesEnseignant_key" ON "Tenant"("codeAccesEnseignant");
CREATE UNIQUE INDEX "Tenant_codeAccesCaissier_key" ON "Tenant"("codeAccesCaissier");
CREATE UNIQUE INDEX "Tenant_codeAccesAdmin_key" ON "Tenant"("codeAccesAdmin");
CREATE UNIQUE INDEX "Tenant_codeAccesSurveillant_key" ON "Tenant"("codeAccesSurveillant");
CREATE UNIQUE INDEX "Tenant_codeAccesRh_key" ON "Tenant"("codeAccesRh");

ALTER TABLE "Appel"
  ADD CONSTRAINT "Appel_coursId_fkey"
  FOREIGN KEY ("coursId") REFERENCES "Cours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DemandePassage"
  ADD CONSTRAINT "DemandePassage_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DemandePassage"
  ADD CONSTRAINT "DemandePassage_classeDestId_fkey"
  FOREIGN KEY ("classeDestId") REFERENCES "Classe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DemandePassage"
  ADD CONSTRAINT "DemandePassage_anneeAcademiqueId_fkey"
  FOREIGN KEY ("anneeAcademiqueId") REFERENCES "AnneeAcademique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
