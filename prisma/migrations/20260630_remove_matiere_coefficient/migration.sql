-- Remove coefficient from Matiere (coefficient is per-class, stored in MatiereClasse)
ALTER TABLE "Matiere" DROP COLUMN IF EXISTS "coefficient";
