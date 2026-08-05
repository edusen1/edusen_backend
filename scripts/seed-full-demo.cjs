#!/usr/bin/env node
/**
 * seed-full-demo.cjs
 * Peuple la base avec des donnees realistes pour le tenant actif.
 * Prerequis : seed.cjs doit avoir ete execute (tenant + users de base existent deja).
 *
 * Usage :  node scripts/seed-full-demo.cjs
 *
 * Idempotent : peut etre relance sans dupliquer les donnees.
 */

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

const PASSWORD = process.env.SEED_PASSWORD || 'Edusen@2026!';
const SEED_PHONE = process.env.SEED_PHONE_NUMBER || '+22771272788';
const TENANT_SLUG = process.env.SEED_TENANT_SLUG || null;
const SCHOOL_YEAR = '2025-2026';
const YEAR_START = new Date('2025-10-01');
const YEAR_END = new Date('2026-07-31');

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function slug(v) {
  return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

function email(p, n, suffix = '') {
  const domain = process.env.SEED_EMAIL_DOMAIN || 'demo.edusen.sn';
  return `${slug(p)}.${slug(n)}${suffix}@${domain}`;
}

async function upsert(model, where, create, update) {
  const row = await prisma[model].findFirst({ where });
  if (row) return prisma[model].update({ where: { id: row.id }, data: update || create });
  return prisma[model].create({ data: create });
}

async function upsertUser(tenantId, u, hash) {
  const e = u.email || email(u.prenom, u.nom);
  const un = u.username || slug(`${u.prenom}.${u.nom}`);
  const data = {
    tenantId, email: e, username: un, firstName: u.prenom, lastName: u.nom,
    telephone: u.telephone || SEED_PHONE, adresse: u.adresse || 'Dakar, Senegal',
    role: u.role, actif: true, mustChangePwd: false, passwordHash: hash,
    matricule: u.matricule || null, dateNaissance: u.dateNaissance || null,
    lieuNaissance: u.lieuNaissance || null, genre: u.genre || null,
    numeroUrgence: u.numeroUrgence || null, dateInscription: u.dateInscription || null,
    classeId: u.classeId || null, specialite: u.specialite || null,
    dateEmbauche: u.dateEmbauche || null, profession: u.profession || null,
    lieuTravail: u.lieuTravail || null, lienParente: u.lienParente || null,
  };
  let existing = await prisma.user.findFirst({ where: { tenantId, email: e } });
  if (!existing && u.matricule) {
    existing = await prisma.user.findFirst({ where: { tenantId, matricule: u.matricule } });
  }
  if (existing) return prisma.user.update({ where: { id: existing.id }, data });
  return prisma.user.create({ data });
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n🌱 seed-full-demo : demarrage ...\n');
  const hash = await bcrypt.hash(PASSWORD, 12);

  // ── Tenant ────────────────────────────────────────────────────────────────
  let tenant;
  if (TENANT_SLUG) {
    tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  } else {
    tenant = await prisma.tenant.findFirst({ where: { actif: true }, orderBy: { createdAt: 'asc' } });
  }
  if (!tenant) { console.error('Aucun tenant trouve en base — lance d\'abord seed.cjs'); process.exit(1); }
  console.log(`Tenant cible : ${tenant.nom} (${tenant.slug})`);
  const T = tenant.id;

  // ══════════════════════════════════════════════════════════════════════════
  // 0. NETTOYAGE COMPLET — supprimer toutes les donnees seed du tenant
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🧹 Nettoyage complet des donnees existantes ...');

  // Order matters: delete children before parents (FK constraints)
  await prisma.auditLog.deleteMany({ where: { tenantId: T } });
  await prisma.notificationLog.deleteMany({ where: { tenantId: T } });
  await prisma.notification.deleteMany({ where: { tenantId: T } });
  await prisma.pushToken.deleteMany({ where: { tenantId: T } });
  await prisma.pointage.deleteMany({ where: { tenantId: T } });
  await prisma.absencePersonnel.deleteMany({ where: { tenantId: T } });
  await prisma.personnelNiveauAffectation.deleteMany({ where: { tenantId: T } });
  await prisma.demandePassage.deleteMany({ where: { tenantId: T } });
  await prisma.demandeReduction.deleteMany({ where: { tenantId: T } });
  await prisma.demandeAudit.deleteMany({ where: { tenantId: T } });
  await prisma.lienBulletinParent.deleteMany({ where: { tenantId: T } });
  await prisma.lienPaiementParent.deleteMany({ where: { tenantId: T } });
  await prisma.communication.deleteMany({ where: { tenantId: T } });
  await prisma.annonce.deleteMany({ where: { tenantId: T } });
  await prisma.convocation.deleteMany({ where: { tenantId: T } });
  await prisma.discipline.deleteMany({ where: { tenantId: T } });
  await prisma.reclamation.deleteMany({ where: { tenantId: T } });
  await prisma.bulletin.deleteMany({ where: { tenantId: T } });
  await prisma.note.deleteMany({ where: { tenantId: T } });
  await prisma.absenceEleve.deleteMany({ where: { tenantId: T } });
  await prisma.absenceEnseignant.deleteMany({ where: { tenantId: T } });
  await prisma.cahierTexte.deleteMany({ where: { tenantId: T } });
  await prisma.appel.deleteMany({ where: { tenantId: T } }); // AppelLigne cascade
  await prisma.presenceCoursProfesseur.deleteMany({ where: { tenantId: T } });
  await prisma.emploiDuTemps.deleteMany({ where: { tenantId: T } });
  await prisma.paiement.deleteMany({ where: { tenantId: T } });
  await prisma.paiementProfesseur.deleteMany({ where: { tenantId: T } });
  await prisma.inscription.deleteMany({ where: { tenantId: T } });
  await prisma.chapitreProgamme.deleteMany({ where: { programme: { tenantId: T } } });
  await prisma.programmePedagogique.deleteMany({ where: { tenantId: T } });
  await prisma.calendrierScolaire.deleteMany({ where: { tenantId: T } });
  await prisma.surveillantCycle.deleteMany({ where: { tenantId: T } });
  await prisma.classeStagiaire.deleteMany({ where: { tenantId: T } });
  await prisma.eleveParent.deleteMany({ where: { eleve: { tenantId: T } } });
  await prisma.eleveDocument.deleteMany({ where: { tenantId: T } });
  await prisma.matiereClasse.deleteMany({ where: { tenantId: T } });
  await prisma.cours.deleteMany({ where: { tenantId: T } });
  await prisma.professeurMatiere.deleteMany({ where: { tenantId: T } });
  await prisma.matiereNiveau.deleteMany({ where: { tenantId: T } });
  await prisma.classe.deleteMany({ where: { tenantId: T } });
  await prisma.fraisNiveauConfig.deleteMany({ where: { tenantId: T } });
  await prisma.personnel.deleteMany({ where: { tenantId: T } });
  // Delete seed users (all except the admin@seydijamil.sn or first admin)
  const adminToKeep = await prisma.user.findFirst({ where: { tenantId: T, role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (adminToKeep) {
    await prisma.refreshToken.deleteMany({ where: { user: { tenantId: T, id: { not: adminToKeep.id } } } });
    await prisma.passwordResetToken.deleteMany({ where: { user: { tenantId: T, id: { not: adminToKeep.id } } } });
    await prisma.user.deleteMany({ where: { tenantId: T, id: { not: adminToKeep.id } } });
  }
  await prisma.salle.deleteMany({ where: { tenantId: T } });
  await prisma.batiment.deleteMany({ where: { tenantId: T } });
  await prisma.niveau.deleteMany({ where: { tenantId: T } });
  await prisma.cycle.deleteMany({ where: { tenantId: T } });
  await prisma.matiere.deleteMany({ where: { tenantId: T } });
  await prisma.anneeAcademique.deleteMany({ where: { tenantId: T } });
  await prisma.ecoleConfig.deleteMany({ where: { tenantId: T } });
  await prisma.ecolePaletteConfig.deleteMany({ where: { tenantId: T } });
  console.log('  ✅ Nettoyage termine');

  // ══════════════════════════════════════════════════════════════════════════
  // 1. STRUCTURE ACADEMIQUE : Cycles, Niveaux, FraisNiveauConfig
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📚 Cycles, niveaux, frais ...');

  const STRUCTURE = [
    { code: 'PRESCOLAIRE', nom: 'Prescolaire', typePeriode: 'TRIMESTRE', moyenne: 10, ordre: 1, seeded: true, niveaux: [
      { code: 'PS', nom: 'Petite Section', ordre: 1 },
      { code: 'MS', nom: 'Moyenne Section', ordre: 2 },
      { code: 'GS', nom: 'Grande Section', ordre: 3 },
    ]},
    { code: 'PRIMAIRE', nom: 'Primaire', typePeriode: 'TRIMESTRE', moyenne: 10, ordre: 2, seeded: true, niveaux: [
      { code: 'CI', nom: 'CI', ordre: 10 },
      { code: 'CP', nom: 'CP', ordre: 11 },
      { code: 'CE1', nom: 'CE1', ordre: 12 },
      { code: 'CE2', nom: 'CE2', ordre: 13 },
      { code: 'CM1', nom: 'CM1', ordre: 14 },
      { code: 'CM2', nom: 'CM2', ordre: 15 },
    ]},
    { code: 'COLLEGE', nom: 'Collège', typePeriode: 'SEMESTRE', moyenne: 20, ordre: 3, seeded: true, niveaux: [
      { code: '6E', nom: '6ème', ordre: 20 },
      { code: '5E', nom: '5ème', ordre: 21 },
      { code: '4E', nom: '4ème', ordre: 22 },
      { code: '3E', nom: '3ème', ordre: 23 },
    ]},
    { code: 'LYCEE', nom: 'Lycée', typePeriode: 'SEMESTRE', moyenne: 20, ordre: 4, seeded: true, niveaux: [
      { code: '2NDE', nom: 'Seconde', ordre: 30 },
      { code: '1ERE', nom: 'Première', ordre: 31 },
      { code: 'TLE', nom: 'Terminale', ordre: 32 },
    ]},
  ];

  const FRAIS = {
    'Prescolaire|Petite Section':  { insc: 45000, mens: 22000 },
    'Prescolaire|Moyenne Section': { insc: 50000, mens: 25000 },
    'Prescolaire|Grande Section':  { insc: 55000, mens: 28000 },
    'Primaire|CI':  { insc: 60000, mens: 30000 },
    'Primaire|CP':  { insc: 60000, mens: 30000 },
    'Primaire|CE1': { insc: 65000, mens: 32000 },
    'Primaire|CE2': { insc: 65000, mens: 32000 },
    'Primaire|CM1': { insc: 70000, mens: 35000 },
    'Primaire|CM2': { insc: 70000, mens: 35000 },
    'Collège|6ème': { insc: 80000, mens: 40000 },
    'Collège|5ème': { insc: 80000, mens: 40000 },
    'Collège|4ème': { insc: 85000, mens: 42000 },
    'Collège|3ème': { insc: 90000, mens: 45000 },
    'Lycée|Seconde':  { insc: 100000, mens: 50000 },
    'Lycée|Première': { insc: 105000, mens: 52000 },
    'Lycée|Terminale':{ insc: 110000, mens: 55000 },
  };

  const cycleMap = {};   // code -> record
  const niveauMap = {};  // code -> record
  // Track which cycle each niveau belongs to for period logic
  const niveauCycleCode = {}; // niveauCode -> cycleCode

  for (const sec of STRUCTURE) {
    const cycle = await upsert('cycle', { tenantId: T, code: sec.code },
      { tenantId: T, code: sec.code, libelle: sec.nom, typePeriode: sec.typePeriode, moyenneMaximale: sec.moyenne, ordre: sec.ordre, seeded: sec.seeded, actif: true },
      { libelle: sec.nom, typePeriode: sec.typePeriode, moyenneMaximale: sec.moyenne, ordre: sec.ordre, seeded: sec.seeded, actif: true },
    );
    cycleMap[sec.code] = cycle;

    for (const niv of sec.niveaux) {
      const niveau = await upsert('niveau', { tenantId: T, code: niv.code },
        { tenantId: T, cycleId: cycle.id, code: niv.code, libelle: niv.nom, ordre: niv.ordre, seeded: true, actif: true },
        { cycleId: cycle.id, libelle: niv.nom, ordre: niv.ordre, seeded: true, actif: true },
      );
      niveauMap[niv.code] = niveau;
      niveauCycleCode[niv.code] = sec.code;

      const fk = `${sec.nom}|${niv.nom}`;
      const f = FRAIS[fk];
      if (!f) continue;
      await upsert('fraisNiveauConfig', { tenantId: T, section: sec.nom, niveau: niv.nom },
        { tenantId: T, section: sec.nom, niveau: niv.nom, inscription: f.insc, mensualite: f.mens, nbMois: 9, moisDebut: 10, moisFin: 6, actif: true },
        { inscription: f.insc, mensualite: f.mens },
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. ANNEE ACADEMIQUE
  // ══════════════════════════════════════════════════════════════════════════
  const annee = await upsert('anneeAcademique', { tenantId: T, libelle: SCHOOL_YEAR },
    { tenantId: T, libelle: SCHOOL_YEAR, dateDebut: YEAR_START, dateFin: YEAR_END, estCourante: true, actif: true },
    { dateDebut: YEAR_START, dateFin: YEAR_END, estCourante: true, actif: true },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // 3. BATIMENTS & SALLES
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🏫 Batiments, salles ...');

  const batimentDefs = [
    { nom: 'Bloc A', desc: 'Batiment principal — administration et primaire' },
    { nom: 'Bloc B', desc: 'College et laboratoires' },
    { nom: 'Bloc C', desc: 'Lycee et salle informatique' },
    { nom: 'Gymnase', desc: 'Installations sportives' },
  ];
  const batiments = {};
  for (const b of batimentDefs) {
    batiments[b.nom] = await upsert('batiment', { tenantId: T, nom: b.nom },
      { tenantId: T, nom: b.nom, description: b.desc, actif: true },
      { description: b.desc, actif: true },
    );
  }

  const salleDefs = [
    { batiment: 'Bloc A', nom: 'Salle 101', capacite: 40, type: 'Cours' },
    { batiment: 'Bloc A', nom: 'Salle 102', capacite: 35, type: 'Cours' },
    { batiment: 'Bloc A', nom: 'Salle 103', capacite: 30, type: 'Cours' },
    { batiment: 'Bloc A', nom: 'Salle 104', capacite: 30, type: 'Maternelle' },
    { batiment: 'Bloc A', nom: 'Salle 105', capacite: 30, type: 'Maternelle' },
    { batiment: 'Bloc A', nom: 'Salle 106', capacite: 30, type: 'Maternelle' },
    { batiment: 'Bloc A', nom: 'Salle 107', capacite: 35, type: 'Cours' },
    { batiment: 'Bloc A', nom: 'Salle 108', capacite: 35, type: 'Cours' },
    { batiment: 'Bloc A', nom: 'Salle 109', capacite: 35, type: 'Cours' },
    { batiment: 'Bloc A', nom: 'Salle 110', capacite: 35, type: 'Cours' },
    { batiment: 'Bloc A', nom: 'Salle 111', capacite: 35, type: 'Cours' },
    { batiment: 'Bloc A', nom: 'Salle 112', capacite: 35, type: 'Cours' },
    { batiment: 'Bloc B', nom: 'Salle 201', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc B', nom: 'Salle 202', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc B', nom: 'Salle 203', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc B', nom: 'Salle 204', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc B', nom: 'Salle 205', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc B', nom: 'Salle 206', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc B', nom: 'Salle 207', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc B', nom: 'Salle 208', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc B', nom: 'Labo Sciences', capacite: 30, type: 'Laboratoire' },
    { batiment: 'Bloc C', nom: 'Salle 301', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc C', nom: 'Salle 302', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc C', nom: 'Salle 303', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc C', nom: 'Salle 304', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc C', nom: 'Salle 305', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc C', nom: 'Salle 306', capacite: 45, type: 'Cours' },
    { batiment: 'Bloc C', nom: 'Salle Info', capacite: 25, type: 'Informatique' },
    { batiment: 'Gymnase', nom: 'Terrain Sport', capacite: 100, type: 'Sport' },
  ];
  const salles = {};
  for (const s of salleDefs) {
    salles[s.nom] = await upsert('salle',
      { tenantId: T, batimentId: batiments[s.batiment].id, nom: s.nom },
      { tenantId: T, batimentId: batiments[s.batiment].id, nom: s.nom, capacite: s.capacite, typeSalle: s.type, actif: true },
      { capacite: s.capacite, typeSalle: s.type, actif: true },
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. CLASSES (2 par niveau = 32 classes)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🏫 Classes ...');

  const classeDefs = [
    // Prescolaire A + B (6)
    { nom: 'Petite Section A', niveau: 'PS', cycle: 'PRESCOLAIRE', salle: 'Salle 104', max: 30 },
    { nom: 'Petite Section B', niveau: 'PS', cycle: 'PRESCOLAIRE', salle: 'Salle 105', max: 30 },
    { nom: 'Moyenne Section A', niveau: 'MS', cycle: 'PRESCOLAIRE', salle: 'Salle 106', max: 30 },
    { nom: 'Moyenne Section B', niveau: 'MS', cycle: 'PRESCOLAIRE', salle: 'Salle 104', max: 30 },
    { nom: 'Grande Section A', niveau: 'GS', cycle: 'PRESCOLAIRE', salle: 'Salle 105', max: 30 },
    { nom: 'Grande Section B', niveau: 'GS', cycle: 'PRESCOLAIRE', salle: 'Salle 106', max: 30 },
    // Primaire A + B (12)
    { nom: 'CI A', niveau: 'CI', cycle: 'PRIMAIRE', salle: 'Salle 101', max: 40 },
    { nom: 'CI B', niveau: 'CI', cycle: 'PRIMAIRE', salle: 'Salle 107', max: 40 },
    { nom: 'CP A', niveau: 'CP', cycle: 'PRIMAIRE', salle: 'Salle 102', max: 35 },
    { nom: 'CP B', niveau: 'CP', cycle: 'PRIMAIRE', salle: 'Salle 108', max: 35 },
    { nom: 'CE1 A', niveau: 'CE1', cycle: 'PRIMAIRE', salle: 'Salle 103', max: 35 },
    { nom: 'CE1 B', niveau: 'CE1', cycle: 'PRIMAIRE', salle: 'Salle 109', max: 35 },
    { nom: 'CE2 A', niveau: 'CE2', cycle: 'PRIMAIRE', salle: 'Salle 110', max: 35 },
    { nom: 'CE2 B', niveau: 'CE2', cycle: 'PRIMAIRE', salle: 'Salle 111', max: 35 },
    { nom: 'CM1 A', niveau: 'CM1', cycle: 'PRIMAIRE', salle: 'Salle 112', max: 35 },
    { nom: 'CM1 B', niveau: 'CM1', cycle: 'PRIMAIRE', salle: 'Salle 101', max: 35 },
    { nom: 'CM2 A', niveau: 'CM2', cycle: 'PRIMAIRE', salle: 'Salle 102', max: 35 },
    { nom: 'CM2 B', niveau: 'CM2', cycle: 'PRIMAIRE', salle: 'Salle 103', max: 35 },
    // College A + B (8)
    { nom: '6eme A', niveau: '6E', cycle: 'COLLEGE', salle: 'Salle 201', max: 45 },
    { nom: '6eme B', niveau: '6E', cycle: 'COLLEGE', salle: 'Salle 202', max: 45 },
    { nom: '5eme A', niveau: '5E', cycle: 'COLLEGE', salle: 'Salle 203', max: 45 },
    { nom: '5eme B', niveau: '5E', cycle: 'COLLEGE', salle: 'Salle 204', max: 45 },
    { nom: '4eme A', niveau: '4E', cycle: 'COLLEGE', salle: 'Salle 205', max: 45 },
    { nom: '4eme B', niveau: '4E', cycle: 'COLLEGE', salle: 'Salle 206', max: 45 },
    { nom: '3eme A', niveau: '3E', cycle: 'COLLEGE', salle: 'Salle 207', max: 45 },
    { nom: '3eme B', niveau: '3E', cycle: 'COLLEGE', salle: 'Salle 208', max: 45 },
    // Lycee A + B (6)
    { nom: 'Seconde A', niveau: '2NDE', cycle: 'LYCEE', salle: 'Salle 301', max: 45 },
    { nom: 'Seconde B', niveau: '2NDE', cycle: 'LYCEE', salle: 'Salle 302', max: 45 },
    { nom: 'Première A', niveau: '1ERE', cycle: 'LYCEE', salle: 'Salle 303', max: 45 },
    { nom: 'Première B', niveau: '1ERE', cycle: 'LYCEE', salle: 'Salle 304', max: 45 },
    { nom: 'Terminale A', niveau: 'TLE', cycle: 'LYCEE', salle: 'Salle 305', max: 45 },
    { nom: 'Terminale B', niveau: 'TLE', cycle: 'LYCEE', salle: 'Salle 306', max: 45 },
  ];

  const classes = {};
  // Also track which cycle code each class belongs to
  const classeCycleCode = {};
  for (const c of classeDefs) {
    classes[c.nom] = await upsert('classe',
      { tenantId: T, nom: c.nom, anneeAcademiqueId: annee.id },
      { tenantId: T, nom: c.nom, niveauId: niveauMap[c.niveau].id, cycleId: cycleMap[c.cycle].id,
        anneeAcademiqueId: annee.id, salleId: salles[c.salle].id, effectifMax: c.max, actif: true },
      { niveauId: niveauMap[c.niveau].id, cycleId: cycleMap[c.cycle].id,
        salleId: salles[c.salle].id, effectifMax: c.max, actif: true },
    );
    classeCycleCode[c.nom] = c.cycle;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. MATIERES
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📖 Matieres ...');

  const matiereDefs = [
    { code: 'FR', nom: 'Francais', cat: 'Litteraire' },
    { code: 'MATH', nom: 'Mathematiques', cat: 'Scientifique' },
    { code: 'LECT', nom: 'Lecture', cat: 'Litteraire' },
    { code: 'ANG', nom: 'Anglais', cat: 'Langues' },
    { code: 'AR', nom: 'Arabe', cat: 'Langues' },
    { code: 'HG', nom: 'Histoire-Geographie', cat: 'Sciences humaines' },
    { code: 'SVT', nom: 'Sciences de la vie et de la terre', cat: 'Scientifique' },
    { code: 'PC', nom: 'Physique-Chimie', cat: 'Scientifique' },
    { code: 'EPS', nom: 'EPS', cat: 'Sport' },
    { code: 'EVEIL', nom: 'Eveil', cat: 'Prescolaire' },
    { code: 'MOTR', nom: 'Motricite', cat: 'Prescolaire' },
    { code: 'PHILO', nom: 'Philosophie', cat: 'Litteraire' },
    { code: 'ECO', nom: 'Sciences economiques', cat: 'Sciences humaines' },
    { code: 'INFO', nom: 'Informatique', cat: 'Scientifique' },
    { code: 'EDCIV', nom: 'Education civique', cat: 'Sciences humaines' },
  ];
  const matieres = {};
  for (const m of matiereDefs) {
    matieres[m.code] = await upsert('matiere', { tenantId: T, code: m.code },
      { tenantId: T, code: m.code, libelle: m.nom, categorie: m.cat, actif: true },
      { libelle: m.nom, categorie: m.cat, actif: true },
    );
  }

  // ── COEFFICIENTS PAR NIVEAU (MatiereNiveau) ──
  console.log('📐 Coefficients matieres par niveau ...');

  const coeffDefs = [
    // Prescolaire (noteMax=10)
    { niveau: 'PS', matiere: 'EVEIL', coef: 2, max: 10 },
    { niveau: 'PS', matiere: 'MOTR', coef: 1, max: 10 },
    { niveau: 'PS', matiere: 'FR', coef: 2, max: 10 },
    { niveau: 'MS', matiere: 'EVEIL', coef: 2, max: 10 },
    { niveau: 'MS', matiere: 'MOTR', coef: 1, max: 10 },
    { niveau: 'MS', matiere: 'FR', coef: 2, max: 10 },
    { niveau: 'MS', matiere: 'MATH', coef: 2, max: 10 },
    { niveau: 'GS', matiere: 'EVEIL', coef: 2, max: 10 },
    { niveau: 'GS', matiere: 'MOTR', coef: 1, max: 10 },
    { niveau: 'GS', matiere: 'FR', coef: 3, max: 10 },
    { niveau: 'GS', matiere: 'MATH', coef: 3, max: 10 },
    { niveau: 'GS', matiere: 'LECT', coef: 2, max: 10 },
    // Primaire (noteMax=10)
    ...['CI', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'].flatMap(n => [
      { niveau: n, matiere: 'FR', coef: 3, max: 10 },
      { niveau: n, matiere: 'MATH', coef: 3, max: 10 },
      { niveau: n, matiere: 'LECT', coef: 2, max: 10 },
      { niveau: n, matiere: 'AR', coef: 1, max: 10 },
      { niveau: n, matiere: 'EPS', coef: 1, max: 10 },
      { niveau: n, matiere: 'EDCIV', coef: 1, max: 10 },
    ]),
    // College (noteMax=20)
    ...['6E', '5E', '4E', '3E'].flatMap(n => [
      { niveau: n, matiere: 'FR', coef: 4, max: 20 },
      { niveau: n, matiere: 'MATH', coef: 4, max: 20 },
      { niveau: n, matiere: 'ANG', coef: 2, max: 20 },
      { niveau: n, matiere: 'AR', coef: 2, max: 20 },
      { niveau: n, matiere: 'HG', coef: 3, max: 20 },
      { niveau: n, matiere: 'SVT', coef: 2, max: 20 },
      { niveau: n, matiere: 'PC', coef: 2, max: 20 },
      { niveau: n, matiere: 'EPS', coef: 1, max: 20 },
      { niveau: n, matiere: 'EDCIV', coef: 1, max: 20 },
    ]),
    // Lycee (noteMax=20)
    ...['2NDE', '1ERE', 'TLE'].flatMap(n => [
      { niveau: n, matiere: 'FR', coef: 4, max: 20 },
      { niveau: n, matiere: 'MATH', coef: 5, max: 20 },
      { niveau: n, matiere: 'ANG', coef: 2, max: 20 },
      { niveau: n, matiere: 'HG', coef: 3, max: 20 },
      { niveau: n, matiere: 'SVT', coef: 3, max: 20 },
      { niveau: n, matiere: 'PC', coef: 4, max: 20 },
      { niveau: n, matiere: 'EPS', coef: 1, max: 20 },
      { niveau: n, matiere: 'PHILO', coef: n === 'TLE' ? 4 : 2, max: 20 },
      { niveau: n, matiere: 'ECO', coef: 2, max: 20 },
      { niveau: n, matiere: 'INFO', coef: 1, max: 20 },
    ]),
  ];

  for (const c of coeffDefs) {
    if (!niveauMap[c.niveau] || !matieres[c.matiere]) continue;
    await upsert('matiereNiveau',
      { tenantId: T, niveauId: niveauMap[c.niveau].id, matiereId: matieres[c.matiere].id },
      { tenantId: T, niveauId: niveauMap[c.niveau].id, matiereId: matieres[c.matiere].id, coefficient: c.coef, noteMaximum: c.max },
      { coefficient: c.coef, noteMaximum: c.max },
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. ECOLE CONFIG
  // ══════════════════════════════════════════════════════════════════════════
  await upsert('ecoleConfig', { tenantId: T },
    { tenantId: T, nom: tenant.nom, slogan: 'L\'excellence au service de l\'education',
      adresse: 'Cite Keur Damel, Dakar', ville: 'Dakar', pays: 'SN',
      telephone: '+221771234567', email: tenant.emailContact || 'contact@edusen.sn',
      typeEtablissement: 'PRIVE', montantHoraireDefaut: 5000 },
    { nom: tenant.nom, slogan: 'L\'excellence au service de l\'education',
      adresse: 'Cite Keur Damel, Dakar', ville: 'Dakar', telephone: '+221771234567',
      email: tenant.emailContact || 'contact@edusen.sn', montantHoraireDefaut: 5000 },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // 7. ENSEIGNANTS (au moins 12)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('👨‍🏫 Enseignants ...');

  const existingTeachers = await prisma.user.findMany({ where: { tenantId: T, role: 'ENSEIGNANT' } });
  const teacherByEmail = new Map(existingTeachers.map(t => [t.email, t]));

  const newTeachers = [
    { prenom: 'Moussa', nom: 'Diagne', specialite: 'Anglais / Arabe', dateEmbauche: new Date('2022-09-01') },
    { prenom: 'Fatou', nom: 'Diop', specialite: 'Histoire-Geographie', dateEmbauche: new Date('2023-09-01') },
    { prenom: 'Ibrahima', nom: 'Seck', specialite: 'SVT / Physique-Chimie', dateEmbauche: new Date('2021-09-01') },
    { prenom: 'Mariama', nom: 'Niang', specialite: 'Prescolaire', dateEmbauche: new Date('2024-10-01') },
    { prenom: 'Cheikh', nom: 'Mbaye', specialite: 'Philosophie / Economie', dateEmbauche: new Date('2020-09-01') },
    { prenom: 'Aissatou', nom: 'Gueye', specialite: 'Informatique / EPS', dateEmbauche: new Date('2023-01-15') },
    { prenom: 'Modou', nom: 'Sarr', specialite: 'Francais / Lecture', dateEmbauche: new Date('2022-10-01') },
    { prenom: 'Ndeye', nom: 'Thiam', specialite: 'Mathematiques College', dateEmbauche: new Date('2024-01-15') },
    { prenom: 'Abdoulaye', nom: 'Ndiaye', specialite: 'Arabe / Education civique', dateEmbauche: new Date('2023-09-01') },
    { prenom: 'Souleymane', nom: 'Ba', specialite: 'Eveil / Motricite', dateEmbauche: new Date('2024-09-01') },
    { prenom: 'Oumy', nom: 'Sall', specialite: 'Lecture / Francais primaire', dateEmbauche: new Date('2022-09-01') },
    { prenom: 'Mamadou', nom: 'Diaw', specialite: 'Mathematiques Lycee', dateEmbauche: new Date('2021-09-01') },
  ];

  for (const t of newTeachers) {
    const e = email(t.prenom, t.nom);
    if (!teacherByEmail.has(e)) {
      const u = await upsertUser(T, { ...t, role: 'ENSEIGNANT', telephone: SEED_PHONE }, hash);
      teacherByEmail.set(e, u);
    }
  }

  // Reload all teachers
  const allTeachers = await prisma.user.findMany({ where: { tenantId: T, role: 'ENSEIGNANT' } });
  const teacherMap = {};
  for (const t of allTeachers) teacherMap[t.email] = t;

  // ══════════════════════════════════════════════════════════════════════════
  // 8. PERSONNELS (tous types)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('👥 Personnel ...');

  const comptable = await upsertUser(T, { prenom: 'Abdoulaye', nom: 'Diallo', role: 'COMPTABLE', telephone: SEED_PHONE }, hash);
  const securite1 = await upsertUser(T, { prenom: 'Moustapha', nom: 'Ndoye', role: 'SECURITE', telephone: SEED_PHONE }, hash);
  const securite2 = await upsertUser(T, { prenom: 'Babacar', nom: 'Faye', role: 'SECURITE', telephone: SEED_PHONE }, hash);

  const staffUsers = await prisma.user.findMany({
    where: { tenantId: T, role: { in: ['ADMIN', 'CAISSIER', 'SURVEILLANT', 'ENSEIGNANT', 'RH', 'COMPTABLE', 'SECURITE'] } },
  });

  const contratTypes = { ADMIN: 'CDI', CAISSIER: 'CDD', SURVEILLANT: 'CDD', ENSEIGNANT: 'CDI', RH: 'CDI', COMPTABLE: 'CDI', SECURITE: 'CDD' };
  const salaires = { ADMIN: 450000, CAISSIER: 300000, SURVEILLANT: 280000, ENSEIGNANT: 520000, RH: 400000, COMPTABLE: 380000, SECURITE: 250000 };
  let persMatCounter = 1;

  for (const u of staffUsers) {
    const existing = await prisma.personnel.findFirst({ where: { utilisateurId: u.id } });
    if (existing) { persMatCounter++; continue; }
    await prisma.personnel.create({
      data: {
        tenantId: T,
        utilisateurId: u.id,
        numeroMatricule: `PERS-${String(persMatCounter).padStart(3, '0')}`,
        typeContrat: contratTypes[u.role] || 'CDD',
        dateEmbauche: u.dateEmbauche || new Date('2024-09-01'),
        salaire: salaires[u.role] || 300000,
      },
    });
    persMatCounter++;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. ELEVES (8 par classe = 256 total)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🎒 Eleves ...');

  const prenomsMasc = ['Amadou', 'Moussa', 'Ibrahima', 'Ousmane', 'Cheikh', 'Modou', 'Pape', 'Saliou', 'Fallou', 'Thierno', 'Lamine', 'Serigne', 'Malick', 'Babacar', 'Bamba', 'Gora', 'Seydou', 'Alioune', 'Biram', 'Ndiaga'];
  const prenomsFem = ['Fatou', 'Awa', 'Aminata', 'Khady', 'Mariama', 'Ndeye', 'Coumba', 'Rokhaya', 'Aissatou', 'Sokhna', 'Yacine', 'Seynabou', 'Rama', 'Penda', 'Dior', 'Binta', 'Mame', 'Fanta', 'Maty', 'Tida'];
  const noms = ['Diop', 'Ndiaye', 'Fall', 'Sow', 'Gueye', 'Sarr', 'Diallo', 'Kane', 'Thiam', 'Mbaye', 'Camara', 'Cisse', 'Diouf', 'Faye', 'Toure', 'Badji', 'Ndoye', 'Samb', 'Sy', 'Mendy'];

  const adminUser = await prisma.user.findFirst({ where: { tenantId: T, role: 'ADMIN' } });

  // Build frais lookup: classeNom → { inscription, mensualite }
  const fraisParClasse = {};
  for (const cd of classeDefs) {
    const sec = STRUCTURE.find(s => s.code === cd.cycle);
    const niv = sec?.niveaux.find(n => n.code === cd.niveau);
    if (sec && niv) {
      const fk = `${sec.nom}|${niv.nom}`;
      fraisParClasse[cd.nom] = FRAIS[fk] || FRAIS_DEFAULT;
    }
  }

  const elevesByClasse = {};
  const classeEntries = Object.entries(classes);

  for (let ci = 0; ci < classeEntries.length; ci++) {
    const [classeNom, classeRec] = classeEntries[ci];
    elevesByClasse[classeNom] = [];
    for (let i = 0; i < 8; i++) {
      // Stable counter: classeIndex * 8 + studentIndex + 100
      const eleveCounter = ci * 8 + i + 100;
      const isFemale = i % 2 === 1;
      const prenom = isFemale ? prenomsFem[eleveCounter % prenomsFem.length] : prenomsMasc[eleveCounter % prenomsMasc.length];
      const nom = noms[(eleveCounter * 3 + i) % noms.length];
      const suffix = `.${eleveCounter}`;
      const yearBirth = classeRec.nom.includes('Petite') ? 2021 : classeRec.nom.includes('Moyenne') ? 2020
        : classeRec.nom.includes('Grande') ? 2019 : classeRec.nom.includes('CI') ? 2018
        : classeRec.nom.includes('CP') ? 2017 : classeRec.nom.includes('CE1') ? 2016
        : classeRec.nom.includes('CE2') ? 2015 : classeRec.nom.includes('CM1') ? 2014
        : classeRec.nom.includes('CM2') ? 2013 : classeRec.nom.includes('6eme') ? 2012
        : classeRec.nom.includes('5eme') ? 2011 : classeRec.nom.includes('4eme') ? 2010
        : classeRec.nom.includes('3eme') ? 2009 : classeRec.nom.includes('Seconde') ? 2008
        : classeRec.nom.includes('Premiere') ? 2007 : 2006;

      const matricule = `ELV-2025-${String(eleveCounter).padStart(4, '0')}`;

      const eleve = await upsertUser(T, {
        prenom, nom, role: 'ELEVE', email: email(prenom, nom, suffix),
        username: `${slug(prenom)}.${slug(nom)}${suffix}`,
        matricule,
        dateNaissance: new Date(`${yearBirth}-${String((i * 3 + 2) % 12 + 1).padStart(2, '0')}-${String((i * 5 + 3) % 28 + 1).padStart(2, '0')}`),
        genre: isFemale ? 'F' : 'M',
        dateInscription: new Date('2025-10-07'),
        classeId: classeRec.id,
        lieuNaissance: ['Dakar', 'Thies', 'Saint-Louis', 'Kaolack', 'Ziguinchor'][i % 5],
      }, hash);

      // Inscription avec frais
      const fraisClasse = fraisParClasse[classeNom] || FRAIS_DEFAULT;
      await upsert('inscription',
        { numeroInscription: `INS-${SCHOOL_YEAR}-${String(eleveCounter).padStart(4, '0')}` },
        { tenantId: T, numeroInscription: `INS-${SCHOOL_YEAR}-${String(eleveCounter).padStart(4, '0')}`,
          eleveId: eleve.id, classeId: classeRec.id, anneeAcademiqueId: annee.id,
          fraisInscription: fraisClasse.insc,
          statut: 'ACTIF', creePar: adminUser.id },
        { eleveId: eleve.id, classeId: classeRec.id, anneeAcademiqueId: annee.id,
          fraisInscription: fraisClasse.insc,
          statut: 'ACTIF', creePar: adminUser.id },
      );

      elevesByClasse[classeNom].push(eleve);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10. PARENTS (1 parent pour 2 eleves)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('👪 Parents ...');

  const allEleves = Object.values(elevesByClasse).flat();
  let parentCounter = 1;
  for (let i = 0; i < allEleves.length; i += 2) {
    const lien = parentCounter % 2 === 0 ? 'MERE' : 'PERE';
    const prenom = lien === 'MERE' ? prenomsFem[parentCounter % prenomsFem.length] : prenomsMasc[parentCounter % prenomsMasc.length];
    const nom = allEleves[i].lastName;
    const parent = await upsertUser(T, {
      prenom, nom, role: 'PARENT', email: email(prenom, nom, `.p${parentCounter}`),
      username: `${slug(prenom)}.${slug(nom)}.p${parentCounter}`,
      profession: ['Commercant', 'Enseignant', 'Fonctionnaire', 'Medecin', 'Ingenieur', 'Agriculteur'][parentCounter % 6],
      lieuTravail: ['Dakar', 'Plateau', 'Parcelles', 'Medina', 'Grand Yoff'][parentCounter % 5],
      lienParente: lien,
    }, hash);

    for (const eleve of [allEleves[i], allEleves[i + 1]].filter(Boolean)) {
      const exists = await prisma.eleveParent.findFirst({ where: { eleveId: eleve.id, parentId: parent.id } });
      if (!exists) {
        await prisma.eleveParent.create({ data: { eleveId: eleve.id, parentId: parent.id } });
      }
    }
    parentCounter++;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 11. COURS + MATIERE CLASSES
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📝 Cours, affectations profs ...');

  // Teacher references
  const teacherAdja = teacherMap[email('Adja', 'Sarr')];
  const teacherOusmane = teacherMap[email('Ousmane', 'Diouf')];
  const teacherMoussa = teacherMap[email('Moussa', 'Diagne')];
  const teacherFatouD = teacherMap[email('Fatou', 'Diop')];
  const teacherIbrahimaS = teacherMap[email('Ibrahima', 'Seck')];
  const teacherMariamaN = teacherMap[email('Mariama', 'Niang')];
  const teacherCheikh = teacherMap[email('Cheikh', 'Mbaye')];
  const teacherAissatou = teacherMap[email('Aissatou', 'Gueye')];
  const teacherModou = teacherMap[email('Modou', 'Sarr')];
  const teacherNdeye = teacherMap[email('Ndeye', 'Thiam')];
  const teacherAbdoulayeN = teacherMap[email('Abdoulaye', 'Ndiaye')];
  const teacherSouleymane = teacherMap[email('Souleymane', 'Ba')];
  const teacherOumy = teacherMap[email('Oumy', 'Sall')];
  const teacherMamadouD = teacherMap[email('Mamadou', 'Diaw')];

  async function mkCours(mCode, enseignant, classeNom, volHebdo, coeff) {
    if (!enseignant || !classes[classeNom] || !matieres[mCode]) return null;
    const c = await upsert('cours',
      { matiereId: matieres[mCode].id, enseignantId: enseignant.id, classeId: classes[classeNom].id, anneeAcademiqueId: annee.id },
      { tenantId: T, matiereId: matieres[mCode].id, classeId: classes[classeNom].id, enseignantId: enseignant.id,
        anneeAcademiqueId: annee.id, volumeHoraireHebdo: volHebdo, coefficient: coeff },
      { volumeHoraireHebdo: volHebdo, coefficient: coeff },
    );
    await upsert('matiereClasse',
      { matiereId: matieres[mCode].id, classeId: classes[classeNom].id, enseignantId: enseignant.id, anneeAcademiqueId: annee.id },
      { tenantId: T, matiereId: matieres[mCode].id, classeId: classes[classeNom].id, enseignantId: enseignant.id,
        anneeAcademiqueId: annee.id, anneeScolaire: SCHOOL_YEAR, volumeHoraire: volHebdo },
      { anneeScolaire: SCHOOL_YEAR, volumeHoraire: volHebdo },
    );
    return c;
  }

  // Prescolaire — Mariama Niang + Souleymane Ba
  for (const cl of ['Petite Section A', 'Petite Section B', 'Moyenne Section A', 'Moyenne Section B', 'Grande Section A', 'Grande Section B']) {
    await mkCours('EVEIL', teacherMariamaN || teacherSouleymane, cl, 6, 2);
    await mkCours('MOTR', teacherSouleymane || teacherMariamaN, cl, 3, 1);
    await mkCours('FR', teacherMariamaN || teacherSouleymane, cl, 4, 2);
    if (cl.includes('Moyenne') || cl.includes('Grande')) await mkCours('MATH', teacherMariamaN || teacherSouleymane, cl, 3, 2);
    if (cl.includes('Grande')) await mkCours('LECT', teacherMariamaN || teacherSouleymane, cl, 3, 2);
  }

  // Primaire — Adja (CI, CP), Modou+Oumy (CE1-CM2)
  for (const cl of ['CI A', 'CI B', 'CP A', 'CP B']) {
    await mkCours('FR', teacherAdja, cl, 6, 3);
    await mkCours('MATH', teacherAdja, cl, 5, 3);
    await mkCours('LECT', teacherOumy || teacherAdja, cl, 4, 2);
    await mkCours('AR', teacherAbdoulayeN || teacherMoussa, cl, 3, 1);
    await mkCours('EPS', teacherAissatou, cl, 2, 1);
    await mkCours('EDCIV', teacherAbdoulayeN || teacherAdja, cl, 1, 1);
  }
  for (const cl of ['CE1 A', 'CE1 B', 'CE2 A', 'CE2 B', 'CM1 A', 'CM1 B', 'CM2 A', 'CM2 B']) {
    await mkCours('FR', teacherModou, cl, 6, 3);
    await mkCours('MATH', teacherModou, cl, 5, 3);
    await mkCours('LECT', teacherOumy || teacherModou, cl, 4, 2);
    await mkCours('AR', teacherAbdoulayeN || teacherMoussa, cl, 3, 1);
    await mkCours('EPS', teacherAissatou, cl, 2, 1);
    await mkCours('EDCIV', teacherModou, cl, 1, 1);
  }

  // College — multiple profs
  for (const cl of ['6eme A', '6eme B', '5eme A', '5eme B', '4eme A', '4eme B', '3eme A', '3eme B']) {
    await mkCours('FR', teacherAdja, cl, 5, 4);
    await mkCours('MATH', teacherOusmane, cl, 5, 4);
    await mkCours('ANG', teacherMoussa, cl, 3, 2);
    await mkCours('AR', teacherAbdoulayeN || teacherMoussa, cl, 2, 2);
    await mkCours('HG', teacherFatouD, cl, 3, 3);
    await mkCours('SVT', teacherIbrahimaS, cl, 3, 2);
    await mkCours('PC', teacherIbrahimaS, cl, 3, 2);
    await mkCours('EPS', teacherAissatou, cl, 2, 1);
    await mkCours('EDCIV', teacherFatouD, cl, 1, 1);
  }

  // Lycee
  for (const cl of ['Seconde A', 'Seconde B', 'Première A', 'Première B', 'Terminale A', 'Terminale B']) {
    await mkCours('FR', teacherAdja, cl, 4, 4);
    await mkCours('MATH', teacherMamadouD || teacherNdeye || teacherOusmane, cl, 5, 5);
    await mkCours('ANG', teacherMoussa, cl, 3, 2);
    await mkCours('HG', teacherFatouD, cl, 3, 3);
    await mkCours('SVT', teacherIbrahimaS, cl, 3, 3);
    await mkCours('PC', teacherIbrahimaS, cl, 4, 4);
    await mkCours('EPS', teacherAissatou, cl, 2, 1);
    await mkCours('PHILO', teacherCheikh, cl, cl.includes('Terminale') ? 4 : 2, cl.includes('Terminale') ? 4 : 2);
    await mkCours('ECO', teacherCheikh, cl, 2, 2);
    await mkCours('INFO', teacherAissatou, cl, 2, 1);
  }

  // ── ProfesseurMatiere links ──
  console.log('🔗 ProfesseurMatiere ...');
  const profMatLinks = [
    [teacherAdja, ['FR', 'LECT', 'AR']],
    [teacherOusmane, ['MATH', 'PC']],
    [teacherMoussa, ['ANG', 'AR']],
    [teacherFatouD, ['HG', 'EDCIV']],
    [teacherIbrahimaS, ['SVT', 'PC']],
    [teacherMariamaN, ['EVEIL', 'MOTR', 'FR']],
    [teacherCheikh, ['PHILO', 'ECO']],
    [teacherAissatou, ['INFO', 'EPS']],
    [teacherModou, ['FR', 'LECT', 'EDCIV']],
    [teacherNdeye, ['MATH']],
    [teacherAbdoulayeN, ['AR', 'EDCIV']],
    [teacherSouleymane, ['EVEIL', 'MOTR']],
    [teacherOumy, ['LECT', 'FR']],
    [teacherMamadouD, ['MATH']],
  ];
  for (const [prof, codes] of profMatLinks) {
    if (!prof) continue;
    for (const code of codes) {
      if (!matieres[code]) continue;
      await upsert('professeurMatiere', { professeurId: prof.id, matiereId: matieres[code].id },
        { tenantId: T, professeurId: prof.id, matiereId: matieres[code].id },
        { tenantId: T },
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 12. EMPLOI DU TEMPS (6 classes representatives)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📅 Emploi du temps ...');

  async function mkEdt(classeNom, mCode, enseignant, jour, hd, hf) {
    if (!enseignant || !classes[classeNom] || !matieres[mCode]) return;
    const cours = await prisma.cours.findFirst({
      where: { tenantId: T, classeId: classes[classeNom].id, matiereId: matieres[mCode].id, enseignantId: enseignant.id },
    });
    if (!cours) return;
    const existing = await prisma.emploiDuTemps.findFirst({
      where: { tenantId: T, classeId: classes[classeNom].id, coursId: cours.id, jourSemaine: jour, heureDebut: hd },
    });
    if (existing) return existing;
    return prisma.emploiDuTemps.create({
      data: { tenantId: T, classeId: classes[classeNom].id, coursId: cours.id,
        salleId: classes[classeNom].salleId, jourSemaine: jour, heureDebut: hd, heureFin: hf,
        anneeScolaire: SCHOOL_YEAR, publie: true, enseignantId: enseignant.id, matiereId: matieres[mCode].id },
    });
  }

  // CI A
  const ciSlots = [
    ['Lundi','FR',teacherAdja,'08:00','10:00'], ['Lundi','MATH',teacherAdja,'10:00','12:00'],
    ['Lundi','LECT',teacherOumy||teacherAdja,'15:00','16:00'], ['Lundi','EPS',teacherAissatou,'16:00','17:00'],
    ['Mardi','MATH',teacherAdja,'08:00','10:00'], ['Mardi','FR',teacherAdja,'10:00','12:00'],
    ['Mardi','AR',teacherAbdoulayeN||teacherMoussa,'15:00','16:00'], ['Mardi','LECT',teacherOumy||teacherAdja,'16:00','17:00'],
    ['Mercredi','FR',teacherAdja,'08:00','10:00'], ['Mercredi','MATH',teacherAdja,'10:00','12:00'],
    ['Jeudi','MATH',teacherAdja,'08:00','10:00'], ['Jeudi','LECT',teacherOumy||teacherAdja,'10:00','12:00'],
    ['Jeudi','FR',teacherAdja,'15:00','16:00'], ['Jeudi','AR',teacherAbdoulayeN||teacherMoussa,'16:00','17:00'],
    ['Vendredi','FR',teacherAdja,'08:00','10:00'], ['Vendredi','EPS',teacherAissatou,'10:00','11:00'],
    ['Vendredi','EDCIV',teacherAbdoulayeN||teacherAdja,'15:00','16:00'], ['Vendredi','LECT',teacherOumy||teacherAdja,'16:00','17:00'],
  ];
  for (const [j,m,e,hd,hf] of ciSlots) await mkEdt('CI A', m, e, j, hd, hf);

  // CE2 A
  const ce2Slots = [
    ['Lundi','FR',teacherModou,'08:00','10:00'], ['Lundi','MATH',teacherModou,'10:00','12:00'],
    ['Lundi','LECT',teacherOumy||teacherModou,'15:00','16:00'], ['Lundi','EPS',teacherAissatou,'16:00','17:00'],
    ['Mardi','MATH',teacherModou,'08:00','10:00'], ['Mardi','FR',teacherModou,'10:00','12:00'],
    ['Mardi','AR',teacherAbdoulayeN||teacherMoussa,'15:00','16:00'], ['Mardi','EDCIV',teacherModou,'16:00','17:00'],
    ['Mercredi','FR',teacherModou,'08:00','10:00'], ['Mercredi','MATH',teacherModou,'10:00','12:00'],
    ['Jeudi','MATH',teacherModou,'08:00','10:00'], ['Jeudi','LECT',teacherOumy||teacherModou,'10:00','12:00'],
    ['Jeudi','FR',teacherModou,'15:00','16:00'], ['Jeudi','AR',teacherAbdoulayeN||teacherMoussa,'16:00','17:00'],
    ['Vendredi','FR',teacherModou,'08:00','10:00'], ['Vendredi','EPS',teacherAissatou,'10:00','11:00'],
    ['Vendredi','LECT',teacherOumy||teacherModou,'15:00','16:00'],
  ];
  for (const [j,m,e,hd,hf] of ce2Slots) await mkEdt('CE2 A', m, e, j, hd, hf);

  // 6eme A
  const s6Slots = [
    ['Lundi','FR',teacherAdja,'08:00','09:30'], ['Lundi','MATH',teacherOusmane,'10:00','11:30'],
    ['Lundi','ANG',teacherMoussa,'14:00','15:30'], ['Lundi','HG',teacherFatouD,'15:30','17:00'],
    ['Mardi','MATH',teacherOusmane,'08:00','09:30'], ['Mardi','SVT',teacherIbrahimaS,'10:00','11:30'],
    ['Mardi','FR',teacherAdja,'14:00','15:30'], ['Mardi','PC',teacherIbrahimaS,'15:30','17:00'],
    ['Mercredi','ANG',teacherMoussa,'08:00','09:30'], ['Mercredi','HG',teacherFatouD,'10:00','11:30'],
    ['Jeudi','FR',teacherAdja,'08:00','09:30'], ['Jeudi','MATH',teacherOusmane,'10:00','11:30'],
    ['Jeudi','EPS',teacherAissatou,'14:00','15:30'], ['Jeudi','AR',teacherAbdoulayeN||teacherMoussa,'15:30','17:00'],
    ['Vendredi','SVT',teacherIbrahimaS,'08:00','09:30'], ['Vendredi','EDCIV',teacherFatouD,'10:00','11:30'],
    ['Vendredi','FR',teacherAdja,'14:00','15:30'],
  ];
  for (const [j,m,e,hd,hf] of s6Slots) await mkEdt('6eme A', m, e, j, hd, hf);

  // 5eme A
  const c5Slots = [
    ['Lundi','FR',teacherAdja,'08:00','09:30'], ['Lundi','MATH',teacherOusmane,'10:00','11:30'],
    ['Lundi','ANG',teacherMoussa,'14:00','15:30'], ['Lundi','HG',teacherFatouD,'15:30','17:00'],
    ['Mardi','MATH',teacherOusmane,'08:00','09:30'], ['Mardi','SVT',teacherIbrahimaS,'10:00','11:30'],
    ['Mardi','FR',teacherAdja,'14:00','15:30'], ['Mardi','PC',teacherIbrahimaS,'15:30','17:00'],
    ['Mercredi','ANG',teacherMoussa,'08:00','09:30'], ['Mercredi','HG',teacherFatouD,'10:00','11:30'],
    ['Jeudi','FR',teacherAdja,'08:00','09:30'], ['Jeudi','MATH',teacherOusmane,'10:00','11:30'],
    ['Jeudi','EPS',teacherAissatou,'14:00','15:30'], ['Jeudi','AR',teacherAbdoulayeN||teacherMoussa,'15:30','17:00'],
    ['Vendredi','SVT',teacherIbrahimaS,'08:00','09:30'], ['Vendredi','MATH',teacherOusmane,'10:00','11:30'],
    ['Vendredi','FR',teacherAdja,'14:00','15:30'],
  ];
  for (const [j,m,e,hd,hf] of c5Slots) await mkEdt('5eme A', m, e, j, hd, hf);

  // 3eme A
  const c3Slots = [
    ['Lundi','FR',teacherAdja,'08:00','09:30'], ['Lundi','MATH',teacherOusmane,'10:00','11:30'],
    ['Lundi','PC',teacherIbrahimaS,'14:00','15:30'], ['Lundi','HG',teacherFatouD,'15:30','17:00'],
    ['Mardi','MATH',teacherOusmane,'08:00','09:30'], ['Mardi','SVT',teacherIbrahimaS,'10:00','11:30'],
    ['Mardi','FR',teacherAdja,'14:00','15:30'], ['Mardi','ANG',teacherMoussa,'15:30','17:00'],
    ['Mercredi','PC',teacherIbrahimaS,'08:00','09:30'], ['Mercredi','HG',teacherFatouD,'10:00','11:30'],
    ['Jeudi','FR',teacherAdja,'08:00','09:30'], ['Jeudi','MATH',teacherOusmane,'10:00','11:30'],
    ['Jeudi','EPS',teacherAissatou,'14:00','15:30'], ['Jeudi','EDCIV',teacherFatouD,'15:30','17:00'],
    ['Vendredi','SVT',teacherIbrahimaS,'08:00','09:30'], ['Vendredi','AR',teacherAbdoulayeN||teacherMoussa,'10:00','11:30'],
    ['Vendredi','MATH',teacherOusmane,'14:00','15:30'],
  ];
  for (const [j,m,e,hd,hf] of c3Slots) await mkEdt('3eme A', m, e, j, hd, hf);

  // Terminale A
  const tSlots = [
    ['Lundi','MATH',teacherMamadouD||teacherNdeye||teacherOusmane,'08:00','10:00'], ['Lundi','PHILO',teacherCheikh,'10:00','12:00'],
    ['Lundi','PC',teacherIbrahimaS,'14:00','16:00'],
    ['Mardi','FR',teacherAdja,'08:00','10:00'], ['Mardi','SVT',teacherIbrahimaS,'10:00','12:00'],
    ['Mardi','ECO',teacherCheikh,'14:00','16:00'],
    ['Mercredi','MATH',teacherMamadouD||teacherNdeye||teacherOusmane,'08:00','10:00'], ['Mercredi','ANG',teacherMoussa,'10:00','12:00'],
    ['Jeudi','PC',teacherIbrahimaS,'08:00','10:00'], ['Jeudi','HG',teacherFatouD,'10:00','12:00'],
    ['Jeudi','INFO',teacherAissatou,'14:00','16:00'],
    ['Vendredi','FR',teacherAdja,'08:00','10:00'], ['Vendredi','PHILO',teacherCheikh,'10:00','12:00'],
    ['Vendredi','EPS',teacherAissatou,'14:00','16:00'],
  ];
  for (const [j,m,e,hd,hf] of tSlots) await mkEdt('Terminale A', m, e, j, hd, hf);

  // ══════════════════════════════════════════════════════════════════════════
  // 13. NOTES (toutes les classes, periodes correctes par cycle)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📊 Notes ...');

  async function mkNote(eleveId, mCode, trimestre, type, note, noteSur, commentaire) {
    if (!matieres[mCode]) return;
    const cours = await prisma.cours.findFirst({
      where: { tenantId: T, matiereId: matieres[mCode].id, classe: { eleves: { some: { id: eleveId } } } },
    });
    const dateMonth = trimestre.includes('1') ? '01' : trimestre.includes('2') ? '04' : '06';
    const data = {
      tenantId: T, eleveId, matiereId: matieres[mCode].id, coursId: cours?.id || null,
      typeEvaluation: type, note, noteSur, trimestre, anneeScolaire: SCHOOL_YEAR,
      commentaire, dateEvaluation: new Date(`2026-${dateMonth}-15`),
    };
    const existing = await prisma.note.findFirst({
      where: { tenantId: T, eleveId, matiereId: matieres[mCode].id, trimestre, typeEvaluation: type, commentaire },
    });
    if (existing) return prisma.note.update({ where: { id: existing.id }, data });
    return prisma.note.create({ data });
  }

  // Build note configs per class using correct period names per cycle
  const noteClasses = [];
  // Prescolaire: TRIMESTRE, notes /10
  for (const s of ['A', 'B']) {
    noteClasses.push({ classe: `Petite Section ${s}`, mats: ['EVEIL', 'MOTR', 'FR'], periodes: ['TRIMESTRE_1', 'TRIMESTRE_2', 'TRIMESTRE_3'], maxNote: 10 });
    noteClasses.push({ classe: `Moyenne Section ${s}`, mats: ['EVEIL', 'MOTR', 'FR', 'MATH'], periodes: ['TRIMESTRE_1', 'TRIMESTRE_2', 'TRIMESTRE_3'], maxNote: 10 });
    noteClasses.push({ classe: `Grande Section ${s}`, mats: ['EVEIL', 'FR', 'MATH', 'LECT'], periodes: ['TRIMESTRE_1', 'TRIMESTRE_2', 'TRIMESTRE_3'], maxNote: 10 });
  }
  // Primaire: TRIMESTRE, notes /10
  for (const n of ['CI', 'CP', 'CE1', 'CE2', 'CM1', 'CM2']) {
    for (const s of ['A', 'B']) {
      noteClasses.push({ classe: `${n} ${s}`, mats: ['FR', 'MATH', 'LECT', 'AR', 'EPS', 'EDCIV'], periodes: ['TRIMESTRE_1', 'TRIMESTRE_2', 'TRIMESTRE_3'], maxNote: 10 });
    }
  }
  // College: SEMESTRE, notes /20
  for (const n of ['6eme', '5eme', '4eme', '3eme']) {
    for (const s of ['A', 'B']) {
      noteClasses.push({ classe: `${n} ${s}`, mats: ['FR', 'MATH', 'ANG', 'AR', 'HG', 'SVT', 'PC', 'EPS', 'EDCIV'], periodes: ['SEMESTRE_1', 'SEMESTRE_2'], maxNote: 20 });
    }
  }
  // Lycee: SEMESTRE, notes /20
  for (const n of ['Seconde', 'Premiere', 'Terminale']) {
    for (const s of ['A', 'B']) {
      noteClasses.push({ classe: `${n} ${s}`, mats: ['FR', 'MATH', 'ANG', 'PC', 'SVT', 'PHILO', 'ECO', 'HG', 'EPS', 'INFO'], periodes: ['SEMESTRE_1', 'SEMESTRE_2'], maxNote: 20 });
    }
  }

  for (const nc of noteClasses) {
    const eleves = elevesByClasse[nc.classe] || [];
    for (const eleve of eleves) {
      for (const period of nc.periodes) {
        for (const mCode of nc.mats) {
          const base = Math.max(1, Math.floor(Math.random() * (nc.maxNote - 2)) + 2);
          await mkNote(eleve.id, mCode, period, 'DEVOIR', Math.min(nc.maxNote, base), nc.maxNote, 'Devoir 1');
          await mkNote(eleve.id, mCode, period, 'DEVOIR', Math.min(nc.maxNote, base + 1), nc.maxNote, 'Devoir 2');
          await mkNote(eleve.id, mCode, period, 'COMPOSITION', Math.min(nc.maxNote, base + 2), nc.maxNote, 'Composition');
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 14. BULLETINS (correct ranking by moyenne DESC)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📋 Bulletins ...');

  for (const nc of noteClasses) {
    const eleves = elevesByClasse[nc.classe] || [];
    if (eleves.length === 0) continue;

    for (const period of nc.periodes) {
      // Compute actual moyennes from notes for ranking
      const eleveMoyennes = [];
      for (const eleve of eleves) {
        const notes = await prisma.note.findMany({
          where: { tenantId: T, eleveId: eleve.id, trimestre: period, anneeScolaire: SCHOOL_YEAR },
        });
        let totalWeighted = 0;
        let totalCoeff = 0;
        for (const n of notes) {
          // Normalize to base maxNote, weight = 1 per note for simplicity
          totalWeighted += n.note;
          totalCoeff++;
        }
        const moy = totalCoeff > 0 ? Math.round((totalWeighted / totalCoeff) * 100) / 100 : 0;
        eleveMoyennes.push({ eleve, moy });
      }
      // Sort DESC for ranking
      eleveMoyennes.sort((a, b) => b.moy - a.moy);
      const moyenneClasse = eleveMoyennes.length > 0
        ? Math.round((eleveMoyennes.reduce((s, e) => s + e.moy, 0) / eleveMoyennes.length) * 100) / 100
        : 0;

      for (let rang = 0; rang < eleveMoyennes.length; rang++) {
        const { eleve, moy } = eleveMoyennes[rang];
        const appreciation = moy > (nc.maxNote * 0.7) ? 'Tres bien'
          : moy > (nc.maxNote * 0.6) ? 'Bien'
          : moy > (nc.maxNote * 0.5) ? 'Assez bien'
          : 'Insuffisant';
        const isLast = period === nc.periodes[nc.periodes.length - 1];
        await upsert('bulletin',
          { eleveId: eleve.id, classeId: classes[nc.classe].id, trimestre: period, anneeScolaire: SCHOOL_YEAR },
          { tenantId: T, eleveId: eleve.id, classeId: classes[nc.classe].id,
            trimestre: period, anneeScolaire: SCHOOL_YEAR,
            moyenne: moy, moyenneClasse,
            rang: rang + 1, totalEleves: eleves.length,
            appreciation,
            nombreAbsences: Math.floor(Math.random() * 5), nombreRetards: Math.floor(Math.random() * 3),
            statut: isLast ? 'BROUILLON' : 'PUBLIE' },
          { moyenne: moy, moyenneClasse, rang: rang + 1, appreciation, statut: isLast ? 'BROUILLON' : 'PUBLIE' },
        );
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 15. ABSENCES ELEVES
  // ══════════════════════════════════════════════════════════════════════════
  console.log('❌ Absences eleves ...');

  const absenceDates = ['2026-01-15', '2026-02-03', '2026-02-20', '2026-03-10', '2026-03-25', '2026-04-07', '2026-04-28', '2026-05-12'];
  let absIdx = 0;
  for (const [classeNom, eleves] of Object.entries(elevesByClasse)) {
    for (const eleve of eleves.slice(0, 3)) {
      const d = absenceDates[absIdx % absenceDates.length];
      const existing = await prisma.absenceEleve.findFirst({
        where: { tenantId: T, eleveId: eleve.id, date: new Date(d) },
      });
      if (!existing) {
        await prisma.absenceEleve.create({
          data: {
            tenantId: T, eleveId: eleve.id, classeId: classes[classeNom].id,
            date: new Date(d),
            typeAbsence: absIdx % 3 === 0 ? 'RETARD' : 'ABSENT',
            justifiee: absIdx % 4 === 0,
            motif: ['Maladie', 'Raison familiale', 'Retard transport', 'Non justifie'][absIdx % 4],
            statut: absIdx % 3 === 0 ? 'JUSTIFIEE' : absIdx % 3 === 1 ? 'NON_JUSTIFIEE' : 'EN_ATTENTE',
          },
        });
      }
      absIdx++;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 16. PAIEMENTS (50%+ des eleves: inscription + 2-3 mensualites)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('💰 Paiements ...');

  let paiCounter = 1;
  for (const [classeNom, eleves] of Object.entries(elevesByClasse)) {
    // At least 50% of students = first 4 out of 8
    for (const eleve of eleves.slice(0, 4)) {
      const insc = await prisma.inscription.findFirst({ where: { tenantId: T, eleveId: eleve.id, anneeAcademiqueId: annee.id } });
      if (!insc) continue;
      // Inscription payment + 2 mensualites
      const paiDates = [
        { type: 'INSCRIPTION', montant: 60000 + (paiCounter * 100), date: '2025-10-05', tri: null },
        { type: 'SCOLARITE', montant: 30000, date: '2025-11-05', tri: 'Octobre' },
        { type: 'SCOLARITE', montant: 30000, date: '2025-12-05', tri: 'Novembre' },
      ];
      for (const p of paiDates) {
        const ref = `PAY-${SCHOOL_YEAR}-${String(paiCounter).padStart(5, '0')}`;
        const existing = await prisma.paiement.findFirst({ where: { reference: ref } });
        if (!existing) {
          await prisma.paiement.create({
            data: {
              tenantId: T, inscriptionId: insc.id, eleveId: eleve.id, reference: ref,
              montant: p.montant,
              typePaiement: p.type,
              modePaiement: ['ESPECES', 'MOBILE_MONEY', 'VIREMENT', 'CHEQUE'][paiCounter % 4],
              statut: 'VALIDE', anneeScolaire: SCHOOL_YEAR,
              trimestre: p.tri,
              datePaiement: new Date(p.date),
              validePar: adminUser.id,
            },
          });
        }
        paiCounter++;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 17. DISCIPLINES (7+ incidents)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('⚖️ Disciplines ...');

  const disciplineDefs = [
    { eleve: (elevesByClasse['5eme A'] || [])[0], classe: '5eme A', type: 'AVERTISSEMENT', motif: 'Bavardage persistant en classe', gravite: 2, statut: 'CLOTURE', sanction: 'Avertissement ecrit aux parents' },
    { eleve: (elevesByClasse['5eme A'] || [])[1], classe: '5eme A', type: 'RETENUE', motif: 'Devoir non rendu a trois reprises', gravite: 3, statut: 'EN_TRAITEMENT' },
    { eleve: (elevesByClasse['3eme A'] || [])[0], classe: '3eme A', type: 'BLAME', motif: 'Insolence envers un enseignant', gravite: 4, statut: 'OUVERT' },
    { eleve: (elevesByClasse['Terminale A'] || [])[0], classe: 'Terminale A', type: 'EXCLUSION_COURS', motif: 'Utilisation du telephone en classe', gravite: 3, statut: 'CLOTURE', sanction: 'Exclusion de 2h de cours' },
    { eleve: (elevesByClasse['4eme A'] || [])[0], classe: '4eme A', type: 'EXCLUSION_TEMPORAIRE', motif: 'Bagarre dans la cour de recreation', gravite: 5, statut: 'EN_TRAITEMENT', sanction: 'Exclusion temporaire de 3 jours' },
    { eleve: (elevesByClasse['CM2 A'] || [])[0], classe: 'CM2 A', type: 'TRAVAUX_INTERET_SCOLAIRE', motif: 'Degradation de materiel scolaire', gravite: 3, statut: 'CLOTURE', sanction: 'Nettoyage de la salle pendant 1 semaine' },
    { eleve: (elevesByClasse['6eme A'] || [])[0], classe: '6eme A', type: 'CONSEIL_DISCIPLINE', motif: 'Absences repetees non justifiees (12 jours)', gravite: 5, statut: 'OUVERT' },
    { eleve: (elevesByClasse['CE1 A'] || [])[0], classe: 'CE1 A', type: 'AVERTISSEMENT', motif: 'Jet de cailloux dans la cour', gravite: 2, statut: 'CLOTURE', sanction: 'Rappel a l\'ordre' },
  ];

  for (let i = 0; i < disciplineDefs.length; i++) {
    const d = disciplineDefs[i];
    if (!d.eleve) continue;
    const existing = await prisma.discipline.findFirst({
      where: { tenantId: T, eleveId: d.eleve.id, motif: d.motif },
    });
    if (!existing) {
      await prisma.discipline.create({
        data: {
          tenantId: T, eleveId: d.eleve.id, classeId: classes[d.classe]?.id || null,
          eleveNom: `${d.eleve.firstName} ${d.eleve.lastName}`,
          eleveClasse: d.classe, type: d.type, motif: d.motif,
          dateIncident: new Date(`2026-0${Math.min(9, 2 + i)}-${String(10 + i).padStart(2, '0')}`),
          gravite: d.gravite, statut: d.statut,
          sanction: d.sanction || null,
          rapporteur: 'Administration', rapporteurRole: 'ADMIN',
          signaleParId: adminUser.id,
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 18. CONVOCATIONS (5+)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📬 Convocations ...');

  const convocParents = await prisma.eleveParent.findMany({
    where: { eleve: { tenantId: T } },
    take: 6,
    include: { eleve: true },
  });

  for (let i = 0; i < Math.min(6, convocParents.length); i++) {
    const cp = convocParents[i];
    const existing = await prisma.convocation.findFirst({
      where: { tenantId: T, parentId: cp.parentId, eleveId: cp.eleveId },
    });
    if (!existing) {
      await prisma.convocation.create({
        data: {
          tenantId: T, parentId: cp.parentId, eleveId: cp.eleveId,
          motif: ['Absences repetees', 'Resultats en baisse', 'Comportement a ameliorer', 'Reunion pedagogique', 'Suivi scolaire', 'Orientation fin de cycle'][i % 6],
          type: i < 3 ? 'DISCIPLINAIRE' : 'PEDAGOGIQUE',
          dateConvocation: new Date(`2026-0${3 + i % 4}-${String(10 + i * 3).padStart(2, '0')}`),
          statut: i < 2 ? 'EN_ATTENTE' : 'TRAITEE',
          observations: i >= 2 ? 'Entretien realise avec le parent' : null,
          creePar: adminUser.id,
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 19. RECLAMATIONS (4+)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📝 Reclamations ...');

  const reclaDefs = [
    { classe: '5eme A', idx: 0, mat: 'MATH', tri: 'SEMESTRE_1', motif: 'La note semble inferieure a ce qui etait annonce oralement', statut: 'EN_ATTENTE' },
    { classe: '5eme A', idx: 1, mat: 'FR', tri: 'SEMESTRE_2', motif: 'Erreur de calcul dans le total de la composition', statut: 'TRAITEE', reponse: 'Correction effectuee, note mise a jour' },
    { classe: 'Terminale A', idx: 0, mat: 'PC', tri: 'SEMESTRE_1', motif: 'Demande de revision de la copie de Physique-Chimie', statut: 'EN_ATTENTE' },
    { classe: 'CI A', idx: 0, mat: 'MATH', tri: 'TRIMESTRE_1', motif: 'Le parent conteste la note du devoir de mathematiques', statut: 'REJETEE', reponse: 'Note verifiee, conforme a la correction' },
    { classe: '3eme A', idx: 0, mat: 'SVT', tri: 'SEMESTRE_1', motif: 'Copie non corrigee integralement — 2 exercices manquants', statut: 'TRAITEE', reponse: 'Copie re-corrigee, note ajustee' },
  ];

  for (const r of reclaDefs) {
    const eleves = elevesByClasse[r.classe] || [];
    if (!eleves[r.idx]) continue;
    const note = await prisma.note.findFirst({
      where: { tenantId: T, eleveId: eleves[r.idx].id, matiereId: matieres[r.mat]?.id, trimestre: r.tri },
    });
    const existing = await prisma.reclamation.findFirst({ where: { tenantId: T, eleveId: eleves[r.idx].id, motif: r.motif } });
    if (!existing) {
      await prisma.reclamation.create({
        data: { tenantId: T, eleveId: eleves[r.idx].id, noteId: note?.id || null, motif: r.motif, statut: r.statut, reponse: r.reponse || null },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 20. COMMUNICATIONS (6+)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📢 Communications ...');

  const commDefs = [
    { titre: 'Rentree scolaire 2025-2026', contenu: 'La rentree des classes est fixee au 6 octobre 2025. Tous les eleves sont attendus a 8h00.', canal: 'IN_APP', statut: 'ENVOYE', roles: ['PARENT', 'ELEVE', 'ENSEIGNANT'] },
    { titre: 'Reunion parents-enseignants', contenu: 'Une reunion parents-professeurs se tiendra le samedi 15 novembre 2025 de 9h a 12h.', canal: 'EMAIL', statut: 'ENVOYE', roles: ['PARENT'] },
    { titre: 'Rappel paiement mensualite', contenu: 'Nous rappelons aux parents que la mensualite de janvier est a payer avant le 10 janvier 2026.', canal: 'WHATSAPP', statut: 'ENVOYE', roles: ['PARENT'] },
    { titre: 'Compositions du 1er trimestre', contenu: 'Les compositions du premier trimestre debuteront le 20 janvier 2026 pour le college et le lycee.', canal: 'IN_APP', statut: 'ENVOYE', roles: ['ELEVE', 'PARENT', 'ENSEIGNANT'] },
    { titre: 'Journee portes ouvertes', contenu: 'L\'ecole organise une journee portes ouvertes le 8 mars 2026. Tous sont les bienvenus.', canal: 'IN_APP', statut: 'BROUILLON', roles: ['PARENT', 'ELEVE'] },
    { titre: 'Resultat conseil de discipline', contenu: 'Suite au conseil de discipline du 12 avril, les decisions seront communiquees individuellement.', canal: 'EMAIL', statut: 'ENVOYE', roles: ['PARENT'] },
    { titre: 'Fournitures scolaires T2', contenu: 'La liste des fournitures complementaires pour le 2eme trimestre est disponible au secretariat.', canal: 'WHATSAPP', statut: 'ENVOYE', roles: ['PARENT'] },
  ];

  for (let i = 0; i < commDefs.length; i++) {
    const c = commDefs[i];
    const existing = await prisma.communication.findFirst({ where: { tenantId: T, titre: c.titre } });
    if (!existing) {
      await prisma.communication.create({
        data: {
          tenantId: T, titre: c.titre, contenu: c.contenu, canal: c.canal, statut: c.statut,
          cibleType: 'ROLES', roles: c.roles, inclureParents: c.roles.includes('PARENT'),
          inclureEleves: c.roles.includes('ELEVE'), nbDestinataires: 30 + i * 10,
          envoyeLe: c.statut === 'ENVOYE' ? new Date(['2025-10-05', '2025-10-15', '2025-11-05', '2025-11-20', '2025-12-01', '2026-01-10', '2026-02-05'][i] || '2026-01-15') : null,
          auteurId: adminUser.id,
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 21. PROGRAMMES PEDAGOGIQUES (5+ avec 4-6 chapitres)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📘 Programmes pedagogiques ...');

  const progDefs = [
    { niveau: '6E', matiere: 'MATH', titre: 'Programme Maths 6eme', chapitres: [
      { num: 1, titre: 'Nombres et calculs', periode: 'SEMESTRE_1', statut: 'TERMINE' },
      { num: 2, titre: 'Geometrie plane', periode: 'SEMESTRE_1', statut: 'TERMINE' },
      { num: 3, titre: 'Fractions et decimaux', periode: 'SEMESTRE_1', statut: 'EN_COURS' },
      { num: 4, titre: 'Proportionnalite', periode: 'SEMESTRE_2', statut: 'NON_COMMENCE' },
      { num: 5, titre: 'Statistiques', periode: 'SEMESTRE_2', statut: 'NON_COMMENCE' },
    ]},
    { niveau: '3E', matiere: 'FR', titre: 'Programme Francais 3eme', chapitres: [
      { num: 1, titre: 'Le recit autobiographique', periode: 'SEMESTRE_1', statut: 'TERMINE' },
      { num: 2, titre: 'L\'argumentation', periode: 'SEMESTRE_1', statut: 'TERMINE' },
      { num: 3, titre: 'La poesie engagee', periode: 'SEMESTRE_2', statut: 'EN_COURS' },
      { num: 4, titre: 'Le theatre contemporain', periode: 'SEMESTRE_2', statut: 'NON_COMMENCE' },
    ]},
    { niveau: 'TLE', matiere: 'PHILO', titre: 'Programme Philosophie Terminale', chapitres: [
      { num: 1, titre: 'La conscience et l\'inconscient', periode: 'SEMESTRE_1', statut: 'TERMINE' },
      { num: 2, titre: 'La liberte', periode: 'SEMESTRE_1', statut: 'TERMINE' },
      { num: 3, titre: 'L\'Etat et la justice', periode: 'SEMESTRE_1', statut: 'EN_COURS' },
      { num: 4, titre: 'La verite et la science', periode: 'SEMESTRE_2', statut: 'NON_COMMENCE' },
      { num: 5, titre: 'L\'art et le beau', periode: 'SEMESTRE_2', statut: 'NON_COMMENCE' },
      { num: 6, titre: 'Le devoir et la morale', periode: 'SEMESTRE_2', statut: 'NON_COMMENCE' },
    ]},
    { niveau: 'CI', matiere: 'FR', titre: 'Programme Francais CI', chapitres: [
      { num: 1, titre: 'Les voyelles et consonnes', periode: 'TRIMESTRE_1', statut: 'TERMINE' },
      { num: 2, titre: 'Les syllabes simples', periode: 'TRIMESTRE_1', statut: 'TERMINE' },
      { num: 3, titre: 'Mots et phrases courtes', periode: 'TRIMESTRE_2', statut: 'EN_COURS' },
      { num: 4, titre: 'Lecture et comprehension', periode: 'TRIMESTRE_3', statut: 'NON_COMMENCE' },
    ]},
    { niveau: '5E', matiere: 'SVT', titre: 'Programme SVT 5eme', chapitres: [
      { num: 1, titre: 'La nutrition', periode: 'SEMESTRE_1', statut: 'TERMINE' },
      { num: 2, titre: 'La respiration', periode: 'SEMESTRE_1', statut: 'TERMINE' },
      { num: 3, titre: 'La circulation sanguine', periode: 'SEMESTRE_1', statut: 'EN_COURS' },
      { num: 4, titre: 'La geologie externe', periode: 'SEMESTRE_2', statut: 'NON_COMMENCE' },
      { num: 5, titre: 'L\'environnement et le developpement durable', periode: 'SEMESTRE_2', statut: 'NON_COMMENCE' },
    ]},
    { niveau: '2NDE', matiere: 'MATH', titre: 'Programme Maths Seconde', chapitres: [
      { num: 1, titre: 'Ensembles de nombres et calcul', periode: 'SEMESTRE_1', statut: 'TERMINE' },
      { num: 2, titre: 'Fonctions de reference', periode: 'SEMESTRE_1', statut: 'TERMINE' },
      { num: 3, titre: 'Equations et inequations', periode: 'SEMESTRE_1', statut: 'EN_COURS' },
      { num: 4, titre: 'Geometrie dans le plan', periode: 'SEMESTRE_2', statut: 'NON_COMMENCE' },
      { num: 5, titre: 'Statistiques et probabilites', periode: 'SEMESTRE_2', statut: 'NON_COMMENCE' },
    ]},
  ];

  for (const p of progDefs) {
    if (!niveauMap[p.niveau] || !matieres[p.matiere]) continue;
    const prog = await upsert('programmePedagogique',
      { tenantId: T, niveauId: niveauMap[p.niveau].id, matiereId: matieres[p.matiere].id, anneeAcademiqueId: annee.id },
      { tenantId: T, niveauId: niveauMap[p.niveau].id, matiereId: matieres[p.matiere].id,
        anneeAcademiqueId: annee.id, titre: p.titre, statut: 'EN_COURS' },
      { titre: p.titre, statut: 'EN_COURS' },
    );

    for (const ch of p.chapitres) {
      const existing = await prisma.chapitreProgamme.findFirst({
        where: { programmeId: prog.id, numero: ch.num },
      });
      if (!existing) {
        await prisma.chapitreProgamme.create({
          data: {
            programmeId: prog.id, numero: ch.num, titre: ch.titre,
            objectifs: `Objectifs pedagogiques du chapitre ${ch.num}`,
            periode: ch.periode, dateLimite: new Date('2026-06-30'),
            statut: ch.statut,
            dateDebut: ch.statut !== 'NON_COMMENCE' ? new Date('2025-11-01') : null,
            dateTermine: ch.statut === 'TERMINE' ? new Date('2026-01-15') : null,
          },
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 22. CALENDRIER SCOLAIRE (25+ events)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📆 Calendrier scolaire ...');

  const calDefs = [
    { titre: 'Rentree des enseignants', dateDebut: '2025-09-29', type: 'RENTREE', important: true },
    { titre: 'Rentree des eleves', dateDebut: '2025-10-06', type: 'RENTREE', important: true },
    { titre: 'Fete de la Tabaski', dateDebut: '2025-10-15', type: 'JOUR_FERIE' },
    { titre: 'Toussaint', dateDebut: '2025-11-01', type: 'JOUR_FERIE' },
    { titre: 'Date limite inscription', dateDebut: '2025-11-30', type: 'DATE_LIMITE_INSCRIPTION' },
    { titre: 'Date limite paiement T1', dateDebut: '2025-12-15', type: 'DATE_LIMITE_PAIEMENT' },
    { titre: 'Vacances de Noel', dateDebut: '2025-12-24', dateFin: '2026-01-05', type: 'VACANCES' },
    { titre: 'Compositions 1er trimestre - College/Lycee', dateDebut: '2026-01-20', dateFin: '2026-02-07', type: 'COMPOSITION' },
    { titre: 'Compositions 1er trimestre - Primaire', dateDebut: '2026-01-20', dateFin: '2026-02-06', type: 'COMPOSITION' },
    { titre: 'Conseil de classe T1', dateDebut: '2026-02-14', dateFin: '2026-02-21', type: 'CONSEIL_CLASSE' },
    { titre: 'Vacances de fevrier', dateDebut: '2026-02-21', dateFin: '2026-03-02', type: 'VACANCES' },
    { titre: 'Publication bulletins T1', dateDebut: '2026-02-28', type: 'PUBLICATION_BULLETINS' },
    { titre: 'Reunion parents-enseignants', dateDebut: '2026-03-07', type: 'REUNION_PARENTS', important: true },
    { titre: 'Formation enseignants', dateDebut: '2026-03-14', dateFin: '2026-03-15', type: 'FORMATION_ENSEIGNANTS' },
    { titre: 'Fete de l\'independance', dateDebut: '2026-04-04', type: 'JOUR_FERIE' },
    { titre: 'Compositions 2eme trimestre', dateDebut: '2026-04-06', dateFin: '2026-04-17', type: 'COMPOSITION' },
    { titre: 'Vacances de Paques', dateDebut: '2026-04-04', dateFin: '2026-04-20', type: 'VACANCES' },
    { titre: 'Journee culturelle et sportive', dateDebut: '2026-04-25', type: 'JOURNEE_CULTURELLE' },
    { titre: 'Conseil de classe T2', dateDebut: '2026-04-25', dateFin: '2026-05-02', type: 'CONSEIL_CLASSE' },
    { titre: 'Fete du travail', dateDebut: '2026-05-01', type: 'JOUR_FERIE' },
    { titre: 'Publication bulletins T2', dateDebut: '2026-05-09', type: 'PUBLICATION_BULLETINS' },
    { titre: 'Journee portes ouvertes', dateDebut: '2026-05-16', type: 'JOURNEE_PORTES_OUVERTES', important: true },
    { titre: 'Semaine de revision', dateDebut: '2026-06-01', dateFin: '2026-06-05', type: 'SEMAINE_REVISION' },
    { titre: 'Compositions 3eme trimestre / 2eme semestre', dateDebut: '2026-06-08', dateFin: '2026-06-19', type: 'COMPOSITION' },
    { titre: 'Examen BFEM', dateDebut: '2026-06-22', dateFin: '2026-06-26', type: 'EXAMEN_OFFICIEL', important: true },
    { titre: 'Baccalaureat', dateDebut: '2026-06-29', dateFin: '2026-07-04', type: 'EXAMEN_OFFICIEL', important: true },
    { titre: 'Conseil de classe T3', dateDebut: '2026-07-06', dateFin: '2026-07-10', type: 'CONSEIL_CLASSE' },
    { titre: 'Remise des prix', dateDebut: '2026-07-18', type: 'REMISE_PRIX', important: true },
    { titre: 'Fin d\'annee scolaire', dateDebut: '2026-07-31', type: 'FIN_ANNEE', important: true },
  ];

  for (const ev of calDefs) {
    const existing = await prisma.calendrierScolaire.findFirst({
      where: { tenantId: T, titre: ev.titre, dateDebut: new Date(ev.dateDebut) },
    });
    if (!existing) {
      await prisma.calendrierScolaire.create({
        data: {
          tenantId: T, titre: ev.titre,
          description: ev.titre,
          dateDebut: new Date(ev.dateDebut),
          dateFin: ev.dateFin ? new Date(ev.dateFin) : null,
          type: ev.type, statut: 'CONFIRME',
          important: ev.important || false,
          visibilites: ['TOUS'],
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 23. ABSENCES ENSEIGNANTS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📛 Absences enseignants ...');

  const absEnseDefs = [
    { prof: teacherAdja, dateDebut: '2026-01-20', dateFin: '2026-01-20', hd: '08:00', hf: '12:00', type: 'MALADIE', motif: 'Consultation medicale', statut: 'APPROUVEE' },
    { prof: teacherOusmane, dateDebut: '2026-02-05', dateFin: '2026-02-05', hd: '14:00', hf: '17:00', type: 'AUTRE', motif: 'Convocation administrative', statut: 'APPROUVEE' },
    { prof: teacherMoussa, dateDebut: '2026-03-15', dateFin: '2026-03-17', type: 'MALADIE', motif: 'Repos medical prescrit', statut: 'APPROUVEE' },
    { prof: teacherFatouD, dateDebut: '2026-04-10', dateFin: '2026-04-10', hd: '10:00', hf: '12:00', type: 'CONGE', motif: 'Conge personnel autorise', statut: 'EN_ATTENTE' },
    { prof: teacherIbrahimaS, dateDebut: '2026-05-02', dateFin: '2026-05-02', type: 'AUTRE', motif: 'Formation continue obligatoire', statut: 'APPROUVEE' },
  ];

  for (const a of absEnseDefs) {
    if (!a.prof) continue;
    const existing = await prisma.absenceEnseignant.findFirst({
      where: { tenantId: T, enseignantId: a.prof.id, dateDebut: new Date(a.dateDebut), motif: a.motif },
    });
    if (!existing) {
      await prisma.absenceEnseignant.create({
        data: {
          tenantId: T, enseignantId: a.prof.id,
          dateDebut: new Date(a.dateDebut), dateFin: new Date(a.dateFin),
          heureDebut: a.hd || null, heureFin: a.hf || null,
          typeAbsence: a.type, motif: a.motif, statut: a.statut,
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 24. ABSENCES PERSONNEL
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📛 Absences personnel ...');

  const personnelList = await prisma.personnel.findMany({ where: { tenantId: T }, take: 5 });
  const absPersDefs = [
    { motif: 'Maladie — certificat medical fourni', type: 'MALADIE', statut: 'APPROUVEE', dateDebut: '2026-02-10', dateFin: '2026-02-12' },
    { motif: 'Conge annuel', type: 'CONGE', statut: 'APPROUVEE', dateDebut: '2026-04-01', dateFin: '2026-04-05' },
    { motif: 'Absence injustifiee', type: 'AUTRE', statut: 'EN_ATTENTE', dateDebut: '2026-05-15', dateFin: '2026-05-15' },
    { motif: 'Conge de maternite', type: 'CONGE', statut: 'APPROUVEE', dateDebut: '2026-03-01', dateFin: '2026-05-31' },
    { motif: 'Rendez-vous medical', type: 'MALADIE', statut: 'APPROUVEE', dateDebut: '2026-06-10', dateFin: '2026-06-10' },
  ];
  for (let i = 0; i < Math.min(personnelList.length, absPersDefs.length); i++) {
    const a = absPersDefs[i];
    const existing = await prisma.absencePersonnel.findFirst({
      where: { tenantId: T, personnelId: personnelList[i].id, motif: a.motif },
    });
    if (!existing) {
      await prisma.absencePersonnel.create({
        data: {
          tenantId: T, personnelId: personnelList[i].id,
          dateDebut: new Date(a.dateDebut), dateFin: new Date(a.dateFin),
          motif: a.motif, typeAbsence: a.type, statut: a.statut,
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 25. POINTAGES PERSONNEL
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🕐 Pointages ...');

  for (const pers of personnelList) {
    for (let d = 1; d <= 5; d++) {
      const dateJ = new Date(`2026-05-${String(d + 10).padStart(2, '0')}`);
      const existing = await prisma.pointage.findFirst({
        where: { tenantId: T, personnelId: pers.id, date: dateJ },
      });
      if (!existing) {
        await prisma.pointage.create({
          data: { tenantId: T, personnelId: pers.id, typePointage: 'ENTREE', dateHeure: dateJ, date: dateJ,
            heureArrivee: '07:45', heureDepart: '17:00', statut: 'PRESENT', methode: 'MANUEL' },
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 26. ANNONCES (3+)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📣 Annonces ...');

  const annonceDefs = [
    { titre: 'Bienvenue pour la rentree 2025-2026', contenu: 'Toute l\'equipe pedagogique souhaite une excellente annee scolaire a nos eleves et leurs familles.', debut: '2025-10-01', fin: '2025-10-31' },
    { titre: 'Inscription cantine', contenu: 'Les inscriptions a la cantine sont ouvertes. Passez au secretariat avant le 30 octobre.', debut: '2025-10-07', fin: '2025-10-30' },
    { titre: 'Resultats du 1er trimestre', contenu: 'Les bulletins du 1er trimestre sont disponibles. Consultez votre espace parent.', debut: '2026-02-28', fin: '2026-03-15' },
    { titre: 'Inscriptions 2026-2027 ouvertes', contenu: 'Les pre-inscriptions pour l\'annee prochaine sont ouvertes. Places limitees.', debut: '2026-05-01', fin: '2026-06-30' },
  ];
  for (const a of annonceDefs) {
    await upsert('annonce', { tenantId: T, titre: a.titre },
      { tenantId: T, titre: a.titre, contenu: a.contenu, dateDebut: new Date(a.debut), dateFin: new Date(a.fin), actif: true },
      { contenu: a.contenu, dateDebut: new Date(a.debut), dateFin: new Date(a.fin), actif: true },
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 27. DEMANDES DE REDUCTION (5 avec statuts mixtes)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('💸 Demandes de reduction ...');

  const reductionDefs = [
    { classeNom: 'CI A', idx: 0, pourcentage: 20, motif: 'Difficultes financieres — famille nombreuse', statut: 'APPROUVEE' },
    { classeNom: '5eme A', idx: 1, pourcentage: 15, motif: 'Orphelin de pere — certificat fourni', statut: 'APPROUVEE' },
    { classeNom: 'Terminale A', idx: 2, pourcentage: 25, motif: 'Bourse non encore percue', statut: 'EN_ATTENTE' },
    { classeNom: '3eme A', idx: 0, pourcentage: 10, motif: 'Frere deja inscrit dans l\'etablissement', statut: 'EN_ATTENTE' },
    { classeNom: 'CM2 A', idx: 1, pourcentage: 50, motif: 'Demande de reduction excessive sans justificatif', statut: 'REJETEE' },
  ];

  for (const rd of reductionDefs) {
    const eleves = elevesByClasse[rd.classeNom] || [];
    if (!eleves[rd.idx]) continue;
    const insc = await prisma.inscription.findFirst({ where: { tenantId: T, eleveId: eleves[rd.idx].id, anneeAcademiqueId: annee.id } });
    const existing = await prisma.demandeReduction.findFirst({
      where: { tenantId: T, eleveId: eleves[rd.idx].id, motif: rd.motif },
    });
    if (!existing) {
      await prisma.demandeReduction.create({
        data: {
          tenantId: T, eleveId: eleves[rd.idx].id, inscriptionId: insc?.id || null,
          pourcentage: rd.pourcentage, motif: rd.motif, statut: rd.statut,
          demandePar: adminUser.id,
          traitePar: rd.statut !== 'EN_ATTENTE' ? adminUser.id : null,
          commentaireAdmin: rd.statut === 'REJETEE' ? 'Justificatif insuffisant' : rd.statut === 'APPROUVEE' ? 'Demande approuvee apres verification' : null,
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 28. DEMANDES DE PASSAGE (4 avec statuts mixtes)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🔄 Demandes de passage ...');

  const passageDefs = [
    { classeFrom: 'CI A', classeTo: 'CP A', idx: 0, motif: 'Eleve tres en avance sur le programme, passage anticipe', statut: 'APPROUVEE' },
    { classeFrom: '5eme A', classeTo: '4eme A', idx: 1, motif: 'Passage classique en classe superieure', statut: 'APPROUVEE' },
    { classeFrom: '3eme A', classeTo: 'Seconde A', idx: 2, motif: 'Passage en lycee sous reserve de l\'admission au BFEM', statut: 'EN_ATTENTE' },
    { classeFrom: 'CE2 A', classeTo: 'CM1 A', idx: 0, motif: 'Passage refuse — moyenne insuffisante', statut: 'REJETEE' },
  ];

  for (const pd of passageDefs) {
    const eleves = elevesByClasse[pd.classeFrom] || [];
    if (!eleves[pd.idx] || !classes[pd.classeTo]) continue;
    const existing = await prisma.demandePassage.findFirst({
      where: { tenantId: T, eleveId: eleves[pd.idx].id, classeDestId: classes[pd.classeTo].id },
    });
    if (!existing) {
      await prisma.demandePassage.create({
        data: {
          tenantId: T, eleveId: eleves[pd.idx].id, classeDestId: classes[pd.classeTo].id,
          anneeAcademiqueId: annee.id, motif: pd.motif, statut: pd.statut,
          creePar: adminUser.id,
          traitePar: pd.statut !== 'EN_ATTENTE' ? adminUser.id : null,
          motifRefus: pd.statut === 'REJETEE' ? 'Moyenne annuelle en dessous du seuil de passage' : null,
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 29. JOURNAL D'AUDIT (15+)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📜 Journal d\'audit ...');

  const auditDefs = [
    { action: 'CONNEXION', resource: 'auth', details: { description: 'Connexion reussie' }, role: 'ADMIN' },
    { action: 'CREATION', resource: 'inscription', details: { description: 'Inscription eleve Moussa Diop' }, role: 'ADMIN' },
    { action: 'MODIFICATION', resource: 'note', details: { description: 'Modification note Maths 5eme A' }, role: 'ENSEIGNANT' },
    { action: 'CREATION', resource: 'paiement', details: { description: 'Encaissement scolarite — 30 000 FCFA' }, role: 'CAISSIER' },
    { action: 'VALIDATION', resource: 'bulletin', details: { description: 'Validation bulletin T1 — 6eme A' }, role: 'ADMIN' },
    { action: 'SUPPRESSION', resource: 'absence', details: { description: 'Suppression absence injustifiee' }, role: 'SURVEILLANT' },
    { action: 'CREATION', resource: 'discipline', details: { description: 'Signalement incident — bagarre' }, role: 'SURVEILLANT' },
    { action: 'EXPORT', resource: 'bulletin', details: { description: 'Export PDF bulletins 3eme A T2' }, role: 'ADMIN' },
    { action: 'MODIFICATION', resource: 'user', details: { description: 'Mise a jour coordonnees parent' }, role: 'ADMIN' },
    { action: 'CONNEXION', resource: 'auth', details: { description: 'Connexion depuis mobile' }, role: 'PARENT' },
    { action: 'CONSULTATION', resource: 'bulletin', details: { description: 'Consultation bulletin eleve' }, role: 'PARENT' },
    { action: 'CREATION', resource: 'communication', details: { description: 'Envoi communication WhatsApp parents' }, role: 'ADMIN' },
    { action: 'MODIFICATION', resource: 'emploi_du_temps', details: { description: 'Modification EDT 5eme A' }, role: 'ADMIN' },
    { action: 'CREATION', resource: 'convocation', details: { description: 'Convocation parent — absences repetees' }, role: 'SURVEILLANT' },
    { action: 'VALIDATION', resource: 'paiement', details: { description: 'Validation paiement en attente' }, role: 'COMPTABLE' },
    { action: 'CREATION', resource: 'reduction', details: { description: 'Demande de reduction scolarite' }, role: 'ADMIN' },
    { action: 'CREATION', resource: 'passage', details: { description: 'Demande passage CI A vers CP A' }, role: 'ADMIN' },
    { action: 'MODIFICATION', resource: 'ecole_config', details: { description: 'Mise a jour informations ecole' }, role: 'ADMIN' },
  ];

  const roleUsers = {};
  for (const role of ['ADMIN', 'ENSEIGNANT', 'CAISSIER', 'SURVEILLANT', 'PARENT', 'COMPTABLE']) {
    roleUsers[role] = await prisma.user.findFirst({ where: { tenantId: T, role } });
  }

  const existingAuditCount = await prisma.auditLog.count({ where: { tenantId: T } });
  if (existingAuditCount < 50) {
    for (let i = 0; i < auditDefs.length; i++) {
      const a = auditDefs[i];
      const user = roleUsers[a.role];
      await prisma.auditLog.create({
        data: {
          tenantId: T, utilisateurId: user?.id || null,
          role: a.role, action: a.action, resourceType: a.resource,
          details: a.details,
          ipAddress: '192.168.1.' + (10 + i),
          userAgent: 'Mozilla/5.0 (seed)',
          userNomComplet: user ? `${user.firstName} ${user.lastName}` : 'Systeme',
          userEmail: user?.email || null,
          createdAt: new Date(Date.now() - (auditDefs.length - i) * 86400000),
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 30. SURVEILLANT-CYCLE LINKS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🔗 SurveillantCycle ...');

  const surveillants = await prisma.user.findMany({ where: { tenantId: T, role: 'SURVEILLANT' } });
  const cycleKeys = Object.keys(cycleMap);
  for (let i = 0; i < surveillants.length; i++) {
    const cycleName = cycleKeys[i % cycleKeys.length];
    await upsert('surveillantCycle', { surveillantId: surveillants[i].id, cycleId: cycleMap[cycleName].id },
      { tenantId: T, surveillantId: surveillants[i].id, cycleId: cycleMap[cycleName].id },
      { tenantId: T },
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  const counts = {};
  for (const model of ['user', 'cycle', 'niveau', 'classe', 'matiere', 'matiereNiveau', 'cours', 'inscription',
    'note', 'bulletin', 'absenceEleve', 'paiement', 'discipline', 'convocation', 'reclamation',
    'communication', 'programmePedagogique', 'calendrierScolaire', 'absenceEnseignant', 'absencePersonnel',
    'personnel', 'pointage', 'annonce', 'auditLog', 'emploiDuTemps', 'fraisNiveauConfig', 'eleveParent',
    'demandeReduction', 'demandePassage', 'professeurMatiere', 'surveillantCycle']) {
    counts[model] = await prisma[model].count({ where: { tenantId: T } }).catch(() => prisma[model].count());
  }

  console.log('\n✅ seed-full-demo termine !\n');
  console.log('Recap des donnees seedees :');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`\n  Password pour tous les comptes : ${PASSWORD}`);
}

main()
  .catch((err) => { console.error('❌ Erreur :', err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
