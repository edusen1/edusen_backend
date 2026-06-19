CREATE TABLE IF NOT EXISTS "ProfesseurMatiere" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "professeurId" UUID NOT NULL,
  "matiereId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProfesseurMatiere_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProfesseurMatiere_professeurId_matiereId_key"
  ON "ProfesseurMatiere"("professeurId", "matiereId");

CREATE INDEX IF NOT EXISTS "ProfesseurMatiere_tenantId_matiereId_idx"
  ON "ProfesseurMatiere"("tenantId", "matiereId");

ALTER TABLE "ProfesseurMatiere"
  ADD CONSTRAINT "ProfesseurMatiere_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfesseurMatiere"
  ADD CONSTRAINT "ProfesseurMatiere_professeurId_fkey"
  FOREIGN KEY ("professeurId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProfesseurMatiere"
  ADD CONSTRAINT "ProfesseurMatiere_matiereId_fkey"
  FOREIGN KEY ("matiereId") REFERENCES "Matiere"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProfesseurMatiere" ("tenantId", "professeurId", "matiereId")
SELECT DISTINCT teacher."tenantId", teacher."id", subject."id"
FROM "User" AS teacher
CROSS JOIN LATERAL regexp_split_to_table(COALESCE(teacher."specialite", ''), E'\\s*,\\s*') AS legacy_specialite(value)
INNER JOIN "Matiere" AS subject
  ON subject."tenantId" = teacher."tenantId"
  AND (
    lower(subject."libelle") = lower(btrim(legacy_specialite.value))
    OR lower(subject."code") = lower(btrim(legacy_specialite.value))
  )
WHERE teacher."role" = 'ENSEIGNANT'
  AND btrim(legacy_specialite.value) <> ''
ON CONFLICT ("professeurId", "matiereId") DO NOTHING;
