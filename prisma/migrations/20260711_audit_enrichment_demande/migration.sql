-- Enrich AuditLog with user info, device info, geolocation
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "userMatricule" VARCHAR(50);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "userNomComplet" VARCHAR(200);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "userEmail" VARCHAR(200);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "userTelephone" VARCHAR(30);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "userUsername" VARCHAR(100);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "deviceType" VARCHAR(50);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "browserName" VARCHAR(100);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "osName" VARCHAR(100);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "geoCity" VARCHAR(100);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "geoCountry" VARCHAR(100);

-- DemandeAudit enum and table
DO $$ BEGIN
  CREATE TYPE "StatutDemandeAudit" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "demandes_audit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "demandePar" UUID NOT NULL,
  "motif" TEXT NOT NULL,
  "dateDebut" DATE NOT NULL,
  "dateFin" DATE NOT NULL,
  "filtreActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "filtreRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "filtreUserId" UUID,
  "filtreResources" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "statut" "StatutDemandeAudit" NOT NULL DEFAULT 'EN_ATTENTE',
  "traitePar" UUID,
  "commentaire" TEXT,
  "dateTraitement" TIMESTAMP(3),
  "expirationAcces" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "demandes_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "demandes_audit_tenant_statut_idx" ON "demandes_audit" ("tenantId", "statut");

ALTER TABLE "demandes_audit" DROP CONSTRAINT IF EXISTS "demandes_audit_tenantId_fkey";
ALTER TABLE "demandes_audit" ADD CONSTRAINT "demandes_audit_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "demandes_audit" DROP CONSTRAINT IF EXISTS "demandes_audit_demandePar_fkey";
ALTER TABLE "demandes_audit" ADD CONSTRAINT "demandes_audit_demandePar_fkey"
  FOREIGN KEY ("demandePar") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
