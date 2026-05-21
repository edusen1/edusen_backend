-- CreateTable
CREATE TABLE "EcoleConfig" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"          UUID NOT NULL,
    "nom"               VARCHAR(200) NOT NULL,
    "slogan"            VARCHAR(300),
    "adresse"           VARCHAR(300) NOT NULL DEFAULT '',
    "ville"             VARCHAR(100) NOT NULL DEFAULT '',
    "pays"              VARCHAR(5) NOT NULL DEFAULT 'SN',
    "telephone"         VARCHAR(25) NOT NULL DEFAULT '',
    "email"             VARCHAR(254) NOT NULL DEFAULT '',
    "siteWeb"           VARCHAR(500),
    "numeroAgrement"    VARCHAR(100),
    "typeEtablissement" VARCHAR(20) NOT NULL DEFAULT 'PRIVE',
    "logoUrl"           TEXT,
    "logoS3Key"         TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcoleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EcoleConfig_tenantId_key" ON "EcoleConfig"("tenantId");

-- AddForeignKey
ALTER TABLE "EcoleConfig" ADD CONSTRAINT "EcoleConfig_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
