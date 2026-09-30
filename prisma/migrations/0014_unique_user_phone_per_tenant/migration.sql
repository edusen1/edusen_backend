UPDATE "User"
SET "telephone" = NULL
WHERE "telephone" IS NOT NULL
  AND btrim("telephone") = '';

CREATE TABLE IF NOT EXISTS "UserPhoneDuplicateAudit" (
  "tenantId" UUID NOT NULL,
  "telephone" VARCHAR(20) NOT NULL,
  "keptUserId" UUID NOT NULL,
  "duplicateUserId" UUID NOT NULL,
  "duplicateRole" "UserRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPhoneDuplicateAudit_pkey"
    PRIMARY KEY ("tenantId", "telephone", "keptUserId", "duplicateUserId")
);

WITH ranked AS (
  SELECT
    "id",
    "tenantId",
    "telephone",
    "role",
    FIRST_VALUE("id") OVER (
      PARTITION BY "tenantId", "telephone"
      ORDER BY
        CASE "role"
          WHEN 'PARENT' THEN 1
          WHEN 'ELEVE' THEN 2
          WHEN 'SECURITE' THEN 3
          WHEN 'ENSEIGNANT' THEN 4
          WHEN 'CAISSIER' THEN 5
          WHEN 'COMPTABLE' THEN 6
          WHEN 'SURVEILLANT' THEN 7
          WHEN 'RH' THEN 8
          WHEN 'GESTIONNAIRE' THEN 9
          WHEN 'ADMIN' THEN 10
          ELSE 20
        END,
        "updatedAt" DESC,
        "createdAt" DESC,
        "id"
    ) AS "keptUserId",
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "telephone"
      ORDER BY
        CASE "role"
          WHEN 'PARENT' THEN 1
          WHEN 'ELEVE' THEN 2
          WHEN 'SECURITE' THEN 3
          WHEN 'ENSEIGNANT' THEN 4
          WHEN 'CAISSIER' THEN 5
          WHEN 'COMPTABLE' THEN 6
          WHEN 'SURVEILLANT' THEN 7
          WHEN 'RH' THEN 8
          WHEN 'GESTIONNAIRE' THEN 9
          WHEN 'ADMIN' THEN 10
          ELSE 20
        END,
        "updatedAt" DESC,
        "createdAt" DESC,
        "id"
    ) AS "rank"
  FROM "User"
  WHERE "telephone" IS NOT NULL
)
INSERT INTO "UserPhoneDuplicateAudit" (
  "tenantId",
  "telephone",
  "keptUserId",
  "duplicateUserId",
  "duplicateRole"
)
SELECT
  "tenantId",
  "telephone",
  "keptUserId",
  "id",
  "role"
FROM ranked
WHERE "rank" > 1
ON CONFLICT ("tenantId", "telephone", "keptUserId", "duplicateUserId") DO NOTHING;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "telephone"
      ORDER BY
        CASE "role"
          WHEN 'PARENT' THEN 1
          WHEN 'ELEVE' THEN 2
          WHEN 'SECURITE' THEN 3
          WHEN 'ENSEIGNANT' THEN 4
          WHEN 'CAISSIER' THEN 5
          WHEN 'COMPTABLE' THEN 6
          WHEN 'SURVEILLANT' THEN 7
          WHEN 'RH' THEN 8
          WHEN 'GESTIONNAIRE' THEN 9
          WHEN 'ADMIN' THEN 10
          ELSE 20
        END,
        "updatedAt" DESC,
        "createdAt" DESC,
        "id"
    ) AS "rank"
  FROM "User"
  WHERE "telephone" IS NOT NULL
)
UPDATE "User" AS u
SET "telephone" = NULL
FROM ranked AS r
WHERE u."id" = r."id"
  AND r."rank" > 1;

CREATE UNIQUE INDEX "users_tenant_telephone_unique"
ON "User"("tenantId", "telephone");
