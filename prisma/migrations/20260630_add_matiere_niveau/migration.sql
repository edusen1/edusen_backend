-- CreateTable MatiereNiveau: matières assignées par niveau (sans dépendance aux classes)
CREATE TABLE "MatiereNiveau" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"           UUID NOT NULL,
  "niveauId"           UUID NOT NULL,
  "matiereId"          UUID NOT NULL,
  "coefficient"        DOUBLE PRECISION NOT NULL DEFAULT 1,
  "volumeHoraireHebdo" INTEGER,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MatiereNiveau_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatiereNiveau_tenantId_niveauId_matiereId_key" ON "MatiereNiveau"("tenantId", "niveauId", "matiereId");
CREATE INDEX "MatiereNiveau_tenantId_niveauId_idx" ON "MatiereNiveau"("tenantId", "niveauId");

ALTER TABLE "MatiereNiveau" ADD CONSTRAINT "MatiereNiveau_tenantId_fkey"   FOREIGN KEY ("tenantId")  REFERENCES "Tenant"("id")  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatiereNiveau" ADD CONSTRAINT "MatiereNiveau_niveauId_fkey"   FOREIGN KEY ("niveauId")  REFERENCES "Niveau"("id")  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatiereNiveau" ADD CONSTRAINT "MatiereNiveau_matiereId_fkey"  FOREIGN KEY ("matiereId") REFERENCES "Matiere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
