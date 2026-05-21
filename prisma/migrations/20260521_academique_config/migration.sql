-- Make AnneeAcademique.dateFin optional (was NOT NULL)
ALTER TABLE "AnneeAcademique" ALTER COLUMN "dateFin" DROP NOT NULL;

-- CreateTable FraisNiveauConfig
CREATE TABLE "FraisNiveauConfig" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"    UUID         NOT NULL,
    "section"     VARCHAR(100) NOT NULL,
    "niveau"      VARCHAR(100) NOT NULL,
    "inscription" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mensualite"  DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nbMois"      INTEGER      NOT NULL DEFAULT 9,
    "moisDebut"   INTEGER,
    "moisFin"     INTEGER,
    "actif"       BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraisNiveauConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FraisNiveauConfig_tenantId_section_niveau_key"
    ON "FraisNiveauConfig"("tenantId", "section", "niveau");

CREATE INDEX "FraisNiveauConfig_tenantId_idx" ON "FraisNiveauConfig"("tenantId");

-- AddForeignKey
ALTER TABLE "FraisNiveauConfig" ADD CONSTRAINT "FraisNiveauConfig_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
