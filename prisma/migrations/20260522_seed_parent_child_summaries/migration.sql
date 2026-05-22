-- Donnees de demonstration pour enrichir les cartes "eleves sous tutelle".
-- Cree des bulletins/appreciations et quelques absences/retards a partir des notes existantes.

DO $$
DECLARE
  t RECORD;
  eleve RECORD;
  periode TEXT;
  avg_note DOUBLE PRECISION;
  bulletin_moyenne DOUBLE PRECISION;
  appreciation_text TEXT;
BEGIN
  FOR t IN SELECT "id" FROM "Tenant" WHERE "actif" = true LOOP
    FOR eleve IN
      SELECT DISTINCT i."eleveId", i."classeId", aa."libelle" AS "anneeScolaire"
      FROM "Inscription" i
      JOIN "AnneeAcademique" aa ON aa."id" = i."anneeAcademiqueId"
      WHERE i."tenantId" = t."id"
        AND i."statut" = 'ACTIF'
        AND EXISTS (SELECT 1 FROM "EleveParent" ep WHERE ep."eleveId" = i."eleveId")
    LOOP
      FOREACH periode IN ARRAY ARRAY['SEMESTRE_1', 'SEMESTRE_2', 'SEMESTRE_3'] LOOP
        SELECT AVG(("note" / NULLIF("noteSur", 0)) * 20)
        INTO avg_note
        FROM "Note"
        WHERE "tenantId" = t."id"
          AND "eleveId" = eleve."eleveId"
          AND "trimestre" = periode
          AND "anneeScolaire" = eleve."anneeScolaire";

        IF avg_note IS NOT NULL THEN
          bulletin_moyenne := ROUND(avg_note::numeric, 2)::double precision;
          appreciation_text := CASE
            WHEN bulletin_moyenne >= 16 THEN 'Très bon travail et comportement exemplaire.'
            WHEN bulletin_moyenne >= 14 THEN 'Bon travail, élève sérieux et régulier.'
            WHEN bulletin_moyenne >= 12 THEN 'Assez bon ensemble, poursuivre les efforts.'
            WHEN bulletin_moyenne >= 10 THEN 'Résultats passables, attention et régularité à renforcer.'
            ELSE 'Résultats insuffisants, comportement et travail à surveiller.'
          END;

          INSERT INTO "Bulletin" (
            "id", "tenantId", "eleveId", "classeId", "trimestre", "anneeScolaire",
            "moyenne", "moyenneClasse", "rang", "totalEleves", "appreciation",
            "nombreAbsences", "nombreRetards", "statut", "createdAt", "updatedAt"
          )
          VALUES (
            gen_random_uuid(), t."id", eleve."eleveId", eleve."classeId", periode, eleve."anneeScolaire",
            bulletin_moyenne, 12.5, 1, 30, appreciation_text,
            CASE WHEN bulletin_moyenne >= 12 THEN 1 ELSE 4 END,
            CASE WHEN bulletin_moyenne >= 12 THEN 1 ELSE 3 END,
            'PUBLIE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          ON CONFLICT ("eleveId", "classeId", "trimestre", "anneeScolaire") DO UPDATE SET
            "moyenne" = EXCLUDED."moyenne",
            "moyenneClasse" = EXCLUDED."moyenneClasse",
            "appreciation" = EXCLUDED."appreciation",
            "nombreAbsences" = EXCLUDED."nombreAbsences",
            "nombreRetards" = EXCLUDED."nombreRetards",
            "statut" = 'PUBLIE',
            "updatedAt" = CURRENT_TIMESTAMP;
        END IF;
      END LOOP;

      INSERT INTO "AbsenceEleve" (
        "id", "tenantId", "eleveId", "classeId", "date", "typeAbsence", "justifiee", "motif", "statut", "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid(), t."id", eleve."eleveId", eleve."classeId", DATE '2026-02-05', 'ABSENT', true, 'Absence justifiée', 'APPROUVEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1 FROM "AbsenceEleve" a
        WHERE a."tenantId" = t."id"
          AND a."eleveId" = eleve."eleveId"
          AND a."classeId" = eleve."classeId"
          AND a."date" = DATE '2026-02-05'
          AND a."typeAbsence" = 'ABSENT'
      );

      INSERT INTO "AbsenceEleve" (
        "id", "tenantId", "eleveId", "classeId", "date", "typeAbsence", "justifiee", "motif", "statut", "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid(), t."id", eleve."eleveId", eleve."classeId", DATE '2026-03-12', 'RETARD', false, 'Retard en classe', 'APPROUVEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1 FROM "AbsenceEleve" a
        WHERE a."tenantId" = t."id"
          AND a."eleveId" = eleve."eleveId"
          AND a."classeId" = eleve."classeId"
          AND a."date" = DATE '2026-03-12'
          AND a."typeAbsence" = 'RETARD'
      );
    END LOOP;
  END LOOP;
END $$;
