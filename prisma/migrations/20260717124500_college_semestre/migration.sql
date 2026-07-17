-- Le cycle Collège utilise deux semestres, comme le Lycée.
-- Limité aux cycles système pour préserver les cycles personnalisés.
UPDATE "Cycle"
SET "typePeriode" = 'SEMESTRE',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'COLLEGE'
  AND "seeded" = true
  AND "typePeriode" <> 'SEMESTRE';