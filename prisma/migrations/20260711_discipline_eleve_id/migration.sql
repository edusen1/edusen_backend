DO $$
BEGIN
  IF to_regclass('public."Discipline"') IS NOT NULL THEN
    ALTER TABLE "Discipline" ADD COLUMN IF NOT EXISTS "eleveId" UUID;
    ALTER TABLE "Discipline" ADD COLUMN IF NOT EXISTS "classeId" UUID;
  END IF;
END $$;
