DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Inscription"
    GROUP BY "tenantId", "eleveId", "anneeAcademiqueId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Doublons d inscriptions detectes: un eleve ne peut avoir qu une inscription par annee scolaire';
  END IF;
END $$;

CREATE UNIQUE INDEX "inscriptions_tenant_eleve_annee_unique"
ON "Inscription" ("tenantId", "eleveId", "anneeAcademiqueId");
