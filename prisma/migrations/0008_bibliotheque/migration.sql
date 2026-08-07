-- Bibliothèque : catalogue d'ouvrages et emprunts.

CREATE TYPE "TypeOuvrage" AS ENUM ('MANUEL', 'ROMAN', 'DICTIONNAIRE', 'ENCYCLOPEDIE', 'REVUE', 'MEMOIRE', 'AUTRE');
CREATE TYPE "StatutEmprunt" AS ENUM ('EN_COURS', 'RENDU', 'EN_RETARD', 'PERDU');

CREATE TABLE "Ouvrage" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"      UUID NOT NULL,
  "titre"         VARCHAR(250) NOT NULL,
  "auteur"        VARCHAR(200) NOT NULL,
  "type"          "TypeOuvrage" NOT NULL DEFAULT 'MANUEL',
  "isbn"          VARCHAR(30),
  "annee"         INTEGER,
  "editeur"       VARCHAR(150),
  "valeur"        DOUBLE PRECISION,
  "nbExemplaires" INTEGER NOT NULL DEFAULT 1,
  "nbDisponibles" INTEGER NOT NULL DEFAULT 1,
  "matiereId"     UUID,
  "niveauId"      UUID,
  "actif"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Ouvrage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE
);

CREATE INDEX "Ouvrage_tenantId_actif_idx" ON "Ouvrage"("tenantId", "actif");
CREATE INDEX "Ouvrage_tenantId_titre_idx" ON "Ouvrage"("tenantId", "titre");

CREATE TABLE "EmpruntOuvrage" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"         UUID NOT NULL,
  "ouvrageId"        UUID NOT NULL,
  "emprunteurId"     UUID NOT NULL,
  "typeEmprunteur"   VARCHAR(20) NOT NULL,
  "dateEmprunt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dureeJours"       INTEGER NOT NULL,
  "dateRetourPrevue" TIMESTAMP(3) NOT NULL,
  "dateRetourReelle" TIMESTAMP(3),
  "statut"           "StatutEmprunt" NOT NULL DEFAULT 'EN_COURS',
  "montantAmende"    DOUBLE PRECISION,
  "paiementId"       UUID,
  "observations"     TEXT,
  "enregistreParId"  UUID,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmpruntOuvrage_tenantId_fkey"     FOREIGN KEY ("tenantId")     REFERENCES "Tenant"("id")  ON DELETE CASCADE,
  CONSTRAINT "EmpruntOuvrage_ouvrageId_fkey"    FOREIGN KEY ("ouvrageId")    REFERENCES "Ouvrage"("id"),
  CONSTRAINT "EmpruntOuvrage_emprunteurId_fkey" FOREIGN KEY ("emprunteurId") REFERENCES "User"("id")
);

CREATE INDEX "EmpruntOuvrage_tenantId_statut_idx"       ON "EmpruntOuvrage"("tenantId", "statut");
CREATE INDEX "EmpruntOuvrage_tenantId_emprunteurId_idx" ON "EmpruntOuvrage"("tenantId", "emprunteurId");
CREATE INDEX "EmpruntOuvrage_ouvrageId_idx"             ON "EmpruntOuvrage"("ouvrageId");
