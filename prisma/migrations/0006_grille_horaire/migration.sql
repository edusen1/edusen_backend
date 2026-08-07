-- Grille horaire par cycle, propre à chaque école.
-- Nullable : les écoles existantes basculent sur la grille par défaut du code
-- tant qu'elles n'ont rien paramétré, sans rupture de service.
ALTER TABLE "EcoleConfig" ADD COLUMN "grilleHoraire" JSONB;
