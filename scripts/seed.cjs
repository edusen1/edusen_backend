#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const prisma = new PrismaClient();

const PASSWORD = process.env.SEED_PASSWORD || 'Noura@2026!';
const TENANT_SLUG = 'ecole-noura-dakar';
const SCHOOL_YEAR = '2025-2026';
const CURRENT_YEAR_START = new Date('2025-10-01');
const CURRENT_YEAR_END = new Date('2026-07-31');
const DEFAULT_STRUCTURE = [
  {
    code: 'MATERNELLE',
    nom: 'Maternelle',
    niveaux: [
      { code: 'PS', nom: 'Petite Section', ordre: 1 },
      { code: 'MS', nom: 'Moyenne Section', ordre: 2 },
      { code: 'GS', nom: 'Grande Section', ordre: 3 },
    ],
  },
  {
    code: 'PRIMAIRE',
    nom: 'Primaire',
    niveaux: [
      { code: 'CI', nom: 'CI', ordre: 10 },
      { code: 'CP', nom: 'CP', ordre: 11 },
      { code: 'CE1', nom: 'CE1', ordre: 12 },
      { code: 'CE2', nom: 'CE2', ordre: 13 },
      { code: 'CM1', nom: 'CM1', ordre: 14 },
      { code: 'CM2', nom: 'CM2', ordre: 15 },
    ],
  },
  {
    code: 'COLLEGE',
    nom: 'Collège',
    niveaux: [
      { code: '6E', nom: '6ème', ordre: 20 },
      { code: '5E', nom: '5ème', ordre: 21 },
      { code: '4E', nom: '4ème', ordre: 22 },
      { code: '3E', nom: '3ème', ordre: 23 },
    ],
  },
  {
    code: 'LYCEE',
    nom: 'Lycée',
    niveaux: [
      { code: '2NDE', nom: 'Seconde', ordre: 30 },
      { code: '1ERE', nom: 'Première', ordre: 31 },
      { code: 'TLE', nom: 'Terminale', ordre: 32 },
    ],
  },
];

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function emailFromName(prenom, nom) {
  return `${slugify(prenom)}.${slugify(nom)}@demo.noura.sn`;
}

function usernameFromName(prenom, nom) {
  return `${slugify(prenom)}.${slugify(nom)}`;
}

async function upsertById(modelName, where, createData, updateData) {
  const existing = await prisma[modelName].findFirst({ where });

  if (existing) {
    return prisma[modelName].update({
      where: { id: existing.id },
      data: updateData,
    });
  }

  return prisma[modelName].create({ data: createData });
}

async function seedDefaultAcademicStructure(tenantId) {
  const result = { cycles: new Map(), niveaux: new Map() };

  for (const section of DEFAULT_STRUCTURE) {
    const cycle = await upsertById(
      'cycle',
      { tenantId, code: section.code },
      { tenantId, code: section.code, libelle: section.nom, actif: true },
      { libelle: section.nom, actif: true },
    );
    result.cycles.set(section.code, cycle);

    for (const niveau of section.niveaux) {
      const niveauRecord = await upsertById(
        'niveau',
        { tenantId, code: niveau.code },
        {
          tenantId,
          cycleId: cycle.id,
          code: niveau.code,
          libelle: niveau.nom,
          ordre: niveau.ordre,
          actif: true,
        },
        {
          cycleId: cycle.id,
          libelle: niveau.nom,
          ordre: niveau.ordre,
          actif: true,
        },
      );
      result.niveaux.set(niveau.code, niveauRecord);

      await upsertById(
        'fraisNiveauConfig',
        { tenantId, section: section.nom, niveau: niveau.nom },
        {
          tenantId,
          section: section.nom,
          niveau: niveau.nom,
          inscription: 0,
          mensualite: 0,
          nbMois: 9,
          moisDebut: 10,
          moisFin: 6,
          actif: true,
        },
        {},
      );
    }
  }

  return result;
}

async function syncEleveParent(eleveId, parentId, tenantId) {
  await prisma.eleveParent.deleteMany({
    where: {
      eleveId,
      parentId,
    },
  });

  return prisma.eleveParent.create({
    data: {
      eleveId,
      parentId,
    },
  });
}

async function upsertNote(tenantId, eleveId, matiereId, trimestre, typeEvaluation, commentaire, note, noteSur = 20) {
  const where = { tenantId, eleveId, matiereId, trimestre, anneeScolaire: SCHOOL_YEAR, typeEvaluation, commentaire };
  const existing = await prisma.note.findFirst({ where });
  const data = {
    tenantId,
    eleveId,
    matiereId,
    trimestre,
    anneeScolaire: SCHOOL_YEAR,
    typeEvaluation,
    commentaire,
    note,
    noteSur,
    dateEvaluation: new Date(`2026-${trimestre.endsWith('1') ? '01' : trimestre.endsWith('2') ? '03' : '06'}-15`),
  };

  if (existing) {
    return prisma.note.update({ where: { id: existing.id }, data });
  }

  return prisma.note.create({ data });
}

async function upsertCalendrierEvent(tenantId, event) {
  const where = {
    tenantId,
    titre: event.titre,
    dateDebut: event.dateDebut,
    sectionId: event.sectionId || null,
  };
  const data = {
    tenantId,
    sectionId: event.sectionId || null,
    titre: event.titre,
    description: event.description || null,
    dateDebut: event.dateDebut,
    dateFin: event.dateFin || null,
    type: event.type,
  };
  const existing = await prisma.calendrierScolaire.findFirst({ where });

  if (existing) {
    return prisma.calendrierScolaire.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.calendrierScolaire.create({ data });
}

async function seedCalendrierScolaire(tenantId) {
  const sections = await prisma.cycle.findMany({
    where: { tenantId, code: { in: ['MATERNELLE', 'PRIMAIRE', 'COLLEGE', 'LYCEE'] } },
    select: { id: true, code: true },
  });
  const sectionByCode = new Map(sections.map((section) => [section.code, section]));

  const globalEvents = [
    {
      titre: 'Rentrée des enseignants',
      description: 'Préparation pédagogique, réunions de rentrée et organisation des classes.',
      dateDebut: new Date('2025-09-29'),
      type: 'RENTREE',
    },
    {
      titre: 'Rentrée des élèves',
      description: 'Accueil général des élèves et démarrage des cours.',
      dateDebut: new Date('2025-10-06'),
      type: 'RENTREE',
    },
    {
      titre: 'Vacances de Noël',
      description: 'Départ en vacances après les cours, reprise le matin du jour indiqué.',
      dateDebut: new Date('2025-12-24'),
      dateFin: new Date('2026-01-05'),
      type: 'VACANCES',
    },
    {
      titre: 'Journée sans école - Lundi de Pentecôte',
      description: 'Journée sans école prévue comme journée de solidarité dans le calendrier national.',
      dateDebut: new Date('2026-05-25'),
      type: 'FERIE',
    },
    {
      titre: 'Assemblée générale FOSCO',
      description: 'Lancement des activités sociales, culturelles, sportives et éducatives du foyer scolaire.',
      dateDebut: new Date('2026-02-14'),
      type: 'ACTIVITE_FOSCO',
    },
    {
      titre: 'Semaine culturelle et sportive',
      description: 'Activités FOSCO, clubs, génie en herbe, théâtre, sport et valorisation des talents.',
      dateDebut: new Date('2026-04-20'),
      dateFin: new Date('2026-04-25'),
      type: 'ACTIVITE_FOSCO',
    },
    {
      titre: 'Clôture administrative de l’année',
      description: 'Finalisation des dossiers, archives, bilans pédagogiques et préparation de l’année suivante.',
      dateDebut: new Date('2026-07-31'),
      type: 'AUTRE',
    },
  ];

  const sectionEvents = [
    {
      sectionCode: 'MATERNELLE',
      titre: 'Activités d’éveil et fête de la petite enfance',
      description: 'Activités périscolaires adaptées à la maternelle : chants, dessins, motricité et exposition.',
      dateDebut: new Date('2026-03-18'),
      type: 'ACTIVITE_PERISCOLAIRE',
    },
    {
      sectionCode: 'PRIMAIRE',
      titre: 'Compositions du 1er semestre - Primaire',
      description: 'Période de compositions du primaire et organisation des corrections.',
      dateDebut: new Date('2026-01-20'),
      dateFin: new Date('2026-02-06'),
      type: 'COMPOSITION',
    },
    {
      sectionCode: 'PRIMAIRE',
      titre: 'Remise des bulletins - Primaire',
      description: 'Communication des résultats aux familles après les compositions.',
      dateDebut: new Date('2026-03-28'),
      type: 'REMISE_BULLETINS',
    },
    {
      sectionCode: 'PRIMAIRE',
      titre: 'CFEE et entrée en 6ème - préparation',
      description: 'Révisions dirigées, encadrement des candidats et organisation administrative.',
      dateDebut: new Date('2026-05-18'),
      dateFin: new Date('2026-06-12'),
      type: 'EXAMEN',
    },
    {
      sectionCode: 'COLLEGE',
      titre: 'Compositions du 1er semestre - Collège',
      description: 'Fenêtre des compositions, avec priorité d’organisation pour les classes d’examen.',
      dateDebut: new Date('2026-01-20'),
      dateFin: new Date('2026-02-20'),
      type: 'COMPOSITION',
    },
    {
      sectionCode: 'COLLEGE',
      titre: 'Conseils de classe - Collège',
      description: 'Bilan du travail et de la vie des classes, appréciations et décisions pédagogiques.',
      dateDebut: new Date('2026-03-16'),
      dateFin: new Date('2026-03-21'),
      type: 'CONSEIL_CLASSE',
    },
    {
      sectionCode: 'COLLEGE',
      titre: 'BFEM - préparation',
      description: 'Révisions, examens blancs et suivi des classes de troisième.',
      dateDebut: new Date('2026-05-25'),
      dateFin: new Date('2026-06-19'),
      type: 'EXAMEN',
    },
    {
      sectionCode: 'LYCEE',
      titre: 'Compositions du 1er semestre - Lycée',
      description: 'Compositions du lycée, transmission des notes et préparation des conseils.',
      dateDebut: new Date('2026-01-20'),
      dateFin: new Date('2026-02-20'),
      type: 'COMPOSITION',
    },
    {
      sectionCode: 'LYCEE',
      titre: 'Conseils de classe - Lycée',
      description: 'Bilan pédagogique, orientation et suivi des classes de première et terminale.',
      dateDebut: new Date('2026-03-16'),
      dateFin: new Date('2026-03-21'),
      type: 'CONSEIL_CLASSE',
    },
    {
      sectionCode: 'LYCEE',
      titre: 'Baccalauréat - préparation',
      description: 'Révisions, examens blancs et encadrement des candidats au baccalauréat.',
      dateDebut: new Date('2026-05-25'),
      dateFin: new Date('2026-06-26'),
      type: 'EXAMEN',
    },
  ];

  const created = [];
  for (const event of globalEvents) {
    created.push(await upsertCalendrierEvent(tenantId, event));
  }
  for (const event of sectionEvents) {
    const section = sectionByCode.get(event.sectionCode);
    if (!section) continue;
    created.push(await upsertCalendrierEvent(tenantId, {
      ...event,
      sectionId: section.id,
    }));
  }

  return created;
}

async function ensureActiveClasseStagiaire(tenantId, classeId, stagiaireId) {
  const active = await prisma.classeStagiaire.findFirst({
    where: { classeId, stagiaireId, actif: true, dateFin: null },
  });
  if (active) return active;

  return prisma.classeStagiaire.create({
    data: {
      tenantId,
      classeId,
      stagiaireId,
      dateDebut: new Date(),
      actif: true,
    },
  });
}

async function upsertTenantUser(tenantId, user, passwordHash) {
  const email = user.email || emailFromName(user.prenom, user.nom);
  const username = user.username || usernameFromName(user.prenom, user.nom);
  const baseData = {
    tenantId,
    email,
    username,
    firstName: user.prenom,
    lastName: user.nom,
    telephone: user.telephone,
    adresse: user.adresse || 'Dakar, Senegal',
    role: user.role,
    actif: true,
    mustChangePwd: false,
    passwordHash,
    matricule: user.matricule || null,
    dateNaissance: user.dateNaissance || null,
    lieuNaissance: user.lieuNaissance || null,
    genre: user.genre || null,
    numeroUrgence: user.numeroUrgence || null,
    dateInscription: user.dateInscription || null,
    photoUrl: user.photoUrl || null,
    classeId: user.classeId || null,
    specialite: user.specialite || null,
    dateEmbauche: user.dateEmbauche || null,
    numeroCNPS: user.numeroCNPS || null,
    numeroSecuriteSociale: user.numeroSecuriteSociale || null,
    profession: user.profession || null,
    lieuTravail: user.lieuTravail || null,
    telephoneTravail: user.telephoneTravail || null,
    lienParente: user.lienParente || null,
  };

  const existing = await prisma.user.findFirst({
    where: { tenantId, email },
  });

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: baseData,
    });
  }

  return prisma.user.create({ data: baseData });
}

async function upsertPlatformUser(user, passwordHash) {
  const existing = await prisma.plateformeUtilisateur.findFirst({
    where: { email: user.email },
  });

  const data = {
    nom: user.nom,
    prenom: user.prenom,
    email: user.email,
    telephone: user.telephone,
    motDePasse: passwordHash,
    rolePlateforme: user.role,
    actif: true,
  };

  if (existing) {
    return prisma.plateformeUtilisateur.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.plateformeUtilisateur.create({ data });
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const tenant = await upsertById(
    'tenant',
    { slug: TENANT_SLUG },
    {
      slug: TENANT_SLUG,
      nom: 'Ecole Noura Dakar',
      emailContact: 'contact@demo.noura.sn',
      telephone: '+221339000000',
      adresse: 'Dakar, Senegal',
      plan: 'TRIAL',
      actif: true,
    },
    {
      nom: 'Ecole Noura Dakar',
      emailContact: 'contact@demo.noura.sn',
      telephone: '+221339000000',
      adresse: 'Dakar, Senegal',
      plan: 'TRIAL',
      actif: true,
    },
  );

  await seedDefaultAcademicStructure(tenant.id);

  const cycle = await upsertById(
    'cycle',
    { tenantId: tenant.id, code: 'PRIMAIRE' },
    {
      tenantId: tenant.id,
      code: 'PRIMAIRE',
      libelle: 'Cycle primaire',
      actif: true,
    },
    {
      libelle: 'Cycle primaire',
      actif: true,
    },
  );

  const niveauCI = await upsertById(
    'niveau',
    { tenantId: tenant.id, code: 'CI' },
    {
      tenantId: tenant.id,
      cycleId: cycle.id,
      code: 'CI',
      libelle: 'Cours d initiation',
      ordre: 1,
      actif: true,
    },
    {
      cycleId: cycle.id,
      libelle: 'Cours d initiation',
      ordre: 1,
      actif: true,
    },
  );

  const niveauCP = await upsertById(
    'niveau',
    { tenantId: tenant.id, code: 'CP' },
    {
      tenantId: tenant.id,
      cycleId: cycle.id,
      code: 'CP',
      libelle: 'Cours preparatoire',
      ordre: 2,
      actif: true,
    },
    {
      cycleId: cycle.id,
      libelle: 'Cours preparatoire',
      ordre: 2,
      actif: true,
    },
  );

  const schoolYear = await upsertById(
    'anneeAcademique',
    { tenantId: tenant.id, libelle: SCHOOL_YEAR },
    {
      tenantId: tenant.id,
      libelle: SCHOOL_YEAR,
      dateDebut: CURRENT_YEAR_START,
      dateFin: CURRENT_YEAR_END,
      estCourante: true,
      actif: true,
    },
    {
      dateDebut: CURRENT_YEAR_START,
      dateFin: CURRENT_YEAR_END,
      estCourante: true,
      actif: true,
    },
  );

  const batiment = await upsertById(
    'batiment',
    { tenantId: tenant.id, nom: 'Bloc A' },
    {
      tenantId: tenant.id,
      nom: 'Bloc A',
      description: 'Batiment principal du site de Dakar',
      actif: true,
    },
    {
      description: 'Batiment principal du site de Dakar',
      actif: true,
    },
  );

  const salle101 = await upsertById(
    'salle',
    { tenantId: tenant.id, batimentId: batiment.id, nom: 'Salle 101' },
    {
      tenantId: tenant.id,
      batimentId: batiment.id,
      nom: 'Salle 101',
      capacite: 40,
      typeSalle: 'Cours',
      actif: true,
    },
    {
      capacite: 40,
      typeSalle: 'Cours',
      actif: true,
    },
  );

  const salle102 = await upsertById(
    'salle',
    { tenantId: tenant.id, batimentId: batiment.id, nom: 'Salle 102' },
    {
      tenantId: tenant.id,
      batimentId: batiment.id,
      nom: 'Salle 102',
      capacite: 35,
      typeSalle: 'Cours',
      actif: true,
    },
    {
      capacite: 35,
      typeSalle: 'Cours',
      actif: true,
    },
  );

  const classeCIA = await upsertById(
    'classe',
    { tenantId: tenant.id, nom: 'CI A', anneeAcademiqueId: schoolYear.id },
    {
      tenantId: tenant.id,
      nom: 'CI A',
      niveauId: niveauCI.id,
      anneeAcademiqueId: schoolYear.id,
      salleId: salle101.id,
      effectifMax: 40,
    },
    {
      niveauId: niveauCI.id,
      anneeAcademiqueId: schoolYear.id,
      salleId: salle101.id,
      effectifMax: 40,
    },
  );

  const classeCPA = await upsertById(
    'classe',
    { tenantId: tenant.id, nom: 'CP A', anneeAcademiqueId: schoolYear.id },
    {
      tenantId: tenant.id,
      nom: 'CP A',
      niveauId: niveauCP.id,
      anneeAcademiqueId: schoolYear.id,
      salleId: salle102.id,
      effectifMax: 35,
    },
    {
      niveauId: niveauCP.id,
      anneeAcademiqueId: schoolYear.id,
      salleId: salle102.id,
      effectifMax: 35,
    },
  );

  const seededClassDefinitions = [
    { nom: 'Petite Section A', niveauCode: 'PS', effectifMax: 30 },
    { nom: 'Moyenne Section A', niveauCode: 'MS', effectifMax: 30 },
    { nom: 'Grande Section A', niveauCode: 'GS', effectifMax: 30 },
    { nom: 'CE1 A', niveauCode: 'CE1', effectifMax: 35 },
    { nom: 'CE2 A', niveauCode: 'CE2', effectifMax: 35 },
    { nom: 'CM1 A', niveauCode: 'CM1', effectifMax: 35 },
    { nom: 'CM2 A', niveauCode: 'CM2', effectifMax: 35 },
    { nom: '6ème A', niveauCode: '6E', effectifMax: 45 },
    { nom: '5ème A', niveauCode: '5E', effectifMax: 45 },
    { nom: '4ème A', niveauCode: '4E', effectifMax: 45 },
    { nom: '3ème A', niveauCode: '3E', effectifMax: 45 },
    { nom: 'Seconde A', niveauCode: '2NDE', effectifMax: 45 },
    { nom: 'Première A', niveauCode: '1ERE', effectifMax: 45 },
    { nom: 'Terminale A', niveauCode: 'TLE', effectifMax: 45 },
  ];

  const seededClasses = [classeCIA, classeCPA];
  for (const definition of seededClassDefinitions) {
    const niveau = await prisma.niveau.findFirst({ where: { tenantId: tenant.id, code: definition.niveauCode } });
    if (!niveau) continue;
    seededClasses.push(await upsertById(
      'classe',
      { tenantId: tenant.id, nom: definition.nom, anneeAcademiqueId: schoolYear.id },
      {
        tenantId: tenant.id,
        nom: definition.nom,
        niveauId: niveau.id,
        anneeAcademiqueId: schoolYear.id,
        effectifMax: definition.effectifMax,
        actif: true,
      },
      {
        niveauId: niveau.id,
        anneeAcademiqueId: schoolYear.id,
        effectifMax: definition.effectifMax,
        actif: true,
      },
    ));
  }

  const matiereFrancais = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'FR' },
    {
      tenantId: tenant.id,
      code: 'FR',
      libelle: 'Francais',
      description: 'Langue francaise',
      actif: true,
    },
    {
      libelle: 'Francais',
      description: 'Langue francaise',
      actif: true,
    },
  );

  const matiereMaths = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'MATH' },
    {
      tenantId: tenant.id,
      code: 'MATH',
      libelle: 'Mathematiques',
      description: 'Arithmetique et calcul',
      actif: true,
    },
    {
      libelle: 'Mathematiques',
      description: 'Arithmetique et calcul',
      actif: true,
    },
  );

  const matiereLecture = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'LECT' },
    {
      tenantId: tenant.id,
      code: 'LECT',
      libelle: 'Lecture',
      description: 'Lecture et comprehension',
      actif: true,
    },
    {
      libelle: 'Lecture',
      description: 'Lecture et comprehension',
      actif: true,
    },
  );

  const platformUsers = [
    { role: 'SUPER_ADMIN', prenom: 'Aissatou', nom: 'Diop', telephone: '+221771000001', email: 'aissatou.diop@demo.noura.sn' },
    { role: 'SUPER_ADMIN', prenom: 'Bamba', nom: 'Diallo', telephone: '+221771000002', email: 'bamba.diallo@demo.noura.sn' },
    { role: 'GESTIONNAIRE', prenom: 'Mariam', nom: 'Sow', telephone: '+221771000003', email: 'mariam.sow@demo.noura.sn' },
    { role: 'GESTIONNAIRE', prenom: 'Cheikh', nom: 'Ndiaye', telephone: '+221771000004', email: 'cheikh.ndiaye@demo.noura.sn' },
  ];

  const tenantUsers = [
    { role: 'ADMIN', prenom: 'Khady', nom: 'Ba', telephone: '+221781000011', email: 'khady.ba@demo.noura.sn', username: 'khady.ba' },
    { role: 'ADMIN', prenom: 'Mamadou', nom: 'Fall', telephone: '+221781000012', email: 'mamadou.fall@demo.noura.sn', username: 'mamadou.fall' },
    { role: 'CAISSIER', prenom: 'Fatou', nom: 'Cisse', telephone: '+221781000021', email: 'fatou.cisse@demo.noura.sn', username: 'fatou.cisse' },
    { role: 'CAISSIER', prenom: 'Ibrahima', nom: 'Kane', telephone: '+221781000022', email: 'ibrahima.kane@demo.noura.sn', username: 'ibrahima.kane' },
    { role: 'SURVEILLANT', prenom: 'Rokhaya', nom: 'Diallo', telephone: '+221781000031', email: 'rokhaya.diallo@demo.noura.sn', username: 'rokhaya.diallo' },
    { role: 'SURVEILLANT', prenom: 'Pape', nom: 'Gaye', telephone: '+221781000032', email: 'pape.gaye@demo.noura.sn', username: 'pape.gaye' },
    { role: 'ENSEIGNANT', prenom: 'Ousmane', nom: 'Diouf', telephone: '+221781000041', email: 'ousmane.diouf@demo.noura.sn', username: 'ousmane.diouf', specialite: 'Mathematiques', dateEmbauche: new Date('2023-09-01') },
    { role: 'ENSEIGNANT', prenom: 'Adja', nom: 'Sarr', telephone: '+221781000042', email: 'adja.sarr@demo.noura.sn', username: 'adja.sarr', specialite: 'Francais', dateEmbauche: new Date('2024-10-01') },
    { role: 'ELEVE', prenom: 'Amadou', nom: 'Kane', telephone: '+221781000051', email: 'amadou.kane@demo.noura.sn', username: 'amadou.kane', matricule: 'ELV-2025-0001', dateNaissance: new Date('2014-02-18'), genre: 'M', numeroUrgence: '+221771111111', dateInscription: new Date('2025-10-05'), classeId: classeCIA.id },
    { role: 'ELEVE', prenom: 'Awa', nom: 'Diallo', telephone: '+221781000052', email: 'awa.diallo@demo.noura.sn', username: 'awa.diallo', matricule: 'ELV-2025-0002', dateNaissance: new Date('2014-06-09'), genre: 'F', numeroUrgence: '+221772222222', dateInscription: new Date('2025-10-05'), classeId: classeCIA.id },
    { role: 'PARENT', prenom: 'Mamadou', nom: 'Ndiaye', telephone: '+221781000061', email: 'mamadou.ndiaye@demo.noura.sn', username: 'mamadou.ndiaye', profession: 'Commercant', lieuTravail: 'Sandaga', telephoneTravail: '+221338888888', lienParente: 'PERE' },
    { role: 'PARENT', prenom: 'Aminata', nom: 'Ba', telephone: '+221781000062', email: 'aminata.ba@demo.noura.sn', username: 'aminata.ba', profession: 'Assistante de direction', lieuTravail: 'Plateau', telephoneTravail: '+221338777777', lienParente: 'MERE' },
    { role: 'RH', prenom: 'Boubacar', nom: 'Sy', telephone: '+221781000071', email: 'boubacar.sy@demo.noura.sn', username: 'boubacar.sy' },
    { role: 'RH', prenom: 'Khadim', nom: 'Thiam', telephone: '+221781000072', email: 'khadim.thiam@demo.noura.sn', username: 'khadim.thiam' },
  ];

  const platformRecords = [];
  for (const user of platformUsers) {
    platformRecords.push(await upsertPlatformUser(user, passwordHash));
  }

  const tenantRecords = [];
  for (const user of tenantUsers) {
    tenantRecords.push(await upsertTenantUser(tenant.id, user, passwordHash));
  }

  const recordsByEmail = new Map(tenantRecords.map((record) => [record.email, record]));
  const teacherOusmane = recordsByEmail.get('ousmane.diouf@demo.noura.sn');
  const teacherAdja = recordsByEmail.get('adja.sarr@demo.noura.sn');
  const adminKhady = recordsByEmail.get('khady.ba@demo.noura.sn');
  const surveillantRokhaya = recordsByEmail.get('rokhaya.diallo@demo.noura.sn');
  const surveillantPape = recordsByEmail.get('pape.gaye@demo.noura.sn');
  const eleveAmadou = recordsByEmail.get('amadou.kane@demo.noura.sn');
  const eleveAwa = recordsByEmail.get('awa.diallo@demo.noura.sn');
  const parentMamadou = recordsByEmail.get('mamadou.ndiaye@demo.noura.sn');
  const parentAminata = recordsByEmail.get('aminata.ba@demo.noura.sn');

  if (teacherOusmane) {
    await prisma.classe.update({
      where: { id: classeCIA.id },
      data: { professeurResponsableId: teacherOusmane.id },
    });
  }

  if (teacherAdja) {
    await prisma.classe.update({
      where: { id: classeCPA.id },
      data: { professeurResponsableId: teacherAdja.id },
    });
  }

  if (teacherAdja) {
    await ensureActiveClasseStagiaire(tenant.id, classeCIA.id, teacherAdja.id);
  }

  if (teacherOusmane) {
    await ensureActiveClasseStagiaire(tenant.id, classeCPA.id, teacherOusmane.id);
  }

  const personnelUsers = [
    { user: recordsByEmail.get('khady.ba@demo.noura.sn'), numeroMatricule: 'PERS-ADM-001', typeContrat: 'CDI', dateEmbauche: new Date('2022-09-01'), salaire: 450000 },
    { user: recordsByEmail.get('mamadou.fall@demo.noura.sn'), numeroMatricule: 'PERS-ADM-002', typeContrat: 'CDI', dateEmbauche: new Date('2023-01-10'), salaire: 420000 },
    { user: recordsByEmail.get('fatou.cisse@demo.noura.sn'), numeroMatricule: 'PERS-CAI-001', typeContrat: 'CDD', dateEmbauche: new Date('2024-09-01'), salaire: 300000 },
    { user: recordsByEmail.get('ibrahima.kane@demo.noura.sn'), numeroMatricule: 'PERS-CAI-002', typeContrat: 'CDD', dateEmbauche: new Date('2024-10-01'), salaire: 295000 },
    { user: recordsByEmail.get('rokhaya.diallo@demo.noura.sn'), numeroMatricule: 'PERS-SUR-001', typeContrat: 'CDD', dateEmbauche: new Date('2024-09-15'), salaire: 280000 },
    { user: recordsByEmail.get('pape.gaye@demo.noura.sn'), numeroMatricule: 'PERS-SUR-002', typeContrat: 'CDD', dateEmbauche: new Date('2025-01-15'), salaire: 275000 },
    { user: teacherOusmane, numeroMatricule: 'PERS-ENS-001', typeContrat: 'CDI', dateEmbauche: new Date('2023-09-01'), salaire: 550000 },
    { user: teacherAdja, numeroMatricule: 'PERS-ENS-002', typeContrat: 'CDI', dateEmbauche: new Date('2024-10-01'), salaire: 520000 },
    { user: recordsByEmail.get('boubacar.sy@demo.noura.sn'), numeroMatricule: 'PERS-RH-001', typeContrat: 'CDI', dateEmbauche: new Date('2023-11-01'), salaire: 400000 },
    { user: recordsByEmail.get('khadim.thiam@demo.noura.sn'), numeroMatricule: 'PERS-RH-002', typeContrat: 'CDI', dateEmbauche: new Date('2024-02-01'), salaire: 390000 },
  ];

  for (const personnel of personnelUsers) {
    if (!personnel.user) continue;

    await upsertById(
      'personnel',
      { utilisateurId: personnel.user.id },
      {
        tenantId: tenant.id,
        utilisateurId: personnel.user.id,
        numeroMatricule: personnel.numeroMatricule,
        typeContrat: personnel.typeContrat,
        dateEmbauche: personnel.dateEmbauche,
        salaire: personnel.salaire,
        soldeConge: 18,
      },
      {
        tenantId: tenant.id,
        numeroMatricule: personnel.numeroMatricule,
        typeContrat: personnel.typeContrat,
        dateEmbauche: personnel.dateEmbauche,
        salaire: personnel.salaire,
        soldeConge: 18,
      },
    );
  }

  for (const surveillant of [surveillantRokhaya, surveillantPape]) {
    if (!surveillant) continue;

    await upsertById(
      'surveillantCycle',
      { surveillantId: surveillant.id, cycleId: cycle.id },
      {
        tenantId: tenant.id,
        surveillantId: surveillant.id,
        cycleId: cycle.id,
      },
      {
        tenantId: tenant.id,
      },
    );
  }

  const coursMaths = await upsertById(
    'cours',
    { matiereId: matiereMaths.id, enseignantId: teacherOusmane.id, classeId: classeCIA.id, anneeAcademiqueId: schoolYear.id },
    {
      tenantId: tenant.id,
      matiereId: matiereMaths.id,
      classeId: classeCIA.id,
      enseignantId: teacherOusmane.id,
      anneeAcademiqueId: schoolYear.id,
      volumeHoraireHebdo: 4,
      coefficient: 3,
    },
    {
      tenantId: tenant.id,
      volumeHoraireHebdo: 4,
      coefficient: 3,
    },
  );

  const coursFrancais = await upsertById(
    'cours',
    { matiereId: matiereFrancais.id, enseignantId: teacherAdja.id, classeId: classeCIA.id, anneeAcademiqueId: schoolYear.id },
    {
      tenantId: tenant.id,
      matiereId: matiereFrancais.id,
      classeId: classeCIA.id,
      enseignantId: teacherAdja.id,
      anneeAcademiqueId: schoolYear.id,
      volumeHoraireHebdo: 5,
      coefficient: 2,
    },
    {
      tenantId: tenant.id,
      volumeHoraireHebdo: 5,
      coefficient: 2,
    },
  );

  await upsertById(
    'matiereClasse',
    { matiereId: matiereMaths.id, classeId: classeCIA.id, enseignantId: teacherOusmane.id, anneeAcademiqueId: schoolYear.id },
    {
      tenantId: tenant.id,
      matiereId: matiereMaths.id,
      classeId: classeCIA.id,
      enseignantId: teacherOusmane.id,
      anneeAcademiqueId: schoolYear.id,
      anneeScolaire: SCHOOL_YEAR,
      volumeHoraire: 4,
    },
    {
      tenantId: tenant.id,
      anneeScolaire: SCHOOL_YEAR,
      volumeHoraire: 4,
    },
  );

  await upsertById(
    'matiereClasse',
    { matiereId: matiereFrancais.id, classeId: classeCIA.id, enseignantId: teacherAdja.id, anneeAcademiqueId: schoolYear.id },
    {
      tenantId: tenant.id,
      matiereId: matiereFrancais.id,
      classeId: classeCIA.id,
      enseignantId: teacherAdja.id,
      anneeAcademiqueId: schoolYear.id,
      anneeScolaire: SCHOOL_YEAR,
      volumeHoraire: 5,
    },
    {
      tenantId: tenant.id,
      anneeScolaire: SCHOOL_YEAR,
      volumeHoraire: 5,
    },
  );

  const students = [eleveAmadou, eleveAwa];
  for (let index = 0; index < students.length; index += 1) {
    const student = students[index];
    if (!student) continue;

    await upsertById(
      'inscription',
      { numeroInscription: `INS-${SCHOOL_YEAR}-${String(index + 1).padStart(4, '0')}` },
      {
        tenantId: tenant.id,
        numeroInscription: `INS-${SCHOOL_YEAR}-${String(index + 1).padStart(4, '0')}`,
        eleveId: student.id,
        classeId: classeCIA.id,
        anneeAcademiqueId: schoolYear.id,
        statut: 'ACTIF',
        creePar: adminKhady.id,
      },
      {
        tenantId: tenant.id,
        eleveId: student.id,
        classeId: classeCIA.id,
        anneeAcademiqueId: schoolYear.id,
        statut: 'ACTIF',
        creePar: adminKhady.id,
      },
    );
  }

  const noteSeeds = [
    { student: eleveAmadou, base: { [matiereMaths.id]: 7, [matiereFrancais.id]: 6.5 } },
    { student: eleveAwa, base: { [matiereMaths.id]: 8, [matiereFrancais.id]: 7.5 } },
  ];
  const periods = ['SEMESTRE_1', 'SEMESTRE_2', 'SEMESTRE_3'];
  for (const seed of noteSeeds) {
    if (!seed.student) continue;
    for (let periodIndex = 0; periodIndex < periods.length; periodIndex += 1) {
      const period = periods[periodIndex];
      for (const matiere of [matiereMaths, matiereFrancais]) {
        const base = seed.base[matiere.id] + periodIndex;
        await upsertNote(tenant.id, seed.student.id, matiere.id, period, 'DEVOIR', 'Devoir 1', Math.min(10, base), 10);
        await upsertNote(tenant.id, seed.student.id, matiere.id, period, 'DEVOIR', 'Devoir 2', Math.min(10, base + 0.5), 10);
        await upsertNote(tenant.id, seed.student.id, matiere.id, period, 'COMPOSITION', 'Composition', Math.min(10, base + 1), 10);
      }
    }
  }

  if (eleveAmadou && parentMamadou) {
    await syncEleveParent(eleveAmadou.id, parentMamadou.id, tenant.id);
  }

  if (eleveAwa && parentAminata) {
    await syncEleveParent(eleveAwa.id, parentAminata.id, tenant.id);
  }

  const calendrierEvents = await seedCalendrierScolaire(tenant.id);

  console.log(`Tenant: ${tenant.nom} (${tenant.slug})`);
  console.log(`Tenant ID: ${tenant.id}`);
  console.log(`School year: ${SCHOOL_YEAR}`);
  console.log(`Password used for all generated accounts: ${PASSWORD}`);
  console.log('');

  console.log('Platform accounts');
  for (const user of platformRecords) {
    console.log(`- ${user.prenom} ${user.nom} | ${user.email} | password=${PASSWORD}`);
  }

  console.log('');
  console.log('Tenant accounts');
  for (const user of tenantRecords) {
    const parts = [`- ${user.firstName} ${user.lastName}`, `role=${user.role}`, `email=${user.email}`, `password=${PASSWORD}`];
    if (user.username) {
      parts.splice(3, 0, `username=${user.username}`);
    }
    console.log(parts.join(' | '));
  }

  console.log('');
  console.log('Academic data');
  console.log(`- Cycle: ${cycle.code} / ${cycle.libelle}`);
  console.log(`- Classes: ${seededClasses.map((classe) => classe.nom).join(', ')}`);
  console.log(`- Matieres: ${matiereFrancais.libelle}, ${matiereMaths.libelle}, ${matiereLecture.libelle}`);
  console.log(`- Courses: ${coursMaths.id}, ${coursFrancais.id}`);
  console.log(`- Calendrier scolaire: ${calendrierEvents.length} événements`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
