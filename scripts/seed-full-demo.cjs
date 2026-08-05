#!/usr/bin/env node
/**
 * seed-full-demo.cjs
 * Peuple la base avec des donnees realistes pour le tenant "Ecole Noura Dakar".
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
const { randomUUID, randomBytes } = require('node:crypto');

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
// Cherche le tenant par slug ou prend le premier tenant existant
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
  // Try by email first, then by matricule (for re-runs after partial failures)
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
    // Prend le premier tenant existant (Seydi Jamil, Ecole Noura, etc.)
    tenant = await prisma.tenant.findFirst({ where: { actif: true }, orderBy: { createdAt: 'asc' } });
  }
  if (!tenant) { console.error('Aucun tenant trouve en base — lance d\'abord seed-seydi-jamil.cjs ou seed.cjs'); process.exit(1); }
  console.log(`Tenant cible : ${tenant.nom} (${tenant.slug})`);
  const T = tenant.id;

  // ══════════════════════════════════════════════════════════════════════════
  // 1. STRUCTURE ACADEMIQUE : Cycles, Niveaux, FraisNiveauConfig
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📚 Cycles, niveaux, frais ...');

  const STRUCTURE = [
    { code: 'PRESCOLAIRE', nom: 'Prescolaire', typePeriode: 'SEMESTRE', moyenne: 10, ordre: 1, niveaux: [
      { code: 'PS', nom: 'Petite Section', ordre: 1 },
      { code: 'MS', nom: 'Moyenne Section', ordre: 2 },
      { code: 'GS', nom: 'Grande Section', ordre: 3 },
    ]},
    { code: 'PRIMAIRE', nom: 'Primaire', typePeriode: 'SEMESTRE', moyenne: 10, ordre: 2, niveaux: [
      { code: 'CI', nom: 'CI', ordre: 10 },
      { code: 'CP', nom: 'CP', ordre: 11 },
      { code: 'CE1', nom: 'CE1', ordre: 12 },
      { code: 'CE2', nom: 'CE2', ordre: 13 },
      { code: 'CM1', nom: 'CM1', ordre: 14 },
      { code: 'CM2', nom: 'CM2', ordre: 15 },
    ]},
    { code: 'COLLEGE', nom: 'College', typePeriode: 'TRIMESTRE', moyenne: 20, ordre: 3, niveaux: [
      { code: '6E', nom: '6eme', ordre: 20 },
      { code: '5E', nom: '5eme', ordre: 21 },
      { code: '4E', nom: '4eme', ordre: 22 },
      { code: '3E', nom: '3eme', ordre: 23 },
    ]},
    { code: 'LYCEE', nom: 'Lycee', typePeriode: 'TRIMESTRE', moyenne: 20, ordre: 4, niveaux: [
      { code: '2NDE', nom: 'Seconde', ordre: 30 },
      { code: '1ERE', nom: 'Premiere', ordre: 31 },
      { code: 'TLE', nom: 'Terminale', ordre: 32 },
    ]},
  ];

  const FRAIS_DEFAULT = { insc: 50000, mens: 25000 };
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
    'College|6eme': { insc: 80000, mens: 40000 },
    'College|5eme': { insc: 80000, mens: 40000 },
    'College|4eme': { insc: 85000, mens: 42000 },
    'College|3eme': { insc: 90000, mens: 45000 },
    'Lycee|Seconde':  { insc: 100000, mens: 50000 },
    'Lycee|Premiere': { insc: 105000, mens: 52000 },
    'Lycee|Terminale':{ insc: 110000, mens: 55000 },
  };

  const cycleMap = {};   // code -> record
  const niveauMap = {};  // code -> record

  for (const sec of STRUCTURE) {
    const cycle = await upsert('cycle', { tenantId: T, code: sec.code },
      { tenantId: T, code: sec.code, libelle: sec.nom, typePeriode: sec.typePeriode, moyenneMaximale: sec.moyenne, ordre: sec.ordre, actif: true },
      { libelle: sec.nom, typePeriode: sec.typePeriode, moyenneMaximale: sec.moyenne, ordre: sec.ordre, actif: true },
    );
    cycleMap[sec.code] = cycle;

    for (const niv of sec.niveaux) {
      const niveau = await upsert('niveau', { tenantId: T, code: niv.code },
        { tenantId: T, cycleId: cycle.id, code: niv.code, libelle: niv.nom, ordre: niv.ordre, actif: true },
        { cycleId: cycle.id, libelle: niv.nom, ordre: niv.ordre, actif: true },
      );
      niveauMap[niv.code] = niveau;

      const fk = `${sec.nom}|${niv.nom}`;
      const f = FRAIS[fk] || FRAIS_DEFAULT;
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
  // 4. CLASSES
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🏫 Classes ...');

  const classeDefs = [
    // Prescolaire A + B
    { nom: 'Petite Section A', niveau: 'PS', cycle: 'PRESCOLAIRE', salle: 'Salle 104', max: 30 },
    { nom: 'Petite Section B', niveau: 'PS', cycle: 'PRESCOLAIRE', salle: 'Salle 105', max: 30 },
    { nom: 'Moyenne Section A', niveau: 'MS', cycle: 'PRESCOLAIRE', salle: 'Salle 106', max: 30 },
    { nom: 'Moyenne Section B', niveau: 'MS', cycle: 'PRESCOLAIRE', salle: 'Salle 104', max: 30 },
    { nom: 'Grande Section A', niveau: 'GS', cycle: 'PRESCOLAIRE', salle: 'Salle 105', max: 30 },
    { nom: 'Grande Section B', niveau: 'GS', cycle: 'PRESCOLAIRE', salle: 'Salle 106', max: 30 },
    // Primaire A + B
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
    // College A + B
    { nom: '6eme A', niveau: '6E', cycle: 'COLLEGE', salle: 'Salle 201', max: 45 },
    { nom: '6eme B', niveau: '6E', cycle: 'COLLEGE', salle: 'Salle 202', max: 45 },
    { nom: '5eme A', niveau: '5E', cycle: 'COLLEGE', salle: 'Salle 203', max: 45 },
    { nom: '5eme B', niveau: '5E', cycle: 'COLLEGE', salle: 'Salle 204', max: 45 },
    { nom: '4eme A', niveau: '4E', cycle: 'COLLEGE', salle: 'Salle 205', max: 45 },
    { nom: '4eme B', niveau: '4E', cycle: 'COLLEGE', salle: 'Salle 206', max: 45 },
    { nom: '3eme A', niveau: '3E', cycle: 'COLLEGE', salle: 'Salle 207', max: 45 },
    { nom: '3eme B', niveau: '3E', cycle: 'COLLEGE', salle: 'Salle 208', max: 45 },
    // Lycee A + B
    { nom: 'Seconde A', niveau: '2NDE', cycle: 'LYCEE', salle: 'Salle 301', max: 45 },
    { nom: 'Seconde B', niveau: '2NDE', cycle: 'LYCEE', salle: 'Salle 302', max: 45 },
    { nom: 'Premiere A', niveau: '1ERE', cycle: 'LYCEE', salle: 'Salle 303', max: 45 },
    { nom: 'Premiere B', niveau: '1ERE', cycle: 'LYCEE', salle: 'Salle 304', max: 45 },
    { nom: 'Terminale A', niveau: 'TLE', cycle: 'LYCEE', salle: 'Salle 305', max: 45 },
    { nom: 'Terminale B', niveau: 'TLE', cycle: 'LYCEE', salle: 'Salle 306', max: 45 },
  ];

  const classes = {};
  for (const c of classeDefs) {
    classes[c.nom] = await upsert('classe',
      { tenantId: T, nom: c.nom, anneeAcademiqueId: annee.id },
      { tenantId: T, nom: c.nom, niveauId: niveauMap[c.niveau].id, cycleId: cycleMap[c.cycle].id,
        anneeAcademiqueId: annee.id, salleId: salles[c.salle].id, effectifMax: c.max, actif: true },
      { niveauId: niveauMap[c.niveau].id, cycleId: cycleMap[c.cycle].id,
        salleId: salles[c.salle].id, effectifMax: c.max, actif: true },
    );
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
    // Prescolaire
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
    // Primaire
    ...['CI', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'].flatMap(n => [
      { niveau: n, matiere: 'FR', coef: 3, max: 10 },
      { niveau: n, matiere: 'MATH', coef: 3, max: 10 },
      { niveau: n, matiere: 'LECT', coef: 2, max: 10 },
      { niveau: n, matiere: 'AR', coef: 1, max: 10 },
      { niveau: n, matiere: 'EPS', coef: 1, max: 10 },
      { niveau: n, matiere: 'EDCIV', coef: 1, max: 10 },
    ]),
    // College
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
    // Lycee
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
  // 7. ENSEIGNANTS SUPPLEMENTAIRES
  // ══════════════════════════════════════════════════════════════════════════
  console.log('👨‍🏫 Enseignants supplementaires ...');

  // Recup des profs existants
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

  // COMPTABLE + SECURITE users
  const comptable = await upsertUser(T, { prenom: 'Abdoulaye', nom: 'Diallo', role: 'COMPTABLE', telephone: SEED_PHONE }, hash);
  const securite1 = await upsertUser(T, { prenom: 'Moustapha', nom: 'Ndoye', role: 'SECURITE', telephone: SEED_PHONE }, hash);
  const securite2 = await upsertUser(T, { prenom: 'Babacar', nom: 'Faye', role: 'SECURITE', telephone: SEED_PHONE }, hash);

  // Get all staff users for Personnel records
  const staffUsers = await prisma.user.findMany({
    where: { tenantId: T, role: { in: ['ADMIN', 'CAISSIER', 'SURVEILLANT', 'ENSEIGNANT', 'RH', 'COMPTABLE', 'SECURITE'] } },
  });

  const contratTypes = { ADMIN: 'CDI', CAISSIER: 'CDD', SURVEILLANT: 'CDD', ENSEIGNANT: 'CDI', RH: 'CDI', COMPTABLE: 'CDI', SECURITE: 'CDD' };
  const salaires = { ADMIN: 450000, CAISSIER: 300000, SURVEILLANT: 280000, ENSEIGNANT: 520000, RH: 400000, COMPTABLE: 380000, SECURITE: 250000 };
  let persMatCounter = 1;

  for (const u of staffUsers) {
    const existing = await prisma.personnel.findFirst({ where: { utilisateurId: u.id } });
    if (existing) continue;
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
  // 9. ELEVES EN MASSE (5 par classe)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🎒 Eleves ...');

  const prenomsMasc = ['Amadou', 'Moussa', 'Ibrahima', 'Ousmane', 'Cheikh', 'Modou', 'Pape', 'Saliou', 'Fallou', 'Thierno', 'Lamine', 'Serigne', 'Malick', 'Babacar', 'Bamba', 'Gora', 'Seydou', 'Alioune', 'Biram', 'Ndiaga'];
  const prenomsFem = ['Fatou', 'Awa', 'Aminata', 'Khady', 'Mariama', 'Ndéye', 'Coumba', 'Rokhaya', 'Aissatou', 'Sokhna', 'Yacine', 'Seynabou', 'Rama', 'Penda', 'Dior', 'Binta', 'Mame', 'Fanta', 'Maty', 'Tida'];
  const noms = ['Diop', 'Ndiaye', 'Fall', 'Sow', 'Gueye', 'Sarr', 'Diallo', 'Kane', 'Thiam', 'Mbaye', 'Camara', 'Cisse', 'Diouf', 'Faye', 'Toure', 'Badji', 'Ndoye', 'Samb', 'Sy', 'Mendy'];

  const adminUser = await prisma.user.findFirst({ where: { tenantId: T, role: 'ADMIN' } });
  let eleveCounter = 100;
  const elevesByClasse = {};

  for (const [classeNom, classeRec] of Object.entries(classes)) {
    elevesByClasse[classeNom] = [];
    // Generate 8 students per class
    for (let i = 0; i < 8; i++) {
      const isFemale = i % 2 === 1;
      const prenom = isFemale ? prenomsFem[(eleveCounter + i) % prenomsFem.length] : prenomsMasc[(eleveCounter + i) % prenomsMasc.length];
      const nom = noms[(eleveCounter + i * 3) % noms.length];
      const suffix = `.${eleveCounter}`;
      const yearBirth = classeRec.nom.includes('Petite') ? 2021 : classeRec.nom.includes('Moyenne') ? 2020
        : classeRec.nom.includes('Grande') ? 2019 : classeRec.nom.includes('CI') ? 2018
        : classeRec.nom.includes('CP') ? 2017 : classeRec.nom.includes('CE1') ? 2016
        : classeRec.nom.includes('CE2') ? 2015 : classeRec.nom.includes('CM1') ? 2014
        : classeRec.nom.includes('CM2') ? 2013 : classeRec.nom.includes('6eme') ? 2012
        : classeRec.nom.includes('5eme') ? 2011 : classeRec.nom.includes('4eme') ? 2010
        : classeRec.nom.includes('3eme') ? 2009 : classeRec.nom.includes('Seconde') ? 2008
        : classeRec.nom.includes('Premiere') ? 2007 : 2006;

      const eleve = await upsertUser(T, {
        prenom, nom, role: 'ELEVE', email: email(prenom, nom, suffix),
        username: `${slug(prenom)}.${slug(nom)}${suffix}`,
        matricule: `ELV-2025-${String(eleveCounter).padStart(4, '0')}`,
        dateNaissance: new Date(`${yearBirth}-${String((i * 3 + 2) % 12 + 1).padStart(2, '0')}-${String((i * 5 + 3) % 28 + 1).padStart(2, '0')}`),
        genre: isFemale ? 'F' : 'M',
        dateInscription: new Date('2025-10-07'),
        classeId: classeRec.id,
        lieuNaissance: ['Dakar', 'Thies', 'Saint-Louis', 'Kaolack', 'Ziguinchor'][i % 5],
      }, hash);

      // Inscription
      await upsert('inscription',
        { numeroInscription: `INS-${SCHOOL_YEAR}-${String(eleveCounter).padStart(4, '0')}` },
        { tenantId: T, numeroInscription: `INS-${SCHOOL_YEAR}-${String(eleveCounter).padStart(4, '0')}`,
          eleveId: eleve.id, classeId: classeRec.id, anneeAcademiqueId: annee.id,
          statut: 'ACTIF', creePar: adminUser.id },
        { eleveId: eleve.id, classeId: classeRec.id, anneeAcademiqueId: annee.id, statut: 'ACTIF', creePar: adminUser.id },
      );

      elevesByClasse[classeNom].push(eleve);
      eleveCounter++;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10. PARENTS (1 parent pour chaque paire d'eleves)
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

    // Link parent to 1 or 2 eleves
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

  // Teacher assignments
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

  // Prescolaire — Mariama Niang (A + B)
  for (const cl of ['Petite Section A', 'Petite Section B', 'Moyenne Section A', 'Moyenne Section B', 'Grande Section A', 'Grande Section B']) {
    await mkCours('EVEIL', teacherMariamaN, cl, 6, 2);
    await mkCours('MOTR', teacherMariamaN, cl, 3, 1);
    await mkCours('FR', teacherMariamaN, cl, 4, 2);
    if (cl.includes('Moyenne') || cl.includes('Grande')) await mkCours('MATH', teacherMariamaN, cl, 3, 2);
    if (cl.includes('Grande')) await mkCours('LECT', teacherMariamaN, cl, 3, 2);
  }

  // Primaire — Adja (CI, CP A+B), Modou (CE1-CM2 A+B)
  for (const cl of ['CI A', 'CI B', 'CP A', 'CP B']) {
    await mkCours('FR', teacherAdja, cl, 6, 3);
    await mkCours('MATH', teacherAdja, cl, 5, 3);
    await mkCours('LECT', teacherAdja, cl, 4, 2);
    await mkCours('AR', teacherAdja, cl, 3, 1);
    await mkCours('EPS', teacherAdja, cl, 2, 1);
  }
  for (const cl of ['CE1 A', 'CE1 B', 'CE2 A', 'CE2 B', 'CM1 A', 'CM1 B', 'CM2 A', 'CM2 B']) {
    await mkCours('FR', teacherModou, cl, 6, 3);
    await mkCours('MATH', teacherModou, cl, 5, 3);
    await mkCours('LECT', teacherModou, cl, 4, 2);
    await mkCours('AR', teacherModou, cl, 3, 1);
    await mkCours('EPS', teacherAissatou, cl, 2, 1);
    await mkCours('EDCIV', teacherModou, cl, 1, 1);
  }

  // College — multiple profs (A + B)
  for (const cl of ['6eme A', '6eme B', '5eme A', '5eme B', '4eme A', '4eme B', '3eme A', '3eme B']) {
    await mkCours('FR', teacherAdja, cl, 5, 4);
    await mkCours('MATH', teacherOusmane, cl, 5, 4);
    await mkCours('ANG', teacherMoussa, cl, 3, 2);
    await mkCours('AR', teacherMoussa, cl, 2, 2);
    await mkCours('HG', teacherFatouD, cl, 3, 3);
    await mkCours('SVT', teacherIbrahimaS, cl, 3, 2);
    await mkCours('PC', teacherIbrahimaS, cl, 3, 2);
    await mkCours('EPS', teacherAissatou, cl, 2, 1);
    await mkCours('EDCIV', teacherFatouD, cl, 1, 1);
  }

  // Lycee (A + B)
  for (const cl of ['Seconde A', 'Seconde B', 'Premiere A', 'Premiere B', 'Terminale A', 'Terminale B']) {
    await mkCours('FR', teacherAdja, cl, 4, 4);
    await mkCours('MATH', teacherNdeye || teacherOusmane, cl, 5, 5);
    await mkCours('ANG', teacherMoussa, cl, 3, 2);
    await mkCours('HG', teacherFatouD, cl, 3, 3);
    await mkCours('SVT', teacherIbrahimaS, cl, 3, 3);
    await mkCours('PC', teacherIbrahimaS, cl, 4, 4);
    await mkCours('EPS', teacherAissatou, cl, 2, 1);
    await mkCours('PHILO', teacherCheikh, cl, cl === 'Terminale A' ? 4 : 2, cl === 'Terminale A' ? 4 : 2);
    await mkCours('ECO', teacherCheikh, cl, 2, 2);
    await mkCours('INFO', teacherAissatou, cl, 2, 1);
  }

  // ── ProfesseurMatiere links ──
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
  // 12. EMPLOI DU TEMPS (3 classes representatives)
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
    ['LUNDI','FR',teacherAdja,'08:00','10:00'], ['LUNDI','MATH',teacherAdja,'10:00','12:00'],
    ['LUNDI','LECT',teacherAdja,'15:00','16:00'], ['LUNDI','EPS',teacherAdja,'16:00','17:00'],
    ['MARDI','MATH',teacherAdja,'08:00','10:00'], ['MARDI','FR',teacherAdja,'10:00','12:00'],
    ['MARDI','AR',teacherAdja,'15:00','16:00'], ['MARDI','LECT',teacherAdja,'16:00','17:00'],
    ['MERCREDI','FR',teacherAdja,'08:00','10:00'], ['MERCREDI','MATH',teacherAdja,'10:00','12:00'],
    ['JEUDI','MATH',teacherAdja,'08:00','10:00'], ['JEUDI','LECT',teacherAdja,'10:00','12:00'],
    ['JEUDI','FR',teacherAdja,'15:00','16:00'], ['JEUDI','AR',teacherAdja,'16:00','17:00'],
    ['VENDREDI','FR',teacherAdja,'08:00','10:00'], ['VENDREDI','EPS',teacherAdja,'10:00','11:00'],
    ['VENDREDI','MATH',teacherAdja,'15:00','16:00'], ['VENDREDI','LECT',teacherAdja,'16:00','17:00'],
  ];
  for (const [j,m,e,hd,hf] of ciSlots) await mkEdt('CI A', m, e, j, hd, hf);

  // 5eme A
  const c5Slots = [
    ['LUNDI','FR',teacherAdja,'08:00','09:30'], ['LUNDI','MATH',teacherOusmane,'10:00','11:30'],
    ['LUNDI','ANG',teacherMoussa,'14:00','15:30'], ['LUNDI','HG',teacherFatouD,'15:30','17:00'],
    ['MARDI','MATH',teacherOusmane,'08:00','09:30'], ['MARDI','SVT',teacherIbrahimaS,'10:00','11:30'],
    ['MARDI','FR',teacherAdja,'14:00','15:30'], ['MARDI','PC',teacherIbrahimaS,'15:30','17:00'],
    ['MERCREDI','ANG',teacherMoussa,'08:00','09:30'], ['MERCREDI','HG',teacherFatouD,'10:00','11:30'],
    ['JEUDI','FR',teacherAdja,'08:00','09:30'], ['JEUDI','MATH',teacherOusmane,'10:00','11:30'],
    ['JEUDI','EPS',teacherAissatou,'14:00','15:30'], ['JEUDI','AR',teacherMoussa,'15:30','17:00'],
    ['VENDREDI','SVT',teacherIbrahimaS,'08:00','09:30'], ['VENDREDI','MATH',teacherOusmane,'10:00','11:30'],
    ['VENDREDI','FR',teacherAdja,'14:00','15:30'],
  ];
  for (const [j,m,e,hd,hf] of c5Slots) await mkEdt('5eme A', m, e, j, hd, hf);

  // Terminale A
  const tSlots = [
    ['LUNDI','MATH',teacherNdeye||teacherOusmane,'08:00','10:00'], ['LUNDI','PHILO',teacherCheikh,'10:00','12:00'],
    ['LUNDI','PC',teacherIbrahimaS,'14:00','16:00'],
    ['MARDI','FR',teacherAdja,'08:00','10:00'], ['MARDI','SVT',teacherIbrahimaS,'10:00','12:00'],
    ['MARDI','ECO',teacherCheikh,'14:00','16:00'],
    ['MERCREDI','MATH',teacherNdeye||teacherOusmane,'08:00','10:00'], ['MERCREDI','ANG',teacherMoussa,'10:00','12:00'],
    ['JEUDI','PC',teacherIbrahimaS,'08:00','10:00'], ['JEUDI','HG',teacherFatouD,'10:00','12:00'],
    ['JEUDI','INFO',teacherAissatou,'14:00','16:00'],
    ['VENDREDI','FR',teacherAdja,'08:00','10:00'], ['VENDREDI','PHILO',teacherCheikh,'10:00','12:00'],
    ['VENDREDI','EPS',teacherAissatou,'14:00','16:00'],
  ];
  for (const [j,m,e,hd,hf] of tSlots) await mkEdt('Terminale A', m, e, j, hd, hf);

  // ══════════════════════════════════════════════════════════════════════════
  // 13. NOTES (pour 3 classes : CI A, 5eme A, Terminale A)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📊 Notes ...');

  async function mkNote(eleveId, mCode, trimestre, type, note, noteSur, commentaire) {
    if (!matieres[mCode]) return;
    const cours = await prisma.cours.findFirst({
      where: { tenantId: T, matiereId: matieres[mCode].id, classe: { eleves: { some: { id: eleveId } } } },
    });
    const data = {
      tenantId: T, eleveId, matiereId: matieres[mCode].id, coursId: cours?.id || null,
      typeEvaluation: type, note, noteSur, trimestre, anneeScolaire: SCHOOL_YEAR,
      commentaire, dateEvaluation: new Date(`2026-${trimestre.includes('1') ? '01' : trimestre.includes('2') ? '04' : '06'}-15`),
    };
    const existing = await prisma.note.findFirst({
      where: { tenantId: T, eleveId, matiereId: matieres[mCode].id, trimestre, typeEvaluation: type, commentaire },
    });
    if (existing) return prisma.note.update({ where: { id: existing.id }, data });
    return prisma.note.create({ data });
  }

  // Generate notes for ALL classes (A + B)
  const noteClasses = [];
  // Prescolaire
  for (const s of ['A', 'B']) {
    noteClasses.push({ classe: `Petite Section ${s}`, mats: ['EVEIL', 'MOTR', 'FR'], periodes: ['SEMESTRE_1', 'SEMESTRE_2'], maxNote: 10 });
    noteClasses.push({ classe: `Moyenne Section ${s}`, mats: ['EVEIL', 'MOTR', 'FR', 'MATH'], periodes: ['SEMESTRE_1', 'SEMESTRE_2'], maxNote: 10 });
    noteClasses.push({ classe: `Grande Section ${s}`, mats: ['EVEIL', 'FR', 'MATH', 'LECT'], periodes: ['SEMESTRE_1', 'SEMESTRE_2'], maxNote: 10 });
  }
  // Primaire
  for (const n of ['CI', 'CP', 'CE1', 'CE2', 'CM1', 'CM2']) {
    for (const s of ['A', 'B']) {
      noteClasses.push({ classe: `${n} ${s}`, mats: ['FR', 'MATH', 'LECT', 'AR'], periodes: ['SEMESTRE_1', 'SEMESTRE_2'], maxNote: 10 });
    }
  }
  // College
  for (const n of ['6eme', '5eme', '4eme', '3eme']) {
    for (const s of ['A', 'B']) {
      noteClasses.push({ classe: `${n} ${s}`, mats: ['FR', 'MATH', 'ANG', 'HG', 'SVT', 'PC'], periodes: ['TRIMESTRE_1', 'TRIMESTRE_2', 'TRIMESTRE_3'], maxNote: 20 });
    }
  }
  // Lycee
  for (const n of ['Seconde', 'Premiere', 'Terminale']) {
    for (const s of ['A', 'B']) {
      noteClasses.push({ classe: `${n} ${s}`, mats: ['FR', 'MATH', 'ANG', 'PC', 'SVT', 'PHILO', 'ECO'], periodes: ['TRIMESTRE_1', 'TRIMESTRE_2', 'TRIMESTRE_3'], maxNote: 20 });
    }
  }

  for (const nc of noteClasses) {
    const eleves = elevesByClasse[nc.classe] || [];
    for (const eleve of eleves) {
      for (const period of nc.periodes) {
        for (const mCode of nc.mats) {
          const base = 5 + Math.floor(Math.random() * (nc.maxNote - 5));
          await mkNote(eleve.id, mCode, period, 'DEVOIR', Math.min(nc.maxNote, base), nc.maxNote, 'Devoir 1');
          await mkNote(eleve.id, mCode, period, 'DEVOIR', Math.min(nc.maxNote, base + 1), nc.maxNote, 'Devoir 2');
          await mkNote(eleve.id, mCode, period, 'COMPOSITION', Math.min(nc.maxNote, base + 2), nc.maxNote, 'Composition');
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 14. BULLETINS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📋 Bulletins ...');

  for (const nc of noteClasses) {
    const eleves = elevesByClasse[nc.classe] || [];
    for (let idx = 0; idx < eleves.length; idx++) {
      for (const period of nc.periodes) {
        const moy = 8 + Math.random() * 8;
        await upsert('bulletin',
          { eleveId: eleves[idx].id, classeId: classes[nc.classe].id, trimestre: period, anneeScolaire: SCHOOL_YEAR },
          { tenantId: T, eleveId: eleves[idx].id, classeId: classes[nc.classe].id,
            trimestre: period, anneeScolaire: SCHOOL_YEAR,
            moyenne: Math.round(moy * 100) / 100, moyenneClasse: 12.5,
            rang: idx + 1, totalEleves: eleves.length,
            appreciation: moy > 14 ? 'Tres bien' : moy > 12 ? 'Bien' : moy > 10 ? 'Assez bien' : 'Insuffisant',
            nombreAbsences: Math.floor(Math.random() * 5), nombreRetards: Math.floor(Math.random() * 3),
            statut: period === nc.periodes[nc.periodes.length - 1] ? 'BROUILLON' : 'PUBLIE' },
          { moyenne: Math.round(moy * 100) / 100, moyenneClasse: 12.5, rang: idx + 1 },
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
    for (const eleve of eleves.slice(0, 3)) { // 3 absences par classe
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
  // 16. PAIEMENTS (scolarite)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('💰 Paiements ...');

  let paiCounter = 1;
  for (const [classeNom, eleves] of Object.entries(elevesByClasse)) {
    for (const eleve of eleves.slice(0, 3)) {
      const insc = await prisma.inscription.findFirst({ where: { tenantId: T, eleveId: eleve.id, anneeAcademiqueId: annee.id } });
      if (!insc) continue;
      for (let mois = 0; mois < 3; mois++) {
        const ref = `PAY-${SCHOOL_YEAR}-${String(paiCounter).padStart(5, '0')}`;
        const existing = await prisma.paiement.findFirst({ where: { reference: ref } });
        if (!existing) {
          await prisma.paiement.create({
            data: {
              tenantId: T, inscriptionId: insc.id, eleveId: eleve.id, reference: ref,
              montant: 30000 + (mois * 5000), typePaiement: mois === 0 ? 'INSCRIPTION' : 'SCOLARITE',
              modePaiement: ['ESPECES', 'MOBILE_MONEY', 'VIREMENT'][mois % 3],
              statut: 'VALIDE', anneeScolaire: SCHOOL_YEAR,
              trimestre: mois < 1 ? null : `TRIMESTRE_${mois}`,
              datePaiement: new Date(`2025-${String(10 + mois).padStart(2, '0')}-${String(5 + mois * 3).padStart(2, '0')}`),
              validePar: adminUser.id,
            },
          });
        }
        paiCounter++;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 17. DISCIPLINES
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
          dateIncident: new Date(`2026-0${2 + i}-${10 + i}`),
          gravite: d.gravite, statut: d.statut,
          sanction: d.sanction || null,
          rapporteur: 'Administration', rapporteurRole: 'ADMIN',
          signaleParId: adminUser.id,
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 18. CONVOCATIONS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📬 Convocations ...');

  const convocParents = await prisma.eleveParent.findMany({
    where: { eleve: { tenantId: T } },
    take: 5,
    include: { eleve: true },
  });

  for (let i = 0; i < Math.min(5, convocParents.length); i++) {
    const cp = convocParents[i];
    const existing = await prisma.convocation.findFirst({
      where: { tenantId: T, parentId: cp.parentId, eleveId: cp.eleveId },
    });
    if (!existing) {
      await prisma.convocation.create({
        data: {
          tenantId: T, parentId: cp.parentId, eleveId: cp.eleveId,
          motif: ['Absences repetees', 'Resultats en baisse', 'Comportement a ameliorer', 'Reunion pedagogique', 'Suivi scolaire'][i % 5],
          type: i < 3 ? 'DISCIPLINAIRE' : 'PEDAGOGIQUE',
          dateConvocation: new Date(`2026-0${3 + i % 4}-${10 + i * 3}`),
          statut: i < 2 ? 'EN_ATTENTE' : 'TRAITEE',
          observations: i >= 2 ? 'Entretien realise avec le parent' : null,
          creePar: adminUser.id,
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 19. RECLAMATIONS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📝 Reclamations ...');

  const reclaDefs = [
    { classe: '5eme A', idx: 0, mat: 'MATH', tri: 'TRIMESTRE_1', motif: 'La note semble inferieure a ce qui etait annonce oralement', statut: 'EN_ATTENTE' },
    { classe: '5eme A', idx: 1, mat: 'FR', tri: 'TRIMESTRE_2', motif: 'Erreur de calcul dans le total de la composition', statut: 'TRAITEE', reponse: 'Correction effectuee, note mise a jour' },
    { classe: 'Terminale A', idx: 0, mat: 'PC', tri: 'TRIMESTRE_1', motif: 'Demande de revision de la copie de Physique-Chimie', statut: 'EN_ATTENTE' },
    { classe: 'CI A', idx: 0, mat: 'MATH', tri: 'SEMESTRE_1', motif: 'Le parent conteste la note du devoir de mathematiques', statut: 'REJETEE', reponse: 'Note verifiee, conforme a la correction' },
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
  // 20. COMMUNICATIONS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📢 Communications ...');

  const commDefs = [
    { titre: 'Rentree scolaire 2025-2026', contenu: 'La rentree des classes est fixee au 6 octobre 2025. Tous les eleves sont attendus a 8h00.', canal: 'IN_APP', statut: 'ENVOYE', roles: ['PARENT', 'ELEVE', 'ENSEIGNANT'] },
    { titre: 'Reunion parents-enseignants', contenu: 'Une reunion parents-professeurs se tiendra le samedi 15 novembre 2025 de 9h a 12h.', canal: 'EMAIL', statut: 'ENVOYE', roles: ['PARENT'] },
    { titre: 'Rappel paiement mensualite', contenu: 'Nous rappelons aux parents que la mensualite de janvier est a payer avant le 10 janvier 2026.', canal: 'WHATSAPP', statut: 'ENVOYE', roles: ['PARENT'] },
    { titre: 'Compositions du 1er trimestre', contenu: 'Les compositions du premier trimestre debuteront le 20 janvier 2026 pour le college et le lycee.', canal: 'IN_APP', statut: 'ENVOYE', roles: ['ELEVE', 'PARENT', 'ENSEIGNANT'] },
    { titre: 'Journee portes ouvertes', contenu: 'L\'ecole Noura organise une journee portes ouvertes le 8 mars 2026. Tous sont les bienvenus.', canal: 'IN_APP', statut: 'BROUILLON', roles: ['PARENT', 'ELEVE'] },
    { titre: 'Resultat conseil de discipline', contenu: 'Suite au conseil de discipline du 12 avril, les decisions seront communiquees individuellement.', canal: 'EMAIL', statut: 'ENVOYE', roles: ['PARENT'] },
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
          envoyeLe: c.statut === 'ENVOYE' ? new Date(`2025-${String(10 + i).padStart(2, '0')}-${String(5 + i * 2).padStart(2, '0')}`) : null,
          auteurId: adminUser.id,
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 21. PROGRAMMES PEDAGOGIQUES
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📘 Programmes pedagogiques ...');

  const progDefs = [
    { niveau: '6E', matiere: 'MATH', titre: 'Programme Maths 6eme', chapitres: [
      { num: 1, titre: 'Nombres et calculs', periode: 'TRIMESTRE_1', statut: 'TERMINE' },
      { num: 2, titre: 'Geometrie plane', periode: 'TRIMESTRE_1', statut: 'TERMINE' },
      { num: 3, titre: 'Fractions et decimaux', periode: 'TRIMESTRE_2', statut: 'EN_COURS' },
      { num: 4, titre: 'Proportionnalite', periode: 'TRIMESTRE_2', statut: 'NON_COMMENCE' },
      { num: 5, titre: 'Statistiques', periode: 'TRIMESTRE_3', statut: 'NON_COMMENCE' },
    ]},
    { niveau: '3E', matiere: 'FR', titre: 'Programme Francais 3eme', chapitres: [
      { num: 1, titre: 'Le recit autobiographique', periode: 'TRIMESTRE_1', statut: 'TERMINE' },
      { num: 2, titre: 'L\'argumentation', periode: 'TRIMESTRE_1', statut: 'TERMINE' },
      { num: 3, titre: 'La poesie engagee', periode: 'TRIMESTRE_2', statut: 'EN_COURS' },
      { num: 4, titre: 'Le theatre contemporain', periode: 'TRIMESTRE_3', statut: 'NON_COMMENCE' },
    ]},
    { niveau: 'TLE', matiere: 'PHILO', titre: 'Programme Philosophie Terminale', chapitres: [
      { num: 1, titre: 'La conscience et l\'inconscient', periode: 'TRIMESTRE_1', statut: 'TERMINE' },
      { num: 2, titre: 'La liberte', periode: 'TRIMESTRE_1', statut: 'TERMINE' },
      { num: 3, titre: 'L\'Etat et la justice', periode: 'TRIMESTRE_2', statut: 'EN_COURS' },
      { num: 4, titre: 'La verite et la science', periode: 'TRIMESTRE_2', statut: 'NON_COMMENCE' },
      { num: 5, titre: 'L\'art et le beau', periode: 'TRIMESTRE_3', statut: 'NON_COMMENCE' },
      { num: 6, titre: 'Le devoir et la morale', periode: 'TRIMESTRE_3', statut: 'NON_COMMENCE' },
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
  // 22. CALENDRIER SCOLAIRE
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📆 Calendrier scolaire ...');

  const calDefs = [
    { titre: 'Rentree des enseignants', dateDebut: '2025-09-29', type: 'RENTREE', important: true },
    { titre: 'Rentree des eleves', dateDebut: '2025-10-06', type: 'RENTREE', important: true },
    { titre: 'Fete de la Tabaski', dateDebut: '2025-10-15', type: 'JOUR_FERIE' },
    { titre: 'Toussaint', dateDebut: '2025-11-01', type: 'JOUR_FERIE' },
    { titre: 'Vacances de Noel', dateDebut: '2025-12-24', dateFin: '2026-01-05', type: 'VACANCES' },
    { titre: 'Compositions 1er trimestre - College/Lycee', dateDebut: '2026-01-20', dateFin: '2026-02-07', type: 'COMPOSITION' },
    { titre: 'Compositions 1er semestre - Primaire', dateDebut: '2026-01-20', dateFin: '2026-02-06', type: 'COMPOSITION' },
    { titre: 'Conseil de classe T1', dateDebut: '2026-02-14', dateFin: '2026-02-21', type: 'CONSEIL_CLASSE' },
    { titre: 'Publication bulletins T1', dateDebut: '2026-02-28', type: 'PUBLICATION_BULLETINS' },
    { titre: 'Vacances de fevrier', dateDebut: '2026-02-21', dateFin: '2026-03-02', type: 'VACANCES' },
    { titre: 'Reunion parents-enseignants', dateDebut: '2026-03-07', type: 'REUNION_PARENTS', important: true },
    { titre: 'Compositions 2eme trimestre', dateDebut: '2026-04-06', dateFin: '2026-04-17', type: 'COMPOSITION' },
    { titre: 'Vacances de Paques', dateDebut: '2026-04-04', dateFin: '2026-04-20', type: 'VACANCES' },
    { titre: 'Conseil de classe T2', dateDebut: '2026-04-25', dateFin: '2026-05-02', type: 'CONSEIL_CLASSE' },
    { titre: 'Publication bulletins T2', dateDebut: '2026-05-09', type: 'PUBLICATION_BULLETINS' },
    { titre: 'Fete du travail', dateDebut: '2026-05-01', type: 'JOUR_FERIE' },
    { titre: 'Journee portes ouvertes', dateDebut: '2026-05-16', type: 'JOURNEE_PORTES_OUVERTES', important: true },
    { titre: 'Semaine de revision', dateDebut: '2026-06-01', dateFin: '2026-06-05', type: 'SEMAINE_REVISION' },
    { titre: 'Compositions 3eme trimestre', dateDebut: '2026-06-08', dateFin: '2026-06-19', type: 'COMPOSITION' },
    { titre: 'Examen BFEM', dateDebut: '2026-06-22', dateFin: '2026-06-26', type: 'EXAMEN_OFFICIEL', important: true },
    { titre: 'Baccalaureat', dateDebut: '2026-06-29', dateFin: '2026-07-04', type: 'EXAMEN_OFFICIEL', important: true },
    { titre: 'Conseil de classe T3', dateDebut: '2026-07-06', dateFin: '2026-07-10', type: 'CONSEIL_CLASSE' },
    { titre: 'Remise des prix', dateDebut: '2026-07-18', type: 'REMISE_PRIX', important: true },
    { titre: 'Journee culturelle et sportive', dateDebut: '2026-04-25', type: 'JOURNEE_CULTURELLE' },
    { titre: 'Formation enseignants', dateDebut: '2026-03-14', dateFin: '2026-03-15', type: 'FORMATION_ENSEIGNANTS' },
    { titre: 'Date limite inscription', dateDebut: '2025-11-30', type: 'DATE_LIMITE_INSCRIPTION' },
    { titre: 'Date limite paiement T1', dateDebut: '2025-12-15', type: 'DATE_LIMITE_PAIEMENT' },
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

  const personnelList = await prisma.personnel.findMany({ where: { tenantId: T }, take: 3 });
  const absPersDefs = [
    { motif: 'Maladie — certificat medical fourni', type: 'MALADIE', statut: 'APPROUVEE', dateDebut: '2026-02-10', dateFin: '2026-02-12' },
    { motif: 'Conge annuel', type: 'CONGE', statut: 'APPROUVEE', dateDebut: '2026-04-01', dateFin: '2026-04-05' },
    { motif: 'Absence injustifiee', type: 'AUTRE', statut: 'EN_ATTENTE', dateDebut: '2026-05-15', dateFin: '2026-05-15' },
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
  // 26. ANNONCES
  // ══════════════════════════════════════════════════════════════════════════
  console.log('📣 Annonces ...');

  const annonceDefs = [
    { titre: 'Bienvenue pour la rentree 2025-2026', contenu: 'Toute l\'equipe pedagogique souhaite une excellente annee scolaire a nos eleves et leurs familles.', debut: '2025-10-01', fin: '2025-10-31' },
    { titre: 'Inscription cantine', contenu: 'Les inscriptions a la cantine sont ouvertes. Passez au secretariat avant le 30 octobre.', debut: '2025-10-07', fin: '2025-10-30' },
    { titre: 'Resultats du 1er trimestre', contenu: 'Les bulletins du 1er trimestre sont disponibles. Consultez votre espace parent.', debut: '2026-02-28', fin: '2026-03-15' },
  ];
  for (const a of annonceDefs) {
    await upsert('annonce', { tenantId: T, titre: a.titre },
      { tenantId: T, titre: a.titre, contenu: a.contenu, dateDebut: new Date(a.debut), dateFin: new Date(a.fin), actif: true },
      { contenu: a.contenu, dateDebut: new Date(a.debut), dateFin: new Date(a.fin), actif: true },
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 27. JOURNAL D'AUDIT
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
  ];

  const roleUsers = {};
  for (const role of ['ADMIN', 'ENSEIGNANT', 'CAISSIER', 'SURVEILLANT', 'PARENT', 'COMPTABLE']) {
    roleUsers[role] = await prisma.user.findFirst({ where: { tenantId: T, role } });
  }

  for (let i = 0; i < auditDefs.length; i++) {
    const a = auditDefs[i];
    const user = roleUsers[a.role];
    // Only create if less than 20 audit logs exist (avoid flooding)
    const count = await prisma.auditLog.count({ where: { tenantId: T } });
    if (count >= 50) break;
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

  // ══════════════════════════════════════════════════════════════════════════
  // 28. SURVEILLANT-CYCLE LINKS
  // ══════════════════════════════════════════════════════════════════════════
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
    'personnel', 'pointage', 'annonce', 'auditLog', 'emploiDuTemps', 'fraisNiveauConfig', 'eleveParent']) {
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
