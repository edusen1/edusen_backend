DO $$
BEGIN
  IF to_regclass('public.communications') IS NOT NULL THEN
    ALTER TABLE "communications"
      ADD COLUMN IF NOT EXISTS "documentUrl" TEXT,
      ADD COLUMN IF NOT EXISTS "documentNom" VARCHAR(300),
      ADD COLUMN IF NOT EXISTS "documentMimeType" VARCHAR(120),
      ADD COLUMN IF NOT EXISTS "documentTaille" INTEGER;
  END IF;
END $$;
