CREATE INDEX IF NOT EXISTS "whatsapp_outbox_tenantId_attempts_createdAt_idx"
ON "whatsapp_outbox" ("tenantId", "attempts", "createdAt");
