-- Discipline : un incident peut concerner un élève, un enseignant ou un membre
-- du personnel — pas uniquement un élève.

DO $$ BEGIN
  CREATE TYPE "SujetIncidentType" AS ENUM ('ELEVE', 'ENSEIGNANT', 'PERSONNEL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Discipline"
  ADD COLUMN IF NOT EXISTS "sujetType" "SujetIncidentType" NOT NULL DEFAULT 'ELEVE',
  ADD COLUMN IF NOT EXISTS "enseignantId" UUID,
  ADD COLUMN IF NOT EXISTS "personnelId" UUID;

CREATE INDEX IF NOT EXISTS "Discipline_tenantId_sujetType_idx" ON "Discipline" ("tenantId", "sujetType");
