CREATE TABLE IF NOT EXISTS "PaiementProfesseur" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "enseignantId" UUID NOT NULL,
  "dateDebut" DATE NOT NULL,
  "dateFin" DATE NOT NULL,
  "heuresEffectuees" DOUBLE PRECISION NOT NULL,
  "heuresDeduites" DOUBLE PRECISION NOT NULL,
  "montant" DOUBLE PRECISION NOT NULL,
  "statut" "StatutPaiement" NOT NULL DEFAULT 'EN_ATTENTE',
  "reference" VARCHAR(80) NOT NULL,
  "initialisePar" UUID,
  "notificationId" UUID,
  "observations" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaiementProfesseur_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaiementProfesseur_reference_key"
  ON "PaiementProfesseur"("reference");

CREATE INDEX IF NOT EXISTS "PaiementProfesseur_tenantId_enseignantId_dateDebut_dateFin_idx"
  ON "PaiementProfesseur"("tenantId", "enseignantId", "dateDebut", "dateFin");

CREATE INDEX IF NOT EXISTS "PaiementProfesseur_tenantId_statut_idx"
  ON "PaiementProfesseur"("tenantId", "statut");

ALTER TABLE "PaiementProfesseur"
  ADD CONSTRAINT "PaiementProfesseur_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaiementProfesseur"
  ADD CONSTRAINT "PaiementProfesseur_enseignantId_fkey"
  FOREIGN KEY ("enseignantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaiementProfesseur"
  ADD CONSTRAINT "PaiementProfesseur_initialisePar_fkey"
  FOREIGN KEY ("initialisePar") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
