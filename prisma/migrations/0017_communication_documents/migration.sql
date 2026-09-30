ALTER TABLE "communications"
  ADD COLUMN IF NOT EXISTS "documents" JSONB,
  ADD COLUMN IF NOT EXISTS "anneeAcademiqueId" UUID;
