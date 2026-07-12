CREATE TABLE IF NOT EXISTS "user_feature_seens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "feature" VARCHAR(50) NOT NULL,
  "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_feature_seens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_feature_seens_userId_feature_key" ON "user_feature_seens" ("userId", "feature");
CREATE INDEX IF NOT EXISTS "user_feature_seens_userId_idx" ON "user_feature_seens" ("userId");
