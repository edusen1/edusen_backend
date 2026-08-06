-- Feature flags par plan d'abonnement
CREATE TABLE IF NOT EXISTS "plan_features" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan" VARCHAR(50) NOT NULL,
    "featureKey" VARCHAR(100) NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "plan_features_plan_featureKey_key" ON "plan_features"("plan", "featureKey");

-- Surcharges de fonctionnalites par ecole
CREATE TABLE IF NOT EXISTS "tenant_feature_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "featureKey" VARCHAR(100) NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_feature_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_feature_overrides_tenantId_featureKey_key" ON "tenant_feature_overrides"("tenantId", "featureKey");

ALTER TABLE "tenant_feature_overrides" DROP CONSTRAINT IF EXISTS "tenant_feature_overrides_tenantId_fkey";
ALTER TABLE "tenant_feature_overrides" ADD CONSTRAINT "tenant_feature_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Limites par plan
CREATE TABLE IF NOT EXISTS "plan_limits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan" VARCHAR(50) NOT NULL,
    "limitKey" VARCHAR(100) NOT NULL,
    "limitValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "plan_limits_plan_limitKey_key" ON "plan_limits"("plan", "limitKey");
