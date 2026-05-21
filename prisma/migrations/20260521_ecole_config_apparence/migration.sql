-- AlterTable: add apparence fields to EcoleConfig
ALTER TABLE "EcoleConfig"
    ADD COLUMN IF NOT EXISTS "themeColor"  VARCHAR(20) NOT NULL DEFAULT 'blue',
    ADD COLUMN IF NOT EXISTS "sidebarMode" VARCHAR(10) NOT NULL DEFAULT 'light',
    ADD COLUMN IF NOT EXISTS "displayMode" VARCHAR(10) NOT NULL DEFAULT 'light';
