-- Add professeurResponsableId to Classe
ALTER TABLE "Classe" ADD COLUMN "professeurResponsableId" UUID;
ALTER TABLE "Classe" ADD CONSTRAINT "Classe_professeurResponsableId_fkey"
  FOREIGN KEY ("professeurResponsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create classe_stagiaires table
CREATE TABLE "classe_stagiaires" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"    UUID        NOT NULL,
  "classeId"    UUID        NOT NULL,
  "stagiaireId" UUID        NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "classe_stagiaires_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "classe_stagiaires"
  ADD CONSTRAINT "classe_stagiaires_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "classe_stagiaires"
  ADD CONSTRAINT "classe_stagiaires_classeId_fkey"
  FOREIGN KEY ("classeId") REFERENCES "Classe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "classe_stagiaires"
  ADD CONSTRAINT "classe_stagiaires_stagiaireId_fkey"
  FOREIGN KEY ("stagiaireId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "classe_stagiaires_classeId_stagiaireId_key"
  ON "classe_stagiaires"("classeId", "stagiaireId");
