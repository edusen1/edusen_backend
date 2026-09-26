ALTER TABLE "Classe" ADD COLUMN "serie" VARCHAR(20);

ALTER TABLE "MatiereNiveau" ADD COLUMN "serie" VARCHAR(20);

DROP INDEX IF EXISTS "MatiereNiveau_tenantId_niveauId_matiereId_key";

CREATE UNIQUE INDEX "MatiereNiveau_tenant_niveau_matiere_generic_key"
  ON "MatiereNiveau"("tenantId", "niveauId", "matiereId")
  WHERE "serie" IS NULL;

CREATE UNIQUE INDEX "MatiereNiveau_tenant_niveau_matiere_serie_key"
  ON "MatiereNiveau"("tenantId", "niveauId", "matiereId", "serie")
  WHERE "serie" IS NOT NULL;

CREATE INDEX "MatiereNiveau_tenantId_niveauId_matiereId_serie_idx"
  ON "MatiereNiveau"("tenantId", "niveauId", "matiereId", "serie");
