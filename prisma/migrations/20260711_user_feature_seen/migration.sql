CREATE TABLE IF NOT EXISTS "UserFeatureSeen" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "feature" VARCHAR(50) NOT NULL,
  "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserFeatureSeen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserFeatureSeen_userId_feature_key" ON "UserFeatureSeen" ("userId", "feature");
CREATE INDEX IF NOT EXISTS "UserFeatureSeen_userId_idx" ON "UserFeatureSeen" ("userId");
