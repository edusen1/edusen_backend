-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"        UUID         NOT NULL,
    "sessionData"     BYTEA,
    "connected"       BOOLEAN      NOT NULL DEFAULT false,
    "phoneNumber"     VARCHAR(25),
    "displayName"     VARCHAR(200),
    "connectedAt"     TIMESTAMP(3),
    "featureOtp"      BOOLEAN      NOT NULL DEFAULT false,
    "featurePayment"  BOOLEAN      NOT NULL DEFAULT false,
    "featureAbsence"  BOOLEAN      NOT NULL DEFAULT false,
    "featureBulletin" BOOLEAN      NOT NULL DEFAULT false,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_tenantId_key" ON "whatsapp_sessions"("tenantId");

-- AddForeignKey
ALTER TABLE "whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
