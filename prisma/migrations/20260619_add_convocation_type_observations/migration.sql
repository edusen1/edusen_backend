ALTER TABLE "Convocation"
  ADD COLUMN IF NOT EXISTS "type" VARCHAR(40) NOT NULL DEFAULT 'DISCIPLINAIRE',
  ADD COLUMN IF NOT EXISTS "observations" TEXT;

CREATE INDEX IF NOT EXISTS "convocations_tenantId_type_idx"
  ON "Convocation" ("tenantId", "type");
