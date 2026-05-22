-- CreateTable
CREATE TABLE "whatsapp_outbox" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"      UUID NOT NULL,
    "phone"         VARCHAR(30) NOT NULL,
    "message"       TEXT NOT NULL,
    "attempts"      INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_outbox_tenantId_createdAt_idx" ON "whatsapp_outbox"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "whatsapp_outbox" ADD CONSTRAINT "whatsapp_outbox_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
