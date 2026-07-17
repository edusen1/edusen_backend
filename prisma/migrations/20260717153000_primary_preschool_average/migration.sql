UPDATE "Niveau" AS n
SET "moyennePassage" = 5,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Cycle" AS c
WHERE n."cycleId" = c."id"
  AND n."seeded" = true
  AND c."code" IN ('PRESCOLAIRE', 'PRIMAIRE')
  AND n."moyennePassage" <> 5;