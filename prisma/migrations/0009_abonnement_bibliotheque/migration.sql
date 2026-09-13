-- Abonnement mensuel à la bibliothèque.
-- Un abonné emprunte sans payer à l'unité pendant la période couverte.

CREATE TABLE "AbonnementBibliotheque" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"      UUID NOT NULL,
  "abonneId"      UUID NOT NULL,
  "typeAbonne"    VARCHAR(20) NOT NULL,
  "dateDebut"     TIMESTAMP(3) NOT NULL,
  "dateFin"       TIMESTAMP(3) NOT NULL,
  "moisPayes"     INTEGER NOT NULL DEFAULT 1,
  "montant"       DOUBLE PRECISION NOT NULL,
  "paiementId"    UUID,
  "souscritParId" UUID,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AbonnementBibliotheque_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "AbonnementBibliotheque_abonneId_fkey" FOREIGN KEY ("abonneId") REFERENCES "User"("id")
);

CREATE INDEX "AbonnementBibliotheque_tenantId_abonneId_idx" ON "AbonnementBibliotheque"("tenantId", "abonneId");
CREATE INDEX "AbonnementBibliotheque_tenantId_dateFin_idx"  ON "AbonnementBibliotheque"("tenantId", "dateFin");

-- Frais d'emprunt sur l'emprunt lui-même : 0 pour un abonné, le tarif sinon.
ALTER TABLE "EmpruntOuvrage" ADD COLUMN "fraisEmprunt" DOUBLE PRECISION;
ALTER TABLE "EmpruntOuvrage" ADD COLUMN "paiementFraisId" UUID;
