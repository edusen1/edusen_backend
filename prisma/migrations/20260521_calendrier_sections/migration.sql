ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "sectionId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CalendrierScolaire_sectionId_fkey'
  ) THEN
    ALTER TABLE "CalendrierScolaire"
      ADD CONSTRAINT "CalendrierScolaire_sectionId_fkey"
      FOREIGN KEY ("sectionId") REFERENCES "Cycle"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CalendrierScolaire_tenantId_sectionId_dateDebut_idx"
  ON "CalendrierScolaire"("tenantId", "sectionId", "dateDebut");
