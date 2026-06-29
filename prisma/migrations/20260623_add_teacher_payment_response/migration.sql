DO $$
BEGIN
  IF to_regclass('"PaiementProfesseur"') IS NOT NULL THEN
    ALTER TABLE "PaiementProfesseur"
      ADD COLUMN IF NOT EXISTS "motifRejet" TEXT,
      ADD COLUMN IF NOT EXISTS "reponduLe" TIMESTAMP(3);
  END IF;
END $$;
