-- Tarifs de la bibliothèque (caution, pénalité de retard, durée d'emprunt).
-- Nullable : les écoles sans bibliothèque payante ne sont pas impactées.
ALTER TABLE "EcoleConfig" ADD COLUMN "tarifsBibliotheque" JSONB;
