CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "communications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "titre" VARCHAR(200) NOT NULL,
  "contenu" TEXT NOT NULL,
  "canal" VARCHAR(20) NOT NULL DEFAULT 'IN_APP',
  "statut" VARCHAR(20) NOT NULL DEFAULT 'BROUILLON',
  "cibleType" VARCHAR(30) NOT NULL DEFAULT 'ROLES',
  "cible" VARCHAR(40),
  "roles" JSONB,
  "classeIds" JSONB,
  "niveauIds" JSONB,
  "cycleIds" JSONB,
  "utilisateurIds" JSONB,
  "inclureParents" BOOLEAN NOT NULL DEFAULT false,
  "inclureEleves" BOOLEAN NOT NULL DEFAULT true,
  "nbDestinataires" INTEGER NOT NULL DEFAULT 0,
  "nbLus" INTEGER NOT NULL DEFAULT 0,
  "datePlanifiee" TIMESTAMP(3),
  "envoyeLe" TIMESTAMP(3),
  "auteurId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "communications_tenantId_statut_createdAt_idx"
  ON "communications" ("tenantId", "statut", "createdAt");

CREATE INDEX IF NOT EXISTS "communications_tenantId_canal_idx"
  ON "communications" ("tenantId", "canal");
