CREATE UNIQUE INDEX "users_tenant_telephone_unique"
ON "User"("tenantId", "telephone");
