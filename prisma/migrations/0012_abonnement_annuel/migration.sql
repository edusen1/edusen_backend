-- Migration: 0012_abonnement_annuel
-- Ajout du type d'abonnement bibliothèque (MENSUEL / ANNUEL)

ALTER TABLE "AbonnementBibliotheque"
  ADD COLUMN "typeAbonnement" VARCHAR(10) NOT NULL DEFAULT 'MENSUEL';
