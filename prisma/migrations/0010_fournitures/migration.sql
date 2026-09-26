-- Migration: 0010_fournitures
-- Ajout de la table fournitures par niveau

CREATE TABLE "Fourniture" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"    UUID        NOT NULL,
  "niveauId"    UUID        NOT NULL,
  "nom"         TEXT        NOT NULL,
  "quantite"    INTEGER     NOT NULL DEFAULT 1,
  "description" TEXT,
  "obligatoire" BOOLEAN     NOT NULL DEFAULT TRUE,
  "ordre"       INTEGER     NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Fourniture_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Fourniture_tenantId_niveauId_idx" ON "Fourniture"("tenantId", "niveauId");

ALTER TABLE "Fourniture" ADD CONSTRAINT "Fourniture_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Fourniture" ADD CONSTRAINT "Fourniture_niveauId_fkey"
  FOREIGN KEY ("niveauId") REFERENCES "Niveau"("id") ON DELETE CASCADE ON UPDATE CASCADE;
