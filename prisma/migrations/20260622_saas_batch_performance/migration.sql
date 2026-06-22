-- Batch paths used by bulletin generation and monthly payment scheduling.
CREATE INDEX IF NOT EXISTS "inscriptions_bulletin_batch_idx"
ON "Inscription" ("tenantId", "classeId", "statut", "anneeAcademiqueId");

CREATE INDEX IF NOT EXISTS "notes_bulletin_batch_idx"
ON "Note" ("tenantId", "eleveId", "trimestre", "anneeScolaire");

CREATE INDEX IF NOT EXISTS "bulletins_class_period_idx"
ON "Bulletin" ("tenantId", "classeId", "trimestre", "anneeScolaire");

CREATE INDEX IF NOT EXISTS "absences_eleves_bulletin_batch_idx"
ON "AbsenceEleve" ("tenantId", "eleveId");

CREATE INDEX IF NOT EXISTS "paiements_mensualites_batch_idx"
ON "Paiement" ("eleveId", "typePaiement", "anneeScolaire", "trimestre");
