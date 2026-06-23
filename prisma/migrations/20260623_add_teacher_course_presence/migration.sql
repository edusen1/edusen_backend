CREATE TABLE IF NOT EXISTS "PresenceCoursProfesseur" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "coursId" UUID NOT NULL,
  "emploiDuTempsId" UUID,
  "classeId" UUID NOT NULL,
  "enseignantId" UUID NOT NULL,
  "dateCours" DATE NOT NULL,
  "heureDebut" VARCHAR(10) NOT NULL,
  "heureFin" VARCHAR(10) NOT NULL,
  "statut" "StatutPresence" NOT NULL,
  "minutesPlanifiees" INTEGER NOT NULL,
  "minutesComptabilisees" INTEGER NOT NULL,
  "montantHoraire" DOUBLE PRECISION NOT NULL,
  "salaireCalcule" DOUBLE PRECISION NOT NULL,
  "controlePar" UUID NOT NULL,
  "observations" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PresenceCoursProfesseur_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PresenceCoursProfesseur_tenantId_emploiDuTempsId_dateCours_key"
  ON "PresenceCoursProfesseur"("tenantId", "emploiDuTempsId", "dateCours");

CREATE INDEX IF NOT EXISTS "PresenceCoursProfesseur_tenantId_dateCours_idx"
  ON "PresenceCoursProfesseur"("tenantId", "dateCours");

CREATE INDEX IF NOT EXISTS "PresenceCoursProfesseur_tenantId_enseignantId_dateCours_idx"
  ON "PresenceCoursProfesseur"("tenantId", "enseignantId", "dateCours");

ALTER TABLE "PresenceCoursProfesseur"
  ADD CONSTRAINT "PresenceCoursProfesseur_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PresenceCoursProfesseur"
  ADD CONSTRAINT "PresenceCoursProfesseur_coursId_fkey"
  FOREIGN KEY ("coursId") REFERENCES "Cours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PresenceCoursProfesseur"
  ADD CONSTRAINT "PresenceCoursProfesseur_emploiDuTempsId_fkey"
  FOREIGN KEY ("emploiDuTempsId") REFERENCES "EmploiDuTemps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PresenceCoursProfesseur"
  ADD CONSTRAINT "PresenceCoursProfesseur_enseignantId_fkey"
  FOREIGN KEY ("enseignantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PresenceCoursProfesseur"
  ADD CONSTRAINT "PresenceCoursProfesseur_controlePar_fkey"
  FOREIGN KEY ("controlePar") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
