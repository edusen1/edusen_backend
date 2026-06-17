CREATE TABLE IF NOT EXISTS "ecole_palette_configs" (
    "id"              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId"        UUID         NOT NULL,
    "libelle"         VARCHAR(100) NOT NULL,
    "primaryColor"    VARCHAR(20)  NOT NULL,
    "secondaryColor"  VARCHAR(20)  NOT NULL,
    "backgroundColor" VARCHAR(20)  NOT NULL,
    "textColor"       VARCHAR(20)  NOT NULL,
    "actif"           BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ecole_palette_configs_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ecole_palette_configs_tenantId_actif_idx"
  ON "ecole_palette_configs"("tenantId", "actif");
