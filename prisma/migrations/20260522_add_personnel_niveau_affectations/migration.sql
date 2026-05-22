-- Affectations du personnel de surveillance par niveau.
CREATE TABLE IF NOT EXISTS "PersonnelNiveauAffectation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "personnelId" UUID NOT NULL,
    "niveauId" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonnelNiveauAffectation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PersonnelNiveauAffectation_personnelId_niveauId_type_key"
ON "PersonnelNiveauAffectation"("personnelId", "niveauId", "type");

CREATE UNIQUE INDEX IF NOT EXISTS "PersonnelNiveauAffectation_niveauId_type_ordre_key"
ON "PersonnelNiveauAffectation"("niveauId", "type", "ordre");

CREATE INDEX IF NOT EXISTS "PersonnelNiveauAffectation_tenantId_niveauId_type_idx"
ON "PersonnelNiveauAffectation"("tenantId", "niveauId", "type");

CREATE UNIQUE INDEX IF NOT EXISTS "PersonnelNiveauAffectation_one_surveillant_per_niveau"
ON "PersonnelNiveauAffectation"("niveauId")
WHERE "type" = 'SURVEILLANT';

ALTER TABLE "PersonnelNiveauAffectation"
ADD CONSTRAINT "PersonnelNiveauAffectation_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PersonnelNiveauAffectation"
ADD CONSTRAINT "PersonnelNiveauAffectation_personnelId_fkey"
FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonnelNiveauAffectation"
ADD CONSTRAINT "PersonnelNiveauAffectation_niveauId_fkey"
FOREIGN KEY ("niveauId") REFERENCES "Niveau"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
