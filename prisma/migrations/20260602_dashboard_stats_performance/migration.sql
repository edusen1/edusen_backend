CREATE INDEX IF NOT EXISTS "inscriptions_tenantId_statut_idx"
ON "Inscription" ("tenantId", "statut");

CREATE INDEX IF NOT EXISTS "notes_tenantId_idx"
ON "Note" ("tenantId");

CREATE INDEX IF NOT EXISTS "bulletins_tenantId_statut_idx"
ON "Bulletin" ("tenantId", "statut");

CREATE INDEX IF NOT EXISTS "absences_eleves_tenantId_statut_createdAt_idx"
ON "AbsenceEleve" ("tenantId", "statut", "createdAt");

CREATE INDEX IF NOT EXISTS "absences_eleves_tenantId_typeAbsence_idx"
ON "AbsenceEleve" ("tenantId", "typeAbsence");

CREATE INDEX IF NOT EXISTS "convocations_tenantId_statut_idx"
ON "Convocation" ("tenantId", "statut");

CREATE INDEX IF NOT EXISTS "notifications_tenantId_destinataireId_lu_createdAt_idx"
ON "Notification" ("tenantId", "destinataireId", "lu", "createdAt");

CREATE INDEX IF NOT EXISTS "paiements_tenantId_statut_createdAt_idx"
ON "Paiement" ("tenantId", "statut", "createdAt");
