CREATE INDEX IF NOT EXISTS "bulletins_student_visibility_idx"
ON "Bulletin" ("tenantId", "eleveId", "statut", "anneeScolaire");
