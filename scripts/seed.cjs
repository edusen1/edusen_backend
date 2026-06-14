#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { randomBytes } = require('node:crypto');

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
const SEED_PHONE_NUMBER = process.env.SEED_PHONE_NUMBER || '+22771272788';
const TENANT_SLUG = 'ecole-noura-dakar';
const TENANT_CODE_ELEVE       = 'NOURA2026E';
const TENANT_CODE_ENSEIGNANT  = 'NOURA2026P';
const TENANT_CODE_CAISSIER    = 'NOURA2026C';
const TENANT_CODE_ADMIN       = 'NOURA2026A';
const TENANT_CODE_SURVEILLANT = 'NOURA2026S';
const TENANT_CODE_RH          = 'NOURA2026R';
const SCHOOL_YEAR = '2025-2026';
const CURRENT_YEAR_START = new Date('2025-10-01');
const CURRENT_YEAR_END = new Date('2026-07-31');
// const DEFAULT_STRUCTURE = [
//   {
//     code: 'MATERNELLE',
//     nom: 'Maternelle',
//     niveaux: [
//       { code: 'PS', nom: 'Petite Section', ordre: 1 },
//       { code: 'MS', nom: 'Moyenne Section', ordre: 2 },
//       { code: 'GS', nom: 'Grande Section', ordre: 3 },
//     ],
//   },
//   {
//     code: 'PRIMAIRE',
//     nom: 'Primaire',
//     niveaux: [
//       { code: 'CI', nom: 'CI', ordre: 10 },
//       { code: 'CP', nom: 'CP', ordre: 11 },
//       { code: 'CE1', nom: 'CE1', ordre: 12 },
//       { code: 'CE2', nom: 'CE2', ordre: 13 },
//       { code: 'CM1', nom: 'CM1', ordre: 14 },
//       { code: 'CM2', nom: 'CM2', ordre: 15 },
//     ],
//   },
//   {
//     code: 'COLLEGE',
//     nom: 'Collège',
//     niveaux: [
//       { code: '6E', nom: '6ème', ordre: 20 },
//       { code: '5E', nom: '5ème', ordre: 21 },
//       { code: '4E', nom: '4ème', ordre: 22 },
//       { code: '3E', nom: '3ème', ordre: 23 },
//     ],
//   },
//   {
//     code: 'LYCEE',
//     nom: 'Lycée',
//     niveaux: [
//       { code: '2NDE', nom: 'Seconde', ordre: 30 },
//       { code: '1ERE', nom: 'Première', ordre: 31 },
//       { code: 'TLE', nom: 'Terminale', ordre: 32 },
//     ],
//   },
// ];

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

function seedPhone(value) {
  return value === undefined || value === null ? null : SEED_PHONE_NUMBER;
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

/* ===== Helpers de seed désactivés (non utilisés : on ne crée que le tenant + les users) =====
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

      const fraisMap = {
        'Maternelle|Petite Section':  { inscription: 50000, mensualite: 25000 },
        'Maternelle|Moyenne Section': { inscription: 50000, mensualite: 25000 },
        'Maternelle|Grande Section':  { inscription: 55000, mensualite: 28000 },
        'Primaire|CI':                { inscription: 60000, mensualite: 30000 },
        'Primaire|CP':                { inscription: 60000, mensualite: 30000 },
        'Primaire|CE1':               { inscription: 65000, mensualite: 32000 },
        'Primaire|CE2':               { inscription: 65000, mensualite: 32000 },
        'Primaire|CM1':               { inscription: 70000, mensualite: 35000 },
        'Primaire|CM2':               { inscription: 70000, mensualite: 35000 },
        'Collège|6ème':               { inscription: 80000, mensualite: 40000 },
        'Collège|5ème':               { inscription: 80000, mensualite: 40000 },
        'Collège|4ème':               { inscription: 85000, mensualite: 42000 },
        'Collège|3ème':               { inscription: 90000, mensualite: 45000 },
        'Lycée|Seconde':              { inscription: 100000, mensualite: 50000 },
        'Lycée|Première':             { inscription: 100000, mensualite: 50000 },
        'Lycée|Terminale':            { inscription: 110000, mensualite: 55000 },
      };
      const fraisKey = `${section.nom}|${niveau.nom}`;
      const fraisVals = fraisMap[fraisKey] || { inscription: 0, mensualite: 0 };
      await upsertById(
        'fraisNiveauConfig',
        { tenantId, section: section.nom, niveau: niveau.nom },
        {
          tenantId,
          section: section.nom,
          niveau: niveau.nom,
          inscription: fraisVals.inscription,
          mensualite: fraisVals.mensualite,
          nbMois: 9,
          moisDebut: 10,
          moisFin: 6,
          actif: true,
        },
        { inscription: fraisVals.inscription, mensualite: fraisVals.mensualite },
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

async function upsertReclamation(tenantId, eleveId, motif, statut = 'EN_ATTENTE', noteId = null, reponse = null, pieceJointeUrl = null) {
  const existing = await prisma.reclamation.findFirst({ where: { tenantId, eleveId, motif } });
  const data = { tenantId, eleveId, noteId, motif, statut, reponse, pieceJointeUrl };
  if (existing) {
    return prisma.reclamation.update({ where: { id: existing.id }, data });
  }
  return prisma.reclamation.create({ data });
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
===== FIN helpers de seed désactivés ===== */

// async function seedCalendrierScolaire(tenantId) {
//   const sections = await prisma.cycle.findMany({
//     where: { tenantId, code: { in: ['MATERNELLE', 'PRIMAIRE', 'COLLEGE', 'LYCEE'] } },
//     select: { id: true, code: true },
//   });
//   const sectionByCode = new Map(sections.map((section) => [section.code, section]));

//   const globalEvents = [
//     {
//       titre: 'Rentrée des enseignants',
//       description: 'Préparation pédagogique, réunions de rentrée et organisation des classes.',
//       dateDebut: new Date('2025-09-29'),
//       type: 'RENTREE',
//     },
//     {
//       titre: 'Rentrée des élèves',
//       description: 'Accueil général des élèves et démarrage des cours.',
//       dateDebut: new Date('2025-10-06'),
//       type: 'RENTREE',
//     },
//     {
//       titre: 'Vacances de Noël',
//       description: 'Départ en vacances après les cours, reprise le matin du jour indiqué.',
//       dateDebut: new Date('2025-12-24'),
//       dateFin: new Date('2026-01-05'),
//       type: 'VACANCES',
//     },
//     {
//       titre: 'Journée sans école - Lundi de Pentecôte',
//       description: 'Journée sans école prévue comme journée de solidarité dans le calendrier national.',
//       dateDebut: new Date('2026-05-25'),
//       type: 'FERIE',
//     },
//     {
//       titre: 'Assemblée générale FOSCO',
//       description: 'Lancement des activités sociales, culturelles, sportives et éducatives du foyer scolaire.',
//       dateDebut: new Date('2026-02-14'),
//       type: 'ACTIVITE_FOSCO',
//     },
//     {
//       titre: 'Semaine culturelle et sportive',
//       description: 'Activités FOSCO, clubs, génie en herbe, théâtre, sport et valorisation des talents.',
//       dateDebut: new Date('2026-04-20'),
//       dateFin: new Date('2026-04-25'),
//       type: 'ACTIVITE_FOSCO',
//     },
//     {
//       titre: 'Clôture administrative de l’année',
//       description: 'Finalisation des dossiers, archives, bilans pédagogiques et préparation de l’année suivante.',
//       dateDebut: new Date('2026-07-31'),
//       type: 'AUTRE',
//     },
//   ];

//   const sectionEvents = [
//     {
//       sectionCode: 'MATERNELLE',
//       titre: 'Activités d’éveil et fête de la petite enfance',
//       description: 'Activités périscolaires adaptées à la maternelle : chants, dessins, motricité et exposition.',
//       dateDebut: new Date('2026-03-18'),
//       type: 'ACTIVITE_PERISCOLAIRE',
//     },
//     {
//       sectionCode: 'PRIMAIRE',
//       titre: 'Compositions du 1er semestre - Primaire',
//       description: 'Période de compositions du primaire et organisation des corrections.',
//       dateDebut: new Date('2026-01-20'),
//       dateFin: new Date('2026-02-06'),
//       type: 'COMPOSITION',
//     },
//     {
//       sectionCode: 'PRIMAIRE',
//       titre: 'Remise des bulletins - Primaire',
//       description: 'Communication des résultats aux familles après les compositions.',
//       dateDebut: new Date('2026-03-28'),
//       type: 'REMISE_BULLETINS',
//     },
//     {
//       sectionCode: 'PRIMAIRE',
//       titre: 'CFEE et entrée en 6ème - préparation',
//       description: 'Révisions dirigées, encadrement des candidats et organisation administrative.',
//       dateDebut: new Date('2026-05-18'),
//       dateFin: new Date('2026-06-12'),
//       type: 'EXAMEN',
//     },
//     {
//       sectionCode: 'COLLEGE',
//       titre: 'Compositions du 1er semestre - Collège',
//       description: 'Fenêtre des compositions, avec priorité d’organisation pour les classes d’examen.',
//       dateDebut: new Date('2026-01-20'),
//       dateFin: new Date('2026-02-20'),
//       type: 'COMPOSITION',
//     },
//     {
//       sectionCode: 'COLLEGE',
//       titre: 'Conseils de classe - Collège',
//       description: 'Bilan du travail et de la vie des classes, appréciations et décisions pédagogiques.',
//       dateDebut: new Date('2026-03-16'),
//       dateFin: new Date('2026-03-21'),
//       type: 'CONSEIL_CLASSE',
//     },
//     {
//       sectionCode: 'COLLEGE',
//       titre: 'BFEM - préparation',
//       description: 'Révisions, examens blancs et suivi des classes de troisième.',
//       dateDebut: new Date('2026-05-25'),
//       dateFin: new Date('2026-06-19'),
//       type: 'EXAMEN',
//     },
//     {
//       sectionCode: 'LYCEE',
//       titre: 'Compositions du 1er semestre - Lycée',
//       description: 'Compositions du lycée, transmission des notes et préparation des conseils.',
//       dateDebut: new Date('2026-01-20'),
//       dateFin: new Date('2026-02-20'),
//       type: 'COMPOSITION',
//     },
//     {
//       sectionCode: 'LYCEE',
//       titre: 'Conseils de classe - Lycée',
//       description: 'Bilan pédagogique, orientation et suivi des classes de première et terminale.',
//       dateDebut: new Date('2026-03-16'),
//       dateFin: new Date('2026-03-21'),
//       type: 'CONSEIL_CLASSE',
//     },
//     {
//       sectionCode: 'LYCEE',
//       titre: 'Baccalauréat - préparation',
//       description: 'Révisions, examens blancs et encadrement des candidats au baccalauréat.',
//       dateDebut: new Date('2026-05-25'),
//       dateFin: new Date('2026-06-26'),
//       type: 'EXAMEN',
//     },
//   ];

//   const created = [];
//   for (const event of globalEvents) {
//     created.push(await upsertCalendrierEvent(tenantId, event));
//   }
//   for (const event of sectionEvents) {
//     const section = sectionByCode.get(event.sectionCode);
//     if (!section) continue;
//     created.push(await upsertCalendrierEvent(tenantId, {
//       ...event,
//       sectionId: section.id,
//     }));
//   }

//   return created;
// }

// async function ensureActiveClasseStagiaire(tenantId, classeId, stagiaireId) {
//   const active = await prisma.classeStagiaire.findFirst({
//     where: { classeId, stagiaireId, actif: true, dateFin: null },
//   });
//   if (active) return active;

//   return prisma.classeStagiaire.create({
//     data: {
//       tenantId,
//       classeId,
//       stagiaireId,
//       dateDebut: new Date(),
//       actif: true,
//     },
//   });
// }

async function upsertTenantUser(tenantId, user, passwordHash) {
  const email = user.email || emailFromName(user.prenom, user.nom);
  const username = user.username || usernameFromName(user.prenom, user.nom);
  const baseData = {
    tenantId,
    email,
    username,
    firstName: user.prenom,
    lastName: user.nom,
    telephone: seedPhone(user.telephone),
    adresse: user.adresse || 'Dakar, Senegal',
    role: user.role,
    actif: true,
    mustChangePwd: false,
    passwordHash,
    matricule: user.matricule || null,
    dateNaissance: user.dateNaissance || null,
    lieuNaissance: user.lieuNaissance || null,
    genre: user.genre || null,
    numeroUrgence: seedPhone(user.numeroUrgence),
    dateInscription: user.dateInscription || null,
    photoUrl: user.photoUrl || null,
    classeId: user.classeId || null,
    specialite: user.specialite || null,
    dateEmbauche: user.dateEmbauche || null,
    numeroCNPS: user.numeroCNPS || null,
    numeroSecuriteSociale: user.numeroSecuriteSociale || null,
    profession: user.profession || null,
    lieuTravail: user.lieuTravail || null,
    telephoneTravail: seedPhone(user.telephoneTravail),
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

// async function upsertPlatformUser(user, passwordHash) {
//   const existing = await prisma.plateformeUtilisateur.findFirst({
//     where: { email: user.email },
//   });

//   const data = {
//     nom: user.nom,
//     prenom: user.prenom,
//     email: user.email,
//     telephone: seedPhone(user.telephone),
//     motDePasse: passwordHash,
//     rolePlateforme: user.role,
//     actif: true,
//   };

//   if (existing) {
//     return prisma.plateformeUtilisateur.update({
//       where: { id: existing.id },
//       data,
//     });
//   }

//   return prisma.plateformeUtilisateur.create({ data });
// }

// async function seedBulkEleves(tenantId, schoolYear, seededClasses, adminId, passwordHash) {
//   const classeByNom = new Map(seededClasses.map((c) => [c.nom, c]));

//   // 66 students across all levels — (nom, prenom, genre, niveauNom, classeNom, dateNaissance)
//   const bulkEleves = [
//     // CI A (5 more besides the 3 already seeded)
//     { prenom: 'Moussa',   nom: 'Diop',    genre: 'M', classe: 'CI A', dob: '2015-03-12', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Fatou',    nom: 'Sow',     genre: 'F', classe: 'CI A', dob: '2015-07-22', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Omar',     nom: 'Faye',    genre: 'M', classe: 'CI A', dob: '2015-01-05', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Coumba',   nom: 'Ndiaye',  genre: 'F', classe: 'CI A', dob: '2015-09-18', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Aliou',    nom: 'Gueye',   genre: 'M', classe: 'CI A', dob: '2015-11-30', phone: SEED_PHONE_NUMBER },
//     // CP A
//     { prenom: 'Ibrahima', nom: 'Thiam',   genre: 'M', classe: 'CP A', dob: '2014-04-14', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Mariama',  nom: 'Fall',    genre: 'F', classe: 'CP A', dob: '2014-08-27', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Cheikh',   nom: 'Mbaye',   genre: 'M', classe: 'CP A', dob: '2014-02-03', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Adja',     nom: 'Sy',      genre: 'F', classe: 'CP A', dob: '2014-12-19', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Modou',    nom: 'Diouf',   genre: 'M', classe: 'CP A', dob: '2014-06-08', phone: SEED_PHONE_NUMBER },
//     // CE1 A
//     { prenom: 'Khady',    nom: 'Camara',  genre: 'F', classe: 'CE1 A', dob: '2013-05-21', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Babacar',  nom: 'Badji',   genre: 'M', classe: 'CE1 A', dob: '2013-10-10', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Seynabou', nom: 'Cisse',   genre: 'F', classe: 'CE1 A', dob: '2013-03-07', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Pape',     nom: 'Toure',   genre: 'M', classe: 'CE1 A', dob: '2013-08-15', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Yacine',   nom: 'Mboup',   genre: 'F', classe: 'CE1 A', dob: '2013-01-29', phone: SEED_PHONE_NUMBER },
//     // CE2 A
//     { prenom: 'Samba',    nom: 'Dione',   genre: 'M', classe: 'CE2 A', dob: '2012-07-04', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Rama',     nom: 'Mendy',   genre: 'F', classe: 'CE2 A', dob: '2012-11-17', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Alioune',  nom: 'Ndoye',   genre: 'M', classe: 'CE2 A', dob: '2012-04-25', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Penda',    nom: 'Samb',    genre: 'F', classe: 'CE2 A', dob: '2012-09-02', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Seydou',   nom: 'Niang',   genre: 'M', classe: 'CE2 A', dob: '2012-02-13', phone: SEED_PHONE_NUMBER },
//     // CM1 A
//     { prenom: 'Aminata',  nom: 'Coly',    genre: 'F', classe: 'CM1 A', dob: '2011-06-16', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Malick',   nom: 'Bassene', genre: 'M', classe: 'CM1 A', dob: '2011-10-28', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Sokhna',   nom: 'Diop',    genre: 'F', classe: 'CM1 A', dob: '2011-03-03', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Tapha',    nom: 'Fall',    genre: 'M', classe: 'CM1 A', dob: '2011-12-20', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Binta',    nom: 'Sow',     genre: 'F', classe: 'CM1 A', dob: '2011-07-09', phone: SEED_PHONE_NUMBER },
//     // CM2 A
//     { prenom: 'Thierno',  nom: 'Gueye',   genre: 'M', classe: 'CM2 A', dob: '2010-05-14', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Mame',     nom: 'Ndiaye',  genre: 'F', classe: 'CM2 A', dob: '2010-09-22', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Assane',   nom: 'Thiam',   genre: 'M', classe: 'CM2 A', dob: '2010-02-17', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Dior',     nom: 'Faye',    genre: 'F', classe: 'CM2 A', dob: '2010-11-05', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Boubacar', nom: 'Mbaye',   genre: 'M', classe: 'CM2 A', dob: '2010-04-30', phone: SEED_PHONE_NUMBER },
//     // 6ème A
//     { prenom: 'Ndiaga',   nom: 'Sarr',    genre: 'M', classe: '6ème A', dob: '2009-08-11', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Aissatou', nom: 'Kane',    genre: 'F', classe: '6ème A', dob: '2009-01-24', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Mor',      nom: 'Diouf',   genre: 'M', classe: '6ème A', dob: '2009-06-06', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Marème',   nom: 'Camara',  genre: 'F', classe: '6ème A', dob: '2009-12-15', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Lamine',   nom: 'Cisse',   genre: 'M', classe: '6ème A', dob: '2009-04-03', phone: SEED_PHONE_NUMBER },
//     // 5ème A
//     { prenom: 'Fatou',    nom: 'Toure',   genre: 'F', classe: '5ème A', dob: '2008-07-19', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Fallou',   nom: 'Ndoye',   genre: 'M', classe: '5ème A', dob: '2008-02-28', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Soda',     nom: 'Samb',    genre: 'F', classe: '5ème A', dob: '2008-10-07', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Saliou',   nom: 'Niang',   genre: 'M', classe: '5ème A', dob: '2008-05-12', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Fanta',    nom: 'Diop',    genre: 'F', classe: '5ème A', dob: '2008-09-23', phone: SEED_PHONE_NUMBER },
//     // 4ème A
//     { prenom: 'Momar',    nom: 'Sy',      genre: 'M', classe: '4ème A', dob: '2007-03-16', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Yaye',     nom: 'Gueye',   genre: 'F', classe: '4ème A', dob: '2007-11-04', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Biram',    nom: 'Fall',    genre: 'M', classe: '4ème A', dob: '2007-06-27', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Maty',     nom: 'Badji',   genre: 'F', classe: '4ème A', dob: '2007-01-09', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Idy',      nom: 'Mendy',   genre: 'M', classe: '4ème A', dob: '2007-08-21', phone: SEED_PHONE_NUMBER },
//     // 3ème A
//     { prenom: 'Rokhaya',  nom: 'Thiam',   genre: 'F', classe: '3ème A', dob: '2006-04-14', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Bocar',    nom: 'Mboup',   genre: 'M', classe: '3ème A', dob: '2006-10-30', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Ndéye',    nom: 'Dione',   genre: 'F', classe: '3ème A', dob: '2006-07-03', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Gora',     nom: 'Coly',    genre: 'M', classe: '3ème A', dob: '2006-02-18', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Mariama',  nom: 'Bassene', genre: 'F', classe: '3ème A', dob: '2006-12-08', phone: SEED_PHONE_NUMBER },
//     // Seconde A
//     { prenom: 'Serigne',  nom: 'Sarr',    genre: 'M', classe: 'Seconde A', dob: '2005-05-25', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Aminata',  nom: 'Ndiaye',  genre: 'F', classe: 'Seconde A', dob: '2005-09-14', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Bamba',    nom: 'Kane',    genre: 'M', classe: 'Seconde A', dob: '2005-03-07', phone: SEED_PHONE_NUMBER },
//     // Première A
//     { prenom: 'Coumba',   nom: 'Diallo',  genre: 'F', classe: 'Première A', dob: '2004-06-11', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Ousmane',  nom: 'Faye',    genre: 'M', classe: 'Première A', dob: '2004-11-02', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Khady',    nom: 'Toure',   genre: 'F', classe: 'Première A', dob: '2004-04-19', phone: SEED_PHONE_NUMBER },
//     // Terminale A
//     { prenom: 'Ibou',     nom: 'Diop',    genre: 'M', classe: 'Terminale A', dob: '2003-08-08', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Fatou',    nom: 'Sall',    genre: 'F', classe: 'Terminale A', dob: '2003-02-22', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Moussa',   nom: 'Camara',  genre: 'M', classe: 'Terminale A', dob: '2003-12-01', phone: SEED_PHONE_NUMBER },
//     // Petite Section A
//     { prenom: 'Lissa',    nom: 'Ndiaye',  genre: 'F', classe: 'Petite Section A', dob: '2021-04-10', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Elhadj',   nom: 'Sow',     genre: 'M', classe: 'Petite Section A', dob: '2021-07-15', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Nena',     nom: 'Gueye',   genre: 'F', classe: 'Petite Section A', dob: '2021-01-28', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Khadim',   nom: 'Fall',    genre: 'M', classe: 'Petite Section A', dob: '2021-10-05', phone: SEED_PHONE_NUMBER },
//     // Moyenne Section A
//     { prenom: 'Tida',     nom: 'Mbaye',   genre: 'F', classe: 'Moyenne Section A', dob: '2020-05-20', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Ousseynou',nom: 'Thiam',   genre: 'M', classe: 'Moyenne Section A', dob: '2020-09-03', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Rouba',    nom: 'Cisse',   genre: 'F', classe: 'Moyenne Section A', dob: '2020-03-17', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Mourtalla', nom: 'Diouf',  genre: 'M', classe: 'Moyenne Section A', dob: '2020-11-29', phone: SEED_PHONE_NUMBER },
//     // Grande Section A
//     { prenom: 'Ndéye',    nom: 'Camara',  genre: 'F', classe: 'Grande Section A', dob: '2019-06-08', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Seybatou', nom: 'Sarr',    genre: 'M', classe: 'Grande Section A', dob: '2019-02-14', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Fatoumata',nom: 'Kane',    genre: 'F', classe: 'Grande Section A', dob: '2019-10-22', phone: SEED_PHONE_NUMBER },
//     { prenom: 'Elton',    nom: 'Diallo',  genre: 'M', classe: 'Grande Section A', dob: '2019-07-31', phone: SEED_PHONE_NUMBER },
//   ];

//   let inscriptionCounter = 100;
//   const createdEleves = [];

//   for (const eleve of bulkEleves) {
//     const email = `${slugify(eleve.prenom)}.${slugify(eleve.nom)}.${inscriptionCounter}@demo.noura.sn`;
//     const username = `${slugify(eleve.prenom)}.${slugify(eleve.nom)}.${inscriptionCounter}`;
//     const classe = classeByNom.get(eleve.classe);
//     if (!classe) {
//       console.warn(`Classe not found: ${eleve.classe}`);
//       inscriptionCounter += 1;
//       continue;
//     }

//     const user = await upsertTenantUser(tenantId, {
//       prenom: eleve.prenom,
//       nom: eleve.nom,
//       role: 'ELEVE',
//       telephone: seedPhone(eleve.phone),
//       email,
//       username,
//       matricule: `ELV-2025-${String(inscriptionCounter).padStart(4, '0')}`,
//       dateNaissance: new Date(eleve.dob),
//       genre: eleve.genre,
//       dateInscription: new Date('2025-10-07'),
//       classeId: classe.id,
//     }, passwordHash);

//     await upsertById(
//       'inscription',
//       { numeroInscription: `INS-${SCHOOL_YEAR}-${String(inscriptionCounter).padStart(4, '0')}` },
//       {
//         tenantId,
//         numeroInscription: `INS-${SCHOOL_YEAR}-${String(inscriptionCounter).padStart(4, '0')}`,
//         eleveId: user.id,
//         classeId: classe.id,
//         anneeAcademiqueId: schoolYear.id,
//         statut: 'ACTIF',
//         creePar: adminId,
//       },
//       {
//         tenantId,
//         eleveId: user.id,
//         classeId: classe.id,
//         anneeAcademiqueId: schoolYear.id,
//         statut: 'ACTIF',
//         creePar: adminId,
//       },
//     );

//     createdEleves.push(user);
//     inscriptionCounter += 1;
//   }

//   return createdEleves;
// }

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const tenant = await upsertById(
    'tenant',
    { slug: TENANT_SLUG },
    {
      slug: TENANT_SLUG,
      codeAccesEleve:       TENANT_CODE_ELEVE,
      codeAccesEnseignant:  TENANT_CODE_ENSEIGNANT,
      codeAccesCaissier:    TENANT_CODE_CAISSIER,
      codeAccesAdmin:       TENANT_CODE_ADMIN,
      codeAccesSurveillant: TENANT_CODE_SURVEILLANT,
      codeAccesRh:          TENANT_CODE_RH,
      nom: 'Ecole Noura Dakar',
      emailContact: 'contact@demo.noura.sn',
      telephone: SEED_PHONE_NUMBER,
      adresse: 'Dakar, Senegal',
      plan: 'TRIAL',
      actif: true,
    },
    {
      nom: 'Ecole Noura Dakar',
      emailContact: 'contact@demo.noura.sn',
      telephone: SEED_PHONE_NUMBER,
      adresse: 'Dakar, Senegal',
      plan: 'TRIAL',
      actif: true,
    },
  );

  /* ===== SEEDS DÉSACTIVÉS : structure académique, cycles, niveaux, année, salles, classes,
     matières et comptes plateforme. On ne crée plus que le tenant et les utilisateurs liés. =====
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
    { role: 'SUPER_ADMIN', prenom: 'Aissatou', nom: 'Diop', telephone: SEED_PHONE_NUMBER, email: 'aissatou.diop@demo.noura.sn' },
    { role: 'SUPER_ADMIN', prenom: 'Bamba', nom: 'Diallo', telephone: SEED_PHONE_NUMBER, email: 'bamba.diallo@demo.noura.sn' },
    { role: 'GESTIONNAIRE', prenom: 'Mariam', nom: 'Sow', telephone: SEED_PHONE_NUMBER, email: 'mariam.sow@demo.noura.sn' },
    { role: 'GESTIONNAIRE', prenom: 'Cheikh', nom: 'Ndiaye', telephone: SEED_PHONE_NUMBER, email: 'cheikh.ndiaye@demo.noura.sn' },
  ];
  ===== FIN SEEDS DÉSACTIVÉS (structure + comptes plateforme) ===== */

  const tenantUsers = [
    { role: 'ADMIN', prenom: 'Khady', nom: 'Ba', telephone: SEED_PHONE_NUMBER, email: 'khady.ba@demo.noura.sn', username: '22113543' }, // Directeur — identifiant 22113543
    { role: 'ADMIN', prenom: 'Mamadou', nom: 'Fall', telephone: SEED_PHONE_NUMBER, email: 'mamadou.fall@demo.noura.sn', username: 'mamadou.fall' },
    { role: 'CAISSIER', prenom: 'Fatou', nom: 'Cisse', telephone: SEED_PHONE_NUMBER, email: 'fatou.cisse@demo.noura.sn', username: 'fatou.cisse' },
    { role: 'CAISSIER', prenom: 'Ibrahima', nom: 'Kane', telephone: SEED_PHONE_NUMBER, email: 'ibrahima.kane@demo.noura.sn', username: 'ibrahima.kane' },
    { role: 'SURVEILLANT', prenom: 'Rokhaya', nom: 'Diallo', telephone: SEED_PHONE_NUMBER, email: 'rokhaya.diallo@demo.noura.sn', username: 'rokhaya.diallo' },
    { role: 'SURVEILLANT', prenom: 'Pape', nom: 'Gaye', telephone: SEED_PHONE_NUMBER, email: 'pape.gaye@demo.noura.sn', username: 'pape.gaye' },
    { role: 'ENSEIGNANT', prenom: 'Ousmane', nom: 'Diouf', telephone: SEED_PHONE_NUMBER, email: 'ousmane.diouf@demo.noura.sn', username: 'ousmane.diouf', specialite: 'Mathematiques', dateEmbauche: new Date('2023-09-01') },
    { role: 'ENSEIGNANT', prenom: 'Adja', nom: 'Sarr', telephone: SEED_PHONE_NUMBER, email: 'adja.sarr@demo.noura.sn', username: 'adja.sarr', specialite: 'Francais', dateEmbauche: new Date('2024-10-01') },
    { role: 'ELEVE', prenom: 'Amadou', nom: 'Kane', telephone: SEED_PHONE_NUMBER, email: 'amadou.kane@demo.noura.sn', username: 'amadou.kane', matricule: 'ELV-2025-0001', dateNaissance: new Date('2014-02-18'), genre: 'M', numeroUrgence: SEED_PHONE_NUMBER, dateInscription: new Date('2025-10-05'), classeId: null },
    { role: 'ELEVE', prenom: 'Awa', nom: 'Diallo', telephone: SEED_PHONE_NUMBER, email: 'awa.diallo@demo.noura.sn', username: 'awa.diallo', matricule: 'ELV-2025-0002', dateNaissance: new Date('2014-06-09'), genre: 'F', numeroUrgence: SEED_PHONE_NUMBER, dateInscription: new Date('2025-10-05'), classeId: null },
    { role: 'ELEVE', prenom: 'amadou', nom: 'Ba', telephone: SEED_PHONE_NUMBER, email: 'baamadou@gmail.com', username: 'amadou.ba', matricule: null, dateNaissance: new Date('2014-05-20'), genre: 'M', numeroUrgence: SEED_PHONE_NUMBER, dateInscription: new Date('2025-10-05'), classeId: null },
    { role: 'PARENT', prenom: 'Mamadou', nom: 'Ndiaye', telephone: SEED_PHONE_NUMBER, email: 'mamadou.ndiaye@demo.noura.sn', username: 'mamadou.ndiaye', profession: 'Commercant', lieuTravail: 'Sandaga', telephoneTravail: SEED_PHONE_NUMBER, lienParente: 'PERE' },
    { role: 'PARENT', prenom: 'Aminata', nom: 'Ba', telephone: SEED_PHONE_NUMBER, email: 'aminata.ba@demo.noura.sn', username: 'aminata.ba', profession: 'Assistante de direction', lieuTravail: 'Plateau', telephoneTravail: SEED_PHONE_NUMBER, lienParente: 'MERE' },
    { role: 'PARENT', prenom: 'Ibrahima', nom: 'Ba', telephone: SEED_PHONE_NUMBER, email: 'ibrahima.ba@demo.noura.sn', username: 'ibrahima.ba', profession: 'Fonctionnaire', lieuTravail: 'Dakar', telephoneTravail: SEED_PHONE_NUMBER, lienParente: 'PERE' },
    { role: 'RH', prenom: 'Boubacar', nom: 'Sy', telephone: SEED_PHONE_NUMBER, email: 'boubacar.sy@demo.noura.sn', username: 'boubacar.sy' },
    { role: 'RH', prenom: 'Khadim', nom: 'Thiam', telephone: SEED_PHONE_NUMBER, email: 'khadim.thiam@demo.noura.sn', username: 'khadim.thiam' },
  ];

  // ===== Comptes plateforme désactivés (sans tenantId) =====
  // const platformRecords = [];
  // for (const user of platformUsers) {
  //   platformRecords.push(await upsertPlatformUser(user, passwordHash));
  // }

  const tenantRecords = [];
  for (const user of tenantUsers) {
    tenantRecords.push(await upsertTenantUser(tenant.id, user, passwordHash));
  }

  /* ===== POST-TRAITEMENTS DÉSACTIVÉS : affectations profs, personnel, absences, surveillants,
     inscriptions, notes, liens parents, réclamations, EDT/cours, calendrier, élèves en masse. =====
  const recordsByEmail = new Map(tenantRecords.map((record) => [record.email, record]));
  const teacherOusmane = recordsByEmail.get('ousmane.diouf@demo.noura.sn');
  const teacherAdja = recordsByEmail.get('adja.sarr@demo.noura.sn');
  const adminKhady = recordsByEmail.get('khady.ba@demo.noura.sn');
  const surveillantRokhaya = recordsByEmail.get('rokhaya.diallo@demo.noura.sn');
  const surveillantPape = recordsByEmail.get('pape.gaye@demo.noura.sn');
  const eleveAmadou = recordsByEmail.get('amadou.kane@demo.noura.sn');
  const eleveAwa = recordsByEmail.get('awa.diallo@demo.noura.sn');
  const eleveAmadouBa = recordsByEmail.get('baamadou@gmail.com');
  const parentMamadou = recordsByEmail.get('mamadou.ndiaye@demo.noura.sn');
  const parentAminata = recordsByEmail.get('aminata.ba@demo.noura.sn');
  const parentIbrahimaBa = recordsByEmail.get('ibrahima.ba@demo.noura.sn');

  // CI A → Adja (prof primaire unique), CP A → pas de prof dans la démo.
  if (teacherAdja) {
    await prisma.classe.update({ where: { id: classeCIA.id }, data: { professeurResponsableId: teacherAdja.id } });
  }
  await prisma.classe.update({ where: { id: classeCPA.id }, data: { professeurResponsableId: null } });

  // ── Nettoyage : Adja=primaire CI A, Ousmane=collège/lycée ──
  if (teacherAdja && teacherOusmane) {
    // 1. Supprimer Ousmane des classes maternelle/primaire.
    const ousmaneSimple = await prisma.cours.findMany({
      where: {
        enseignantId: teacherOusmane.id,
        classe: { niveau: { cycle: { code: { in: ['MATERNELLE', 'PRIMAIRE'] } } } },
      },
      select: { id: true },
    });
    if (ousmaneSimple.length) {
      await prisma.emploiDuTemps.deleteMany({ where: { coursId: { in: ousmaneSimple.map((c) => c.id) } } });
      await prisma.cours.deleteMany({ where: { id: { in: ousmaneSimple.map((c) => c.id) } } });
    }
    await prisma.matiereClasse.deleteMany({
      where: {
        enseignantId: teacherOusmane.id,
        classe: { niveau: { cycle: { code: { in: ['MATERNELLE', 'PRIMAIRE'] } } } },
      },
    });

    // 2. Supprimer tous les cours de CP A (aucun prof assigné dans la démo)
    const coursCPA = await prisma.cours.findMany({ where: { classeId: classeCPA.id }, select: { id: true } });
    if (coursCPA.length) {
      await prisma.emploiDuTemps.deleteMany({ where: { coursId: { in: coursCPA.map((c) => c.id) } } });
      await prisma.cours.deleteMany({ where: { id: { in: coursCPA.map((c) => c.id) } } });
    }
    await prisma.matiereClasse.deleteMany({ where: { classeId: classeCPA.id } });

    // 3. Supprimer les cours de Adja hors maternelle/primaire.
    const adjaNonSimple = await prisma.cours.findMany({
      where: {
        enseignantId: teacherAdja.id,
        classe: { niveau: { cycle: { code: { notIn: ['MATERNELLE', 'PRIMAIRE'] } } } },
      },
      select: { id: true },
    });
    if (adjaNonSimple.length) {
      await prisma.emploiDuTemps.deleteMany({ where: { coursId: { in: adjaNonSimple.map((c) => c.id) } } });
      await prisma.cours.deleteMany({ where: { id: { in: adjaNonSimple.map((c) => c.id) } } });
    }
    await prisma.matiereClasse.deleteMany({
      where: {
        enseignantId: teacherAdja.id,
        classe: { niveau: { cycle: { code: { notIn: ['MATERNELLE', 'PRIMAIRE'] } } } },
      },
    });
    await prisma.emploiDuTemps.deleteMany({ where: { tenantId: tenant.id, classeId: null } });

    // 4. Supprimer les stagiaires (pas de sens pour cycle simple)
    await prisma.classeStagiaire.deleteMany({ where: { classeId: null } });
    await prisma.classeStagiaire.deleteMany({ where: { classeId: classeCPA.id } });
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
      },
      {
        tenantId: tenant.id,
        numeroMatricule: personnel.numeroMatricule,
        typeContrat: personnel.typeContrat,
        dateEmbauche: personnel.dateEmbauche,
        salaire: personnel.salaire,
      },
    );
  }

  async function seedAbsencePersonnel(user, items) {
    if (!user) return;
    const personnel = await prisma.personnel.findUnique({
      where: { utilisateurId: user.id },
      select: { id: true },
    });
    if (!personnel) return;

    for (const item of items) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "AbsencePersonnel"
         WHERE "tenantId" = $1::uuid
           AND "personnelId" = $2::uuid
           AND "dateDebut" = $3::date
           AND "motif" = $4`,
        tenant.id,
        personnel.id,
        item.dateDebut,
        item.motif,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AbsencePersonnel"
          ("id", "tenantId", "personnelId", "dateDebut", "dateFin", "heureDebut", "heureFin", "motif", "typeAbsence", "justificatifUrl", "statut", "validePar", "createdAt", "updatedAt")
         VALUES
          (gen_random_uuid(), $1::uuid, $2::uuid, $3::date, $4::date, $5, $6, $7, $8::"TypeAbsencePersonnel", $9, $10::"StatutAbsencePersonnel", $11::uuid, now(), now())`,
        tenant.id,
        personnel.id,
        item.dateDebut,
        item.dateFin,
        item.heureDebut ?? null,
        item.heureFin ?? null,
        item.motif,
        item.typeAbsence,
        item.justificatifUrl ?? null,
        item.statut,
        item.validePar ?? null,
      );
    }
  }

  await seedAbsencePersonnel(teacherAdja, [
    {
      dateDebut: '2026-05-27',
      dateFin: '2026-05-27',
      heureDebut: '08:00',
      heureFin: '12:00',
      typeAbsence: 'MALADIE',
      statut: 'EN_ATTENTE',
      motif: 'Consultation médicale le matin.',
      justificatifUrl: 'https://demo.noura.sn/justificatifs/absence-adja-medical.pdf',
    },
    {
      dateDebut: '2026-05-16',
      dateFin: '2026-05-16',
      heureDebut: '15:00',
      heureFin: '17:00',
      typeAbsence: 'AUTRE',
      statut: 'APPROUVEE',
      motif: 'Rendez-vous administratif validé par la direction.',
      validePar: adminKhady?.id ?? null,
    },
    {
      dateDebut: '2026-04-30',
      dateFin: '2026-05-02',
      typeAbsence: 'CONGE',
      statut: 'REJETEE',
      motif: 'Demande de congé personnel hors délai.',
    },
  ]);

  await seedAbsencePersonnel(teacherOusmane, [
    {
      dateDebut: '2026-05-29',
      dateFin: '2026-05-29',
      heureDebut: '10:00',
      heureFin: '11:30',
      typeAbsence: 'AUTRE',
      statut: 'EN_ATTENTE',
      motif: 'Convocation familiale urgente.',
    },
    {
      dateDebut: '2026-05-20',
      dateFin: '2026-05-20',
      heureDebut: '14:00',
      heureFin: '16:30',
      typeAbsence: 'MALADIE',
      statut: 'APPROUVEE',
      motif: 'Repos médical de l’après-midi.',
      justificatifUrl: 'https://demo.noura.sn/justificatifs/absence-ousmane-medical.pdf',
      validePar: adminKhady?.id ?? null,
    },
  ]);

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
        classeId: null,
        anneeAcademiqueId: schoolYear.id,
        statut: 'ACTIF',
        creePar: adminKhady.id,
      },
      {
        tenantId: tenant.id,
        eleveId: student.id,
        classeId: null,
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

  // Seed: amadou Ba — historical parcours + current inscription + notes + parent link
  if (eleveAmadouBa) {
    // Historical school years + classes (parcours complet CI → CP → CE1 → CE2 → CM1 → CM2 → 6ème)
    const historicalYears = [
      { libelle: '2019-2020', debut: new Date('2019-10-01'), fin: new Date('2020-07-31'), niveauCode: 'PS', classeNom: 'Petite Section A' },
      { libelle: '2020-2021', debut: new Date('2020-10-01'), fin: new Date('2021-07-31'), niveauCode: 'MS', classeNom: 'Moyenne Section A' },
      { libelle: '2021-2022', debut: new Date('2021-10-01'), fin: new Date('2022-07-31'), niveauCode: 'GS', classeNom: 'Grande Section A' },
      { libelle: '2022-2023', debut: new Date('2022-10-01'), fin: new Date('2023-07-31'), niveauCode: 'CI', classeNom: 'CI A (2022-2023)' },
      { libelle: '2023-2024', debut: new Date('2023-10-01'), fin: new Date('2024-07-31'), niveauCode: 'CP', classeNom: 'CP A (2023-2024)' },
      { libelle: '2024-2025', debut: new Date('2024-10-01'), fin: new Date('2025-07-31'), niveauCode: 'CE1', classeNom: 'CE1 A (2024-2025)' },
    ];

    for (let i = 0; i < historicalYears.length; i += 1) {
      const yr = historicalYears[i];
      const pastYear = await upsertById(
        'anneeAcademique',
        { tenantId: tenant.id, libelle: yr.libelle },
        { tenantId: tenant.id, libelle: yr.libelle, dateDebut: yr.debut, dateFin: yr.fin, estCourante: false, actif: false },
        { dateDebut: yr.debut, dateFin: yr.fin, estCourante: false, actif: false },
      );

      const niveauPast = await prisma.niveau.findFirst({ where: { tenantId: tenant.id, code: yr.niveauCode } });
      if (!niveauPast) continue;

      const classePast = await upsertById(
        'classe',
        { tenantId: tenant.id, nom: yr.classeNom, anneeAcademiqueId: pastYear.id },
        { tenantId: tenant.id, nom: yr.classeNom, niveauId: niveauPast.id, anneeAcademiqueId: pastYear.id, effectifMax: 30, actif: false },
        { niveauId: niveauPast.id, effectifMax: 30, actif: false },
      );

      await upsertById(
        'inscription',
        { numeroInscription: `INS-${yr.libelle}-AMADOU` },
        {
          tenantId: tenant.id,
          numeroInscription: `INS-${yr.libelle}-AMADOU`,
          eleveId: eleveAmadouBa.id,
          classeId: classePast.id,
          anneeAcademiqueId: pastYear.id,
          statut: 'TERMINE',
          creePar: adminKhady.id,
        },
        {
          tenantId: tenant.id,
          eleveId: eleveAmadouBa.id,
          classeId: classePast.id,
          anneeAcademiqueId: pastYear.id,
          statut: 'TERMINE',
          creePar: adminKhady.id,
        },
      );
    }

    // Current year inscription in CI A (2025-2026)
    await upsertById(
      'inscription',
      { numeroInscription: `INS-${SCHOOL_YEAR}-0003` },
      {
        tenantId: tenant.id,
        numeroInscription: `INS-${SCHOOL_YEAR}-0003`,
        eleveId: eleveAmadouBa.id,
        classeId: null,
        anneeAcademiqueId: schoolYear.id,
        statut: 'ACTIF',
        creePar: adminKhady.id,
      },
      {
        tenantId: tenant.id,
        eleveId: eleveAmadouBa.id,
        classeId: null,
        anneeAcademiqueId: schoolYear.id,
        statut: 'ACTIF',
        creePar: adminKhady.id,
      },
    );

    // 18 notes (current year) averaging 15.5/20
    // Maths: 15, 16, 16 per trimestre; Français: 15, 15, 16 per trimestre → 279/18 = 15.5
    for (const period of ['SEMESTRE_1', 'SEMESTRE_2', 'SEMESTRE_3']) {
      await upsertNote(tenant.id, eleveAmadouBa.id, matiereMaths.id, period, 'DEVOIR', 'Devoir 1', 15, 20);
      await upsertNote(tenant.id, eleveAmadouBa.id, matiereMaths.id, period, 'DEVOIR', 'Devoir 2', 16, 20);
      await upsertNote(tenant.id, eleveAmadouBa.id, matiereMaths.id, period, 'COMPOSITION', 'Composition', 16, 20);
      await upsertNote(tenant.id, eleveAmadouBa.id, matiereFrancais.id, period, 'DEVOIR', 'Devoir 1', 15, 20);
      await upsertNote(tenant.id, eleveAmadouBa.id, matiereFrancais.id, period, 'DEVOIR', 'Devoir 2', 15, 20);
      await upsertNote(tenant.id, eleveAmadouBa.id, matiereFrancais.id, period, 'COMPOSITION', 'Composition', 16, 20);
    }
  }

  if (eleveAmadouBa && parentIbrahimaBa) {
    await syncEleveParent(eleveAmadouBa.id, parentIbrahimaBa.id, tenant.id);
  }

  const reclamationSeeds = [
    {
      eleve: eleveAmadou,
      matiere: matiereFrancais,
      trimestre: 'SEMESTRE_1',
      typeEvaluation: 'DEVOIR',
      commentaire: 'Devoir 1',
      motif: 'La note de français du devoir 1 semble différente de la copie remise.',
      statut: 'EN_ATTENTE',
      pieceJointeUrl: 'https://demo.noura.sn/justificatifs/copie-francais-amadou.pdf',
    },
    {
      eleve: eleveAwa,
      matiere: matiereMaths,
      trimestre: 'SEMESTRE_2',
      typeEvaluation: 'COMPOSITION',
      commentaire: 'Composition',
      motif: 'Demande de vérification du total de la composition de mathématiques.',
      statut: 'TRAITEE',
      reponse: 'Vérification effectuée, la note enregistrée est conforme.',
    },
    {
      eleve: eleveAmadouBa,
      matiere: matiereFrancais,
      trimestre: 'SEMESTRE_3',
      typeEvaluation: 'DEVOIR',
      commentaire: 'Devoir 2',
      motif: 'Le parent demande une explication sur la correction du devoir de français.',
      statut: 'EN_ATTENTE',
      pieceJointeUrl: 'https://demo.noura.sn/justificatifs/devoir-francais-amadou-ba.jpg',
    },
  ];
  for (const item of reclamationSeeds) {
    if (!item.eleve) continue;
    const note = await prisma.note.findFirst({
      where: {
        tenantId: tenant.id,
        eleveId: item.eleve.id,
        matiereId: item.matiere.id,
        trimestre: item.trimestre,
        typeEvaluation: item.typeEvaluation,
        commentaire: item.commentaire,
      },
      select: { id: true },
    });
    await upsertReclamation(
      tenant.id,
      item.eleve.id,
      item.motif,
      item.statut,
      note?.id ?? null,
      item.reponse ?? null,
      item.pieceJointeUrl ?? null,
    );
  }

  // ── Matieres supplémentaires ────────────────────────────────────────
  const matiereAnglais = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'ANG' },
    { tenantId: tenant.id, code: 'ANG', libelle: 'Anglais', actif: true },
    { libelle: 'Anglais', actif: true },
  );
  const matiereEPS = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'EPS' },
    { tenantId: tenant.id, code: 'EPS', libelle: 'EPS', actif: true },
    { libelle: 'EPS', actif: true },
  );
  const matiereHistGeo = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'HG' },
    { tenantId: tenant.id, code: 'HG', libelle: 'Histoire-Géographie', actif: true },
    { libelle: 'Histoire-Géographie', actif: true },
  );
  const matiereSciences = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'SVT' },
    { tenantId: tenant.id, code: 'SVT', libelle: 'Sciences de la vie et de la terre', actif: true },
    { libelle: 'Sciences de la vie et de la terre', actif: true },
  );
  const matierePhysChi = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'PC' },
    { tenantId: tenant.id, code: 'PC', libelle: 'Physique-Chimie', actif: true },
    { libelle: 'Physique-Chimie', actif: true },
  );
  const matiereArabe = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'AR' },
    { tenantId: tenant.id, code: 'AR', libelle: 'Arabe', actif: true },
    { libelle: 'Arabe', actif: true },
  );
  const matiereCoursGeneral = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'GEN' },
    { tenantId: tenant.id, code: 'GEN', libelle: 'Cours général', actif: true },
    { libelle: 'Cours général', actif: true },
  );

  // Helper to upsert emploi du temps slot
  async function upsertEdt(classeId, coursId, jourSemaine, heureDebut, heureFin) {
    const existing = await prisma.emploiDuTemps.findFirst({
      where: { tenantId: tenant.id, classeId, coursId, jourSemaine, heureDebut },
    });
    if (existing) return existing;
    return prisma.emploiDuTemps.create({
      data: {
        tenantId: tenant.id,
        classeId,
        coursId,
        jourSemaine,
        heureDebut,
        heureFin,
        publie: true,
      },
    });
  }

  // Helper to upsert a cours + matiereClasse for a classe
  async function upsertCours(matiereId, enseignantId, classeId, volumeHebdo, coeff) {
    const c = await upsertById(
      'cours',
      { matiereId, enseignantId, classeId, anneeAcademiqueId: schoolYear.id },
      { tenantId: tenant.id, matiereId, classeId, enseignantId, anneeAcademiqueId: schoolYear.id, volumeHoraireHebdo: volumeHebdo, coefficient: coeff },
      { tenantId: tenant.id, volumeHoraireHebdo: volumeHebdo, coefficient: coeff },
    );
    await upsertById(
      'matiereClasse',
      { matiereId, classeId, enseignantId, anneeAcademiqueId: schoolYear.id },
      { tenantId: tenant.id, matiereId, classeId, enseignantId, anneeAcademiqueId: schoolYear.id, anneeScolaire: SCHOOL_YEAR, volumeHoraire: volumeHebdo },
      { tenantId: tenant.id, anneeScolaire: SCHOOL_YEAR, volumeHoraire: volumeHebdo },
    );
    return c;
  }

  // ── EDT pour CI A (primaire : matières sur créneaux fixes) ─────────
  if (teacherAdja) {
    await prisma.emploiDuTemps.deleteMany({ where: { tenantId: tenant.id, classeId: null } });
    const existingGeneral = await prisma.cours.findMany({
      where: { tenantId: tenant.id, classeId: null, enseignantId: teacherAdja.id, matiereId: matiereCoursGeneral.id },
      select: { id: true },
    });
    if (existingGeneral.length) {
      await prisma.emploiDuTemps.deleteMany({ where: { coursId: { in: existingGeneral.map((c) => c.id) } } });
      await prisma.cours.deleteMany({ where: { id: { in: existingGeneral.map((c) => c.id) } } });
    }
    await prisma.matiereClasse.deleteMany({
      where: { tenantId: tenant.id, classeId: null, enseignantId: teacherAdja.id, matiereId: matiereCoursGeneral.id },
    });

    const coursFrancaisPrimaire = await upsertCours(matiereFrancais.id, teacherAdja.id, classeCIA.id, 6, 2);
    const coursMathsPrimaire = await upsertCours(matiereMaths.id, teacherAdja.id, classeCIA.id, 5, 3);
    const coursLecturePrimaire = await upsertCours(matiereLecture.id, teacherAdja.id, classeCIA.id, 4, 1);
    const coursArabePrimaire = await upsertCours(matiereArabe.id, teacherAdja.id, classeCIA.id, 3, 1);
    const coursEPSPrimaire = await upsertCours(matiereEPS.id, teacherAdja.id, classeCIA.id, 2, 1);
    const coursEveilPrimaire = await upsertCours(matiereSciences.id, teacherAdja.id, classeCIA.id, 2, 1);

    const primarySlots = [
      ['LUNDI', coursFrancaisPrimaire.id, '08:00', '10:00'],
      ['LUNDI', coursMathsPrimaire.id, '10:00', '12:00'],
      ['LUNDI', coursLecturePrimaire.id, '15:00', '16:00'],
      ['LUNDI', coursEPSPrimaire.id, '16:00', '17:00'],
      ['MARDI', coursMathsPrimaire.id, '08:00', '10:00'],
      ['MARDI', coursFrancaisPrimaire.id, '10:00', '12:00'],
      ['MARDI', coursArabePrimaire.id, '15:00', '16:00'],
      ['MARDI', coursLecturePrimaire.id, '16:00', '17:00'],
      ['MERCREDI', coursFrancaisPrimaire.id, '08:00', '10:00'],
      ['MERCREDI', coursMathsPrimaire.id, '10:00', '12:00'],
      ['JEUDI', coursMathsPrimaire.id, '08:00', '10:00'],
      ['JEUDI', coursLecturePrimaire.id, '10:00', '12:00'],
      ['JEUDI', coursFrancaisPrimaire.id, '15:00', '16:00'],
      ['JEUDI', coursArabePrimaire.id, '16:00', '17:00'],
      ['VENDREDI', coursFrancaisPrimaire.id, '08:00', '10:00'],
      ['VENDREDI', coursEveilPrimaire.id, '10:00', '12:00'],
      ['VENDREDI', coursMathsPrimaire.id, '15:00', '16:00'],
      ['VENDREDI', coursLecturePrimaire.id, '16:00', '17:00'],
    ];
    for (const [jour, coursId, debut, fin] of primarySlots) {
      await upsertEdt(classeCIA.id, coursId, jour, debut, fin);
    }
  }
  // CP A : aucun prof assigné dans la démo → pas de cours ni d'EDT

  // ── 5ème A — Ousmane : Maths + Anglais ──────────────────────────────
  const classe5emeA = seededClasses.find((c) => c.nom === '5ème A');
  if (classe5emeA && teacherOusmane) {
    const cours5Maths   = await upsertCours(matiereMaths.id,   teacherOusmane.id, classe5emeA.id, 4, 4);
    const cours5Anglais = await upsertCours(matiereAnglais.id, teacherOusmane.id, classe5emeA.id, 3, 2);
    await upsertEdt(classe5emeA.id, cours5Maths.id,   'LUNDI',    '14:00', '15:30');
    await upsertEdt(classe5emeA.id, cours5Maths.id,   'MERCREDI', '08:00', '09:30');
    await upsertEdt(classe5emeA.id, cours5Anglais.id, 'LUNDI',    '10:00', '11:00');
    await upsertEdt(classe5emeA.id, cours5Anglais.id, 'JEUDI',    '10:00', '11:00');
    await upsertEdt(classe5emeA.id, cours5Anglais.id, 'VENDREDI', '10:00', '11:00');
  }

  // ── 3ème A — Ousmane : Maths + Physique-Chimie ──────────────────────
  const classe3emeA = seededClasses.find((c) => c.nom === '3ème A');
  if (classe3emeA && teacherOusmane) {
    const cours3Maths = await upsertCours(matiereMaths.id,   teacherOusmane.id, classe3emeA.id, 5, 4);
    const cours3PC    = await upsertCours(matierePhysChi.id, teacherOusmane.id, classe3emeA.id, 3, 3);
    await upsertEdt(classe3emeA.id, cours3Maths.id, 'LUNDI',    '08:00', '09:30');
    await upsertEdt(classe3emeA.id, cours3Maths.id, 'MARDI',    '14:00', '15:30');
    await upsertEdt(classe3emeA.id, cours3Maths.id, 'JEUDI',    '08:00', '09:30');
    await upsertEdt(classe3emeA.id, cours3PC.id,    'MARDI',    '10:00', '11:30');
    await upsertEdt(classe3emeA.id, cours3PC.id,    'VENDREDI', '10:00', '11:30');
  }

  // ── 6ème A — Ousmane : Maths ─────────────────────────────────────────
  const classe6emeA = seededClasses.find((c) => c.nom === '6ème A');
  if (classe6emeA && teacherOusmane) {
    const cours6Maths = await upsertCours(matiereMaths.id, teacherOusmane.id, classe6emeA.id, 4, 4);
    await upsertEdt(classe6emeA.id, cours6Maths.id, 'LUNDI',    '08:00', '09:30');
    await upsertEdt(classe6emeA.id, cours6Maths.id, 'JEUDI',    '08:00', '09:30');
    await upsertEdt(classe6emeA.id, cours6Maths.id, 'MERCREDI', '10:00', '11:30');
  }

  // ── Lycée — Ousmane : Maths + Physique-Chimie ───────────────────────
  const classeSecondeA = seededClasses.find((c) => c.nom === 'Seconde A');
  const classePremiereA = seededClasses.find((c) => c.nom === 'Première A');
  const classeTerminaleA = seededClasses.find((c) => c.nom === 'Terminale A');
  if (teacherOusmane && classeSecondeA) {
    const cours2Maths = await upsertCours(matiereMaths.id, teacherOusmane.id, classeSecondeA.id, 5, 4);
    const cours2PC    = await upsertCours(matierePhysChi.id, teacherOusmane.id, classeSecondeA.id, 3, 3);
    await upsertEdt(classeSecondeA.id, cours2Maths.id, 'MARDI', '08:00', '09:30');
    await upsertEdt(classeSecondeA.id, cours2Maths.id, 'JEUDI', '10:00', '11:30');
    await upsertEdt(classeSecondeA.id, cours2PC.id,    'VENDREDI', '15:00', '16:30');
  }
  if (teacherOusmane && classePremiereA) {
    const cours1Maths = await upsertCours(matiereMaths.id, teacherOusmane.id, classePremiereA.id, 5, 4);
    await upsertEdt(classePremiereA.id, cours1Maths.id, 'LUNDI', '15:00', '16:30');
    await upsertEdt(classePremiereA.id, cours1Maths.id, 'MERCREDI', '15:00', '16:30');
  }
  if (teacherOusmane && classeTerminaleA) {
    const coursTMaths = await upsertCours(matiereMaths.id, teacherOusmane.id, classeTerminaleA.id, 6, 5);
    await upsertEdt(classeTerminaleA.id, coursTMaths.id, 'MARDI', '15:00', '16:30');
    await upsertEdt(classeTerminaleA.id, coursTMaths.id, 'SAMEDI', '10:00', '11:30');
  }

  // ── Matières supplémentaires Maternelle/Primaire ───────────────────
  const matiereEveil = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'EVEIL' },
    { tenantId: tenant.id, code: 'EVEIL', libelle: 'Éveil', actif: true },
    { libelle: 'Éveil', actif: true },
  );
  const matiereMotricite = await upsertById(
    'matiere',
    { tenantId: tenant.id, code: 'MOTR' },
    { tenantId: tenant.id, code: 'MOTR', libelle: 'Motricité', actif: true },
    { libelle: 'Motricité', actif: true },
  );

  // Les matières du primaire restent disponibles, mais Adja n'est plus seedée sur ces classes.

  // ── Nettoyage : s'assurer que les classes non affectées n'ont aucun prof ──
  // Dans la démo, seule CI A (Adja) a un prof responsable pour le cycle primaire/maternelle.
  const unassignedSimpleClasses = ['CP A', 'CE1 A', 'CE2 A', 'CM1 A', 'CM2 A', 'Petite Section A', 'Moyenne Section A', 'Grande Section A'];
  for (const nom of unassignedSimpleClasses) {
    const cl = seededClasses.find((c) => c.nom === nom);
    if (!cl) continue;
    await prisma.classe.update({ where: { id: cl.id }, data: { professeurResponsableId: null } });
    const wrongCours = await prisma.cours.findMany({ where: { classeId: cl.id }, select: { id: true } });
    if (wrongCours.length) {
      await prisma.emploiDuTemps.deleteMany({ where: { coursId: { in: wrongCours.map((c) => c.id) } } });
      await prisma.cours.deleteMany({ where: { id: { in: wrongCours.map((c) => c.id) } } });
    }
    await prisma.matiereClasse.deleteMany({ where: { classeId: cl.id } });
  }

  const calendrierEvents = await seedCalendrierScolaire(tenant.id);

  const bulkElevesCreated = await seedBulkEleves(tenant.id, schoolYear, seededClasses, adminKhady.id, passwordHash);

  console.log(`Tenant: ${tenant.nom} (${tenant.slug})`);
  console.log(`Tenant ID: ${tenant.id}`);
  console.log(`School year: ${SCHOOL_YEAR}`);
  console.log(`Password used for all generated accounts: ${PASSWORD}`);
  console.log('');

  console.log('Platform accounts');
  for (const user of platformRecords) {
    console.log(`- ${user.prenom} ${user.nom} | ${user.email} | password=${PASSWORD}`);
  }

  const ROLE_URL = {
    ELEVE:       `/#/${TENANT_CODE_ELEVE}`,
    ENSEIGNANT:  `/#/${TENANT_CODE_ENSEIGNANT}`,
    CAISSIER:    `/#/${TENANT_CODE_CAISSIER}`,
    ADMIN:       `/#/${TENANT_CODE_ADMIN}`,
    GESTIONNAIRE:`/#/${TENANT_CODE_ADMIN}`,
    SURVEILLANT: `/#/${TENANT_CODE_SURVEILLANT}`,
    RH:          `/#/${TENANT_CODE_RH}`,
  };

  console.log('');
  console.log('Tenant accounts');
  for (const user of tenantRecords) {
    const parts = [`- ${user.firstName} ${user.lastName}`, `role=${user.role}`, `email=${user.email}`, `password=${PASSWORD}`];
    if (user.username) parts.splice(3, 0, `username=${user.username}`);
    const url = ROLE_URL[user.role];
    if (url) parts.push(`URL=${url}`);
    console.log(parts.join(' | '));
  }

  console.log('');
  console.log('Academic data');
  console.log(`- Cycle: ${cycle.code} / ${cycle.libelle}`);
  console.log(`- Classes: ${seededClasses.map((classe) => classe.nom).join(', ')}`);
  console.log(`- Matieres: ${matiereFrancais.libelle}, ${matiereMaths.libelle}, ${matiereLecture.libelle}, ${matiereAnglais.libelle}, ${matiereHistGeo.libelle}, ...`);
  console.log(`- EDT Adja: CI A primaire — matières de 08:00-12:00, après-midi 15:00-17:00 sauf mercredi/samedi`);
  console.log(`- EDT Ousmane: collège + lycée (6ème, 5ème, 3ème, Seconde, Première, Terminale)`);
  console.log('- EDT et cours seedés pour : CI A, 5ème A, 6ème A, 3ème A, Seconde A, Première A, Terminale A');
  console.log(`- Calendrier scolaire: ${calendrierEvents.length} événements`);
  if (eleveAmadouBa) {
    console.log(`- Eleve amadou Ba: ID=${eleveAmadouBa.id} | email=baamadou@gmail.com | classe=CI A | 18 notes (moy=15.5)`);
  }
  console.log(`- Bulk eleves created: ${bulkElevesCreated.length} students across all classes`);
  ===== FIN POST-TRAITEMENTS DÉSACTIVÉS ===== */

  console.log(`Tenant: ${tenant.nom} (${tenant.slug})`);
  console.log(`Tenant ID: ${tenant.id}`);
  console.log(`Password utilisé pour tous les comptes: ${PASSWORD}`);
  console.log('');
  console.log('Comptes (utilisateurs liés au tenant)');
  for (const user of tenantRecords) {
    const parts = [`- ${user.firstName} ${user.lastName}`, `role=${user.role}`];
    if (user.username) parts.push(`identifiant=${user.username}`);
    if (user.email) parts.push(`email=${user.email}`);
    parts.push(`password=${PASSWORD}`);
    console.log(parts.join(' | '));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
