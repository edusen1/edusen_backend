ALTER TABLE "classe_stagiaires"
  ADD COLUMN "dateDebut" DATE,
  ADD COLUMN "dateFin" DATE,
  ADD COLUMN "actif" BOOLEAN NOT NULL DEFAULT true;

UPDATE "classe_stagiaires"
SET "dateDebut" = "createdAt"::date
WHERE "dateDebut" IS NULL;

ALTER TABLE "classe_stagiaires"
  ALTER COLUMN "dateDebut" SET NOT NULL,
  ALTER COLUMN "dateDebut" SET DEFAULT CURRENT_DATE;

DROP INDEX IF EXISTS "classe_stagiaires_classeId_stagiaireId_key";

CREATE UNIQUE INDEX "classe_stagiaires_active_contract_key"
  ON "classe_stagiaires"("classeId", "stagiaireId")
  WHERE "actif" = true AND "dateFin" IS NULL;
