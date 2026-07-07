DO $$
BEGIN
  ALTER TYPE "StatutInscription" ADD VALUE IF NOT EXISTS 'INACTIF';
END $$;

UPDATE "Inscription"
SET "statut" = 'INACTIF'::"StatutInscription"
WHERE "statut" = 'TERMINE';

UPDATE "Inscription" AS inscription
SET "statut" = 'INACTIF'::"StatutInscription"
FROM "AnneeAcademique" AS annee
WHERE inscription."tenantId" = annee."tenantId"
  AND annee."actif" = true
  AND inscription."statut" = 'ACTIF'
  AND inscription."anneeAcademiqueId" <> annee."id";
