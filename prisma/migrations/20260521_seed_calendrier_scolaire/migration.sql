ALTER TABLE "CalendrierScolaire" ADD COLUMN IF NOT EXISTS "sectionId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CalendrierScolaire_sectionId_fkey'
  ) THEN
    ALTER TABLE "CalendrierScolaire"
      ADD CONSTRAINT "CalendrierScolaire_sectionId_fkey"
      FOREIGN KEY ("sectionId") REFERENCES "Cycle"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CalendrierScolaire_tenantId_sectionId_dateDebut_idx"
  ON "CalendrierScolaire"("tenantId", "sectionId", "dateDebut");

WITH events("sectionCode", "titre", "description", "dateDebut", "dateFin", "type") AS (
  VALUES
    (NULL, 'Rentrée des enseignants', 'Préparation pédagogique, réunions de rentrée et organisation des classes.', DATE '2025-09-29', NULL::date, 'RENTREE'),
    (NULL, 'Rentrée des élèves', 'Accueil général des élèves et démarrage des cours.', DATE '2025-10-06', NULL::date, 'RENTREE'),
    (NULL, 'Vacances de Noël', 'Départ en vacances après les cours, reprise le matin du jour indiqué.', DATE '2025-12-24', DATE '2026-01-05', 'VACANCES'),
    (NULL, 'Journée sans école - Lundi de Pentecôte', 'Journée sans école prévue comme journée de solidarité dans le calendrier national.', DATE '2026-05-25', NULL::date, 'FERIE'),
    (NULL, 'Assemblée générale FOSCO', 'Lancement des activités sociales, culturelles, sportives et éducatives du foyer scolaire.', DATE '2026-02-14', NULL::date, 'ACTIVITE_FOSCO'),
    (NULL, 'Semaine culturelle et sportive', 'Activités FOSCO, clubs, génie en herbe, théâtre, sport et valorisation des talents.', DATE '2026-04-20', DATE '2026-04-25', 'ACTIVITE_FOSCO'),
    (NULL, 'Clôture administrative de l’année', 'Finalisation des dossiers, archives, bilans pédagogiques et préparation de l’année suivante.', DATE '2026-07-31', NULL::date, 'AUTRE'),
    ('MATERNELLE', 'Activités d’éveil et fête de la petite enfance', 'Activités périscolaires adaptées à la maternelle : chants, dessins, motricité et exposition.', DATE '2026-03-18', NULL::date, 'ACTIVITE_PERISCOLAIRE'),
    ('PRIMAIRE', 'Compositions du 1er semestre - Primaire', 'Période de compositions du primaire et organisation des corrections.', DATE '2026-01-20', DATE '2026-02-06', 'COMPOSITION'),
    ('PRIMAIRE', 'Remise des bulletins - Primaire', 'Communication des résultats aux familles après les compositions.', DATE '2026-03-28', NULL::date, 'REMISE_BULLETINS'),
    ('PRIMAIRE', 'CFEE et entrée en 6ème - préparation', 'Révisions dirigées, encadrement des candidats et organisation administrative.', DATE '2026-05-18', DATE '2026-06-12', 'EXAMEN'),
    ('COLLEGE', 'Compositions du 1er semestre - Collège', 'Fenêtre des compositions, avec priorité d’organisation pour les classes d’examen.', DATE '2026-01-20', DATE '2026-02-20', 'COMPOSITION'),
    ('COLLEGE', 'Conseils de classe - Collège', 'Bilan du travail et de la vie des classes, appréciations et décisions pédagogiques.', DATE '2026-03-16', DATE '2026-03-21', 'CONSEIL_CLASSE'),
    ('COLLEGE', 'BFEM - préparation', 'Révisions, examens blancs et suivi des classes de troisième.', DATE '2026-05-25', DATE '2026-06-19', 'EXAMEN'),
    ('LYCEE', 'Compositions du 1er semestre - Lycée', 'Compositions du lycée, transmission des notes et préparation des conseils.', DATE '2026-01-20', DATE '2026-02-20', 'COMPOSITION'),
    ('LYCEE', 'Conseils de classe - Lycée', 'Bilan pédagogique, orientation et suivi des classes de première et terminale.', DATE '2026-03-16', DATE '2026-03-21', 'CONSEIL_CLASSE'),
    ('LYCEE', 'Baccalauréat - préparation', 'Révisions, examens blancs et encadrement des candidats au baccalauréat.', DATE '2026-05-25', DATE '2026-06-26', 'EXAMEN')
),
resolved_events AS (
  SELECT
    t.id AS "tenantId",
    c.id AS "sectionId",
    e."titre",
    e."description",
    e."dateDebut",
    e."dateFin",
    e."type"
  FROM "Tenant" t
  CROSS JOIN events e
  LEFT JOIN "Cycle" c
    ON c."tenantId" = t.id
    AND c."code" = e."sectionCode"
  WHERE e."sectionCode" IS NULL OR c.id IS NOT NULL
)
INSERT INTO "CalendrierScolaire" (
  "id",
  "tenantId",
  "sectionId",
  "titre",
  "description",
  "dateDebut",
  "dateFin",
  "type",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(
    r."tenantId"::text || ':' ||
    COALESCE(r."sectionId"::text, 'GLOBAL') || ':' ||
    r."titre" || ':' ||
    r."dateDebut"::text
  )::uuid,
  r."tenantId",
  r."sectionId",
  r."titre",
  r."description",
  r."dateDebut",
  r."dateFin",
  r."type",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM resolved_events r
WHERE NOT EXISTS (
  SELECT 1
  FROM "CalendrierScolaire" existing
  WHERE existing."tenantId" = r."tenantId"
    AND COALESCE(existing."sectionId"::text, 'GLOBAL') = COALESCE(r."sectionId"::text, 'GLOBAL')
    AND existing."titre" = r."titre"
    AND existing."dateDebut" = r."dateDebut"
);
