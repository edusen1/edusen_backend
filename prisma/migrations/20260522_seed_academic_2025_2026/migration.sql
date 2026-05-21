-- Seed academique 2025-2026 applique au deploiement.
-- Migration idempotente: peut etre rejouee sans creer de doublons fonctionnels.

DO $$
DECLARE
  t RECORD;
  section RECORD;
  niv RECORD;
  cls RECORD;
  annee_id UUID;
  cycle_id UUID;
  niveau_id UUID;
  classe_id UUID;
  matiere_fr_id UUID;
  matiere_math_id UUID;
  titulaire_ci_id UUID;
  stagiaire_ci_id UUID;
  titulaire_cp_id UUID;
  stagiaire_cp_id UUID;
  admin_id UUID;
  eleve RECORD;
  matiere RECORD;
  periode TEXT;
  base_note DOUBLE PRECISION;
BEGIN
  FOR t IN SELECT "id" FROM "Tenant" WHERE "actif" = true LOOP
    -- Année académique 2025-2026.
    INSERT INTO "AnneeAcademique" (
      "id", "tenantId", "libelle", "dateDebut", "dateFin", "estCourante", "actif", "createdAt", "updatedAt", "classesDupliquees"
    )
    VALUES (
      gen_random_uuid(), t."id", '2025-2026', DATE '2025-10-01', DATE '2026-07-31', false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true
    )
    ON CONFLICT ("tenantId", "libelle") DO UPDATE SET
      "dateDebut" = EXCLUDED."dateDebut",
      "dateFin" = EXCLUDED."dateFin",
      "actif" = false,
      "updatedAt" = CURRENT_TIMESTAMP;

    SELECT "id" INTO annee_id
    FROM "AnneeAcademique"
    WHERE "tenantId" = t."id" AND "libelle" = '2025-2026';

    -- Sections et niveaux par défaut.
    FOR section IN
      SELECT * FROM (VALUES
        ('MATERNELLE', 'Maternelle'),
        ('PRIMAIRE', 'Primaire'),
        ('COLLEGE', 'Collège'),
        ('LYCEE', 'Lycée')
      ) AS s(code, nom)
    LOOP
      INSERT INTO "Cycle" ("id", "tenantId", "code", "libelle", "actif", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), t."id", section.code, section.nom, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("tenantId", "code") DO UPDATE SET
        "libelle" = EXCLUDED."libelle",
        "actif" = true,
        "updatedAt" = CURRENT_TIMESTAMP;
    END LOOP;

    FOR niv IN
      SELECT * FROM (VALUES
        ('PS', 'Petite Section', 'MATERNELLE', 1),
        ('MS', 'Moyenne Section', 'MATERNELLE', 2),
        ('GS', 'Grande Section', 'MATERNELLE', 3),
        ('CI', 'CI', 'PRIMAIRE', 10),
        ('CP', 'CP', 'PRIMAIRE', 11),
        ('CE1', 'CE1', 'PRIMAIRE', 12),
        ('CE2', 'CE2', 'PRIMAIRE', 13),
        ('CM1', 'CM1', 'PRIMAIRE', 14),
        ('CM2', 'CM2', 'PRIMAIRE', 15),
        ('6E', '6ème', 'COLLEGE', 20),
        ('5E', '5ème', 'COLLEGE', 21),
        ('4E', '4ème', 'COLLEGE', 22),
        ('3E', '3ème', 'COLLEGE', 23),
        ('2NDE', 'Seconde', 'LYCEE', 30),
        ('1ERE', 'Première', 'LYCEE', 31),
        ('TLE', 'Terminale', 'LYCEE', 32)
      ) AS n(code, nom, cycle_code, ordre)
    LOOP
      SELECT "id" INTO cycle_id FROM "Cycle" WHERE "tenantId" = t."id" AND "code" = niv.cycle_code;

      INSERT INTO "Niveau" (
        "id", "tenantId", "cycleId", "code", "libelle", "ordre", "moyennePassage", "actif", "createdAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid(), t."id", cycle_id, niv.code, niv.nom, niv.ordre, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId", "code") DO UPDATE SET
        "cycleId" = EXCLUDED."cycleId",
        "libelle" = EXCLUDED."libelle",
        "ordre" = EXCLUDED."ordre",
        "actif" = true,
        "updatedAt" = CURRENT_TIMESTAMP;
    END LOOP;

    -- Classes 2025-2026.
    FOR cls IN
      SELECT * FROM (VALUES
        ('Petite Section A', 'PS', 30),
        ('Moyenne Section A', 'MS', 30),
        ('Grande Section A', 'GS', 30),
        ('CI A', 'CI', 40),
        ('CP A', 'CP', 35),
        ('CE1 A', 'CE1', 35),
        ('CE2 A', 'CE2', 35),
        ('CM1 A', 'CM1', 35),
        ('CM2 A', 'CM2', 35),
        ('6ème A', '6E', 45),
        ('5ème A', '5E', 45),
        ('4ème A', '4E', 45),
        ('3ème A', '3E', 45),
        ('Seconde A', '2NDE', 45),
        ('Première A', '1ERE', 45),
        ('Terminale A', 'TLE', 45)
      ) AS c(nom, niveau_code, effectif_max)
    LOOP
      SELECT "id" INTO niveau_id FROM "Niveau" WHERE "tenantId" = t."id" AND "code" = cls.niveau_code;

      INSERT INTO "Classe" (
        "id", "tenantId", "nom", "niveauId", "anneeAcademiqueId", "effectifMax", "actif", "createdAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid(), t."id", cls.nom, niveau_id, annee_id, cls.effectif_max, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId", "nom", "anneeAcademiqueId") DO UPDATE SET
        "niveauId" = EXCLUDED."niveauId",
        "effectifMax" = EXCLUDED."effectifMax",
        "actif" = false,
        "updatedAt" = CURRENT_TIMESTAMP;
    END LOOP;

    -- Matières minimales pour notes et bulletins.
    INSERT INTO "Matiere" ("id", "tenantId", "code", "libelle", "coefficient", "description", "actif", "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid(), t."id", 'FR', 'Francais', 2, 'Langue francaise', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      (gen_random_uuid(), t."id", 'MATH', 'Mathematiques', 3, 'Arithmetique et calcul', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("tenantId", "code") DO UPDATE SET
      "libelle" = EXCLUDED."libelle",
      "coefficient" = EXCLUDED."coefficient",
      "description" = EXCLUDED."description",
      "actif" = true,
      "updatedAt" = CURRENT_TIMESTAMP;

    SELECT "id" INTO matiere_fr_id FROM "Matiere" WHERE "tenantId" = t."id" AND "code" = 'FR';
    SELECT "id" INTO matiere_math_id FROM "Matiere" WHERE "tenantId" = t."id" AND "code" = 'MATH';
    SELECT "id" INTO admin_id
    FROM "User"
    WHERE "tenantId" = t."id" AND "role" IN ('ADMIN', 'SURVEILLANT', 'RH') AND "actif" = true
    ORDER BY "createdAt"
    LIMIT 1;

    -- Profs existants: priorité aux comptes démo, fallback sur les deux premiers enseignants actifs.
    SELECT "id" INTO titulaire_ci_id
    FROM "User"
    WHERE "tenantId" = t."id" AND "role" = 'ENSEIGNANT' AND "actif" = true
    ORDER BY CASE WHEN "email" = 'ousmane.diouf@demo.noura.sn' THEN 0 ELSE 1 END, "createdAt"
    LIMIT 1;

    SELECT "id" INTO stagiaire_ci_id
    FROM "User"
    WHERE "tenantId" = t."id" AND "role" = 'ENSEIGNANT' AND "actif" = true AND "id" IS DISTINCT FROM titulaire_ci_id
    ORDER BY CASE WHEN "email" = 'adja.sarr@demo.noura.sn' THEN 0 ELSE 1 END, "createdAt"
    LIMIT 1;

    titulaire_cp_id := COALESCE(stagiaire_ci_id, titulaire_ci_id);
    stagiaire_cp_id := CASE WHEN titulaire_ci_id IS DISTINCT FROM titulaire_cp_id THEN titulaire_ci_id ELSE NULL END;

    -- Titulaires et stagiaires CI A / CP A.
    SELECT "id" INTO classe_id FROM "Classe" WHERE "tenantId" = t."id" AND "anneeAcademiqueId" = annee_id AND "nom" = 'CI A';
    IF classe_id IS NOT NULL AND titulaire_ci_id IS NOT NULL THEN
      UPDATE "Classe" SET "professeurResponsableId" = titulaire_ci_id, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = classe_id;

      INSERT INTO "Cours" ("id", "tenantId", "matiereId", "classeId", "enseignantId", "anneeAcademiqueId", "volumeHoraireHebdo", "coefficient", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), t."id", matiere_math_id, classe_id, titulaire_ci_id, annee_id, 4, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (gen_random_uuid(), t."id", matiere_fr_id, classe_id, COALESCE(stagiaire_ci_id, titulaire_ci_id), annee_id, 5, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("matiereId", "enseignantId", "classeId", "anneeAcademiqueId") DO UPDATE SET
        "volumeHoraireHebdo" = EXCLUDED."volumeHoraireHebdo",
        "coefficient" = EXCLUDED."coefficient",
        "updatedAt" = CURRENT_TIMESTAMP;

      INSERT INTO "MatiereClasse" ("id", "tenantId", "matiereId", "classeId", "enseignantId", "anneeAcademiqueId", "anneeScolaire", "volumeHoraire", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), t."id", matiere_math_id, classe_id, titulaire_ci_id, annee_id, '2025-2026', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (gen_random_uuid(), t."id", matiere_fr_id, classe_id, COALESCE(stagiaire_ci_id, titulaire_ci_id), annee_id, '2025-2026', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("matiereId", "classeId", "enseignantId", "anneeAcademiqueId") DO UPDATE SET
        "anneeScolaire" = EXCLUDED."anneeScolaire",
        "volumeHoraire" = EXCLUDED."volumeHoraire",
        "updatedAt" = CURRENT_TIMESTAMP;

      IF stagiaire_ci_id IS NOT NULL THEN
        INSERT INTO "classe_stagiaires" ("id", "tenantId", "classeId", "stagiaireId", "createdAt")
        VALUES (gen_random_uuid(), t."id", classe_id, stagiaire_ci_id, CURRENT_TIMESTAMP)
        ON CONFLICT ("classeId", "stagiaireId") DO UPDATE SET "tenantId" = EXCLUDED."tenantId";
      END IF;
    END IF;

    SELECT "id" INTO classe_id FROM "Classe" WHERE "tenantId" = t."id" AND "anneeAcademiqueId" = annee_id AND "nom" = 'CP A';
    IF classe_id IS NOT NULL AND titulaire_cp_id IS NOT NULL THEN
      UPDATE "Classe" SET "professeurResponsableId" = titulaire_cp_id, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = classe_id;

      IF stagiaire_cp_id IS NOT NULL THEN
        INSERT INTO "classe_stagiaires" ("id", "tenantId", "classeId", "stagiaireId", "createdAt")
        VALUES (gen_random_uuid(), t."id", classe_id, stagiaire_cp_id, CURRENT_TIMESTAMP)
        ON CONFLICT ("classeId", "stagiaireId") DO UPDATE SET "tenantId" = EXCLUDED."tenantId";
      END IF;
    END IF;

    -- Inscriptions 2025-2026 pour les eleves deja rattaches aux classes CI A / CP A.
    FOR eleve IN
      SELECT u."id" AS "eleveId", c."id" AS "classeId"
      FROM "User" u
      JOIN "Classe" c ON c."id" = u."classeId"
      WHERE u."tenantId" = t."id"
        AND u."role" = 'ELEVE'
        AND c."tenantId" = t."id"
        AND c."anneeAcademiqueId" = annee_id
        AND c."nom" IN ('CI A', 'CP A')
    LOOP
      INSERT INTO "Inscription" (
        "id", "tenantId", "numeroInscription", "eleveId", "classeId", "anneeAcademiqueId", "statut", "creePar", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        t."id",
        'INS-2025-2026-' || upper(substr(eleve."eleveId"::text, 1, 8)),
        eleve."eleveId",
        eleve."classeId",
        annee_id,
        'ACTIF',
        COALESCE(admin_id, '00000000-0000-0000-0000-000000000000'::uuid),
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1
        FROM "Inscription" i
        WHERE i."tenantId" = t."id"
          AND i."eleveId" = eleve."eleveId"
          AND i."anneeAcademiqueId" = annee_id
      );
    END LOOP;

    -- Notes de demonstration pour les eleves inscrits dans CI A / CP A.

    FOR eleve IN
      SELECT i."eleveId", i."classeId", c."nom" AS classe_nom
      FROM "Inscription" i
      JOIN "Classe" c ON c."id" = i."classeId"
      WHERE i."tenantId" = t."id"
        AND i."anneeAcademiqueId" = annee_id
        AND i."statut" = 'ACTIF'
        AND c."nom" IN ('CI A', 'CP A')
    LOOP
      FOREACH periode IN ARRAY ARRAY['SEMESTRE_1', 'SEMESTRE_2', 'SEMESTRE_3'] LOOP
        FOR matiere IN
          SELECT matiere_math_id AS id, 14.0 AS base
          UNION ALL
          SELECT matiere_fr_id AS id, 13.0 AS base
        LOOP
          base_note := matiere.base + CASE periode WHEN 'SEMESTRE_1' THEN 0 WHEN 'SEMESTRE_2' THEN 1 ELSE 2 END;

          INSERT INTO "Note" ("id", "tenantId", "eleveId", "matiereId", "typeEvaluation", "note", "noteSur", "trimestre", "anneeScolaire", "dateEvaluation", "commentaire", "createdAt", "updatedAt")
          SELECT gen_random_uuid(), t."id", eleve."eleveId", matiere.id, 'DEVOIR', LEAST(20, base_note), 20, periode, '2025-2026', DATE '2026-01-15', 'Devoir 1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM "Note" n WHERE n."tenantId" = t."id" AND n."eleveId" = eleve."eleveId" AND n."matiereId" = matiere.id AND n."trimestre" = periode AND n."anneeScolaire" = '2025-2026' AND n."typeEvaluation" = 'DEVOIR' AND n."commentaire" = 'Devoir 1'
          );

          INSERT INTO "Note" ("id", "tenantId", "eleveId", "matiereId", "typeEvaluation", "note", "noteSur", "trimestre", "anneeScolaire", "dateEvaluation", "commentaire", "createdAt", "updatedAt")
          SELECT gen_random_uuid(), t."id", eleve."eleveId", matiere.id, 'DEVOIR', LEAST(20, base_note + 1), 20, periode, '2025-2026', DATE '2026-02-15', 'Devoir 2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM "Note" n WHERE n."tenantId" = t."id" AND n."eleveId" = eleve."eleveId" AND n."matiereId" = matiere.id AND n."trimestre" = periode AND n."anneeScolaire" = '2025-2026' AND n."typeEvaluation" = 'DEVOIR' AND n."commentaire" = 'Devoir 2'
          );

          INSERT INTO "Note" ("id", "tenantId", "eleveId", "matiereId", "typeEvaluation", "note", "noteSur", "trimestre", "anneeScolaire", "dateEvaluation", "commentaire", "createdAt", "updatedAt")
          SELECT gen_random_uuid(), t."id", eleve."eleveId", matiere.id, 'COMPOSITION', LEAST(20, base_note + 2), 20, periode, '2025-2026', DATE '2026-03-15', 'Composition', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          WHERE NOT EXISTS (
            SELECT 1 FROM "Note" n WHERE n."tenantId" = t."id" AND n."eleveId" = eleve."eleveId" AND n."matiereId" = matiere.id AND n."trimestre" = periode AND n."anneeScolaire" = '2025-2026' AND n."typeEvaluation" = 'COMPOSITION' AND n."commentaire" = 'Composition'
          );
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
