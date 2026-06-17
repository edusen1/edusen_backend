-- Add custom appearance colors for tenant branding.
ALTER TABLE "EcoleConfig"
    ADD COLUMN IF NOT EXISTS "primaryColor"    VARCHAR(20) NOT NULL DEFAULT '#03a9f3',
    ADD COLUMN IF NOT EXISTS "secondaryColor"  VARCHAR(20) NOT NULL DEFAULT '#16a34a',
    ADD COLUMN IF NOT EXISTS "backgroundColor" VARCHAR(20) NOT NULL DEFAULT '#2f7d6f',
    ADD COLUMN IF NOT EXISTS "textColor"       VARCHAR(20) NOT NULL DEFAULT '#1f2937';
