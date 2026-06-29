ALTER TABLE "Classe"
  ADD COLUMN IF NOT EXISTS "cycleId" UUID;

UPDATE "Classe" AS classe
SET "cycleId" = niveau."cycleId"
FROM "Niveau" AS niveau
WHERE classe."niveauId" = niveau."id"
  AND classe."cycleId" IS NULL;

CREATE INDEX IF NOT EXISTS "Classe_tenantId_cycleId_idx"
  ON "Classe"("tenantId", "cycleId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Classe_cycleId_fkey'
  ) THEN
    ALTER TABLE "Classe"
      ADD CONSTRAINT "Classe_cycleId_fkey"
      FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
