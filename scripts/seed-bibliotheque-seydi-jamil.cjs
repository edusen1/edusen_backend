#!/usr/bin/env node

/**
 * Catalogue de bibliothèque pour l'école Seydi Jamil.
 *
 * Idempotent : relancer le script ne crée pas de doublons, il met à jour les
 * ouvrages existants (repérés par titre + auteur). Les emprunts en cours ne sont
 * pas touchés, et le nombre d'exemplaires disponibles n'est jamais remis à zéro
 * si des exemplaires sont sortis.
 *
 *   node scripts/seed-bibliotheque-seydi-jamil.cjs
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const prisma = new PrismaClient();

const TARIFS = {
  dureeJoursDefaut: 14,
  dureeJoursMax: 60,
  penaliteParJour: 100,
  penaliteMax: 5000,
  valeurRemplacementDefaut: 10000,
};

/** Fonds mêlant manuels du programme sénégalais et littérature africaine. */
const OUVRAGES = [
  // ── Manuels — préscolaire et primaire
  { titre: 'Mon cahier d\'éveil — Grande Section', auteur: 'Collectif', type: 'MANUEL', editeur: 'EDICEF', annee: 2023, nbExemplaires: 30, valeur: 4500 },
  { titre: 'Lecture CI — Méthode syllabique', auteur: 'Collectif', type: 'MANUEL', editeur: 'NEAS', annee: 2022, nbExemplaires: 40, valeur: 5000 },
  { titre: 'Calcul CP', auteur: 'Collectif', type: 'MANUEL', editeur: 'NEAS', annee: 2022, nbExemplaires: 40, valeur: 5000 },
  { titre: 'Français CE1 — Lire et écrire', auteur: 'Collectif', type: 'MANUEL', editeur: 'EDICEF', annee: 2023, nbExemplaires: 35, valeur: 5500 },
  { titre: 'Mathématiques CE2', auteur: 'Collectif', type: 'MANUEL', editeur: 'Hachette Éducation', annee: 2023, nbExemplaires: 35, valeur: 6000 },
  { titre: 'Éveil scientifique CM1', auteur: 'Collectif', type: 'MANUEL', editeur: 'NEAS', annee: 2021, nbExemplaires: 30, valeur: 5500 },
  { titre: 'Histoire-Géographie CM2', auteur: 'Collectif', type: 'MANUEL', editeur: 'EDICEF', annee: 2022, nbExemplaires: 32, valeur: 6000 },
  { titre: 'Éducation civique CM2', auteur: 'Collectif', type: 'MANUEL', editeur: 'NEAS', annee: 2022, nbExemplaires: 30, valeur: 4500 },

  // ── Manuels — collège
  { titre: 'Mathématiques 6ème', auteur: 'Collectif', type: 'MANUEL', editeur: 'Hachette Éducation', annee: 2023, nbExemplaires: 40, valeur: 7000 },
  { titre: 'Français 5ème — Textes et méthodes', auteur: 'Collectif', type: 'MANUEL', editeur: 'Nathan', annee: 2022, nbExemplaires: 38, valeur: 7000 },
  { titre: 'Sciences de la Vie et de la Terre 4ème', auteur: 'Collectif', type: 'MANUEL', editeur: 'Belin', annee: 2023, nbExemplaires: 35, valeur: 7500 },
  { titre: 'Physique-Chimie 3ème', auteur: 'Collectif', type: 'MANUEL', editeur: 'Bordas', annee: 2023, nbExemplaires: 36, valeur: 7500 },
  { titre: 'Anglais 3ème — New Bridges', auteur: 'Collectif', type: 'MANUEL', editeur: 'Nathan', annee: 2021, nbExemplaires: 34, valeur: 6500 },
  { titre: 'Histoire-Géographie 3ème', auteur: 'Collectif', type: 'MANUEL', editeur: 'Magnard', annee: 2022, nbExemplaires: 34, valeur: 7000 },

  // ── Manuels — lycée
  { titre: 'Mathématiques Seconde', auteur: 'Collectif', type: 'MANUEL', editeur: 'Hachette Éducation', annee: 2023, nbExemplaires: 30, valeur: 8000 },
  { titre: 'Sciences Physiques Première S', auteur: 'Collectif', type: 'MANUEL', editeur: 'Bordas', annee: 2023, nbExemplaires: 28, valeur: 8500 },
  { titre: 'Philosophie Terminale', auteur: 'Collectif', type: 'MANUEL', editeur: 'Nathan', annee: 2022, nbExemplaires: 25, valeur: 8000 },
  { titre: 'Sciences Économiques et Sociales Terminale', auteur: 'Collectif', type: 'MANUEL', editeur: 'Magnard', annee: 2022, nbExemplaires: 22, valeur: 8000 },

  // ── Littérature africaine et sénégalaise
  { titre: 'L\'Aventure ambiguë', auteur: 'Cheikh Hamidou Kane', type: 'ROMAN', editeur: 'Julliard', annee: 1961, isbn: '978-2-260-00847-6', nbExemplaires: 15, valeur: 4000 },
  { titre: 'Une si longue lettre', auteur: 'Mariama Bâ', type: 'ROMAN', editeur: 'NEAS', annee: 1979, isbn: '978-2-7236-0431-0', nbExemplaires: 18, valeur: 3500 },
  { titre: 'Les Bouts de bois de Dieu', auteur: 'Ousmane Sembène', type: 'ROMAN', editeur: 'Presses Pocket', annee: 1960, isbn: '978-2-266-08507-9', nbExemplaires: 14, valeur: 4500 },
  { titre: 'Sous l\'orage', auteur: 'Seydou Badian', type: 'ROMAN', editeur: 'Présence Africaine', annee: 1957, nbExemplaires: 12, valeur: 3500 },
  { titre: 'Le Docker noir', auteur: 'Ousmane Sembène', type: 'ROMAN', editeur: 'Présence Africaine', annee: 1956, nbExemplaires: 10, valeur: 4000 },
  { titre: 'Karim, roman sénégalais', auteur: 'Ousmane Socé', type: 'ROMAN', editeur: 'NEA', annee: 1935, nbExemplaires: 10, valeur: 3500 },
  { titre: 'Chants d\'ombre', auteur: 'Léopold Sédar Senghor', type: 'ROMAN', editeur: 'Seuil', annee: 1945, nbExemplaires: 12, valeur: 4000 },
  { titre: 'Le Petit Prince', auteur: 'Antoine de Saint-Exupéry', type: 'ROMAN', editeur: 'Gallimard', annee: 1943, isbn: '978-2-07-040850-4', nbExemplaires: 20, valeur: 3000 },

  // ── Ouvrages de référence
  { titre: 'Le Petit Larousse illustré 2025', auteur: 'Larousse', type: 'DICTIONNAIRE', editeur: 'Larousse', annee: 2024, nbExemplaires: 8, valeur: 15000 },
  { titre: 'Dictionnaire Wolof–Français', auteur: 'Arame Fal', type: 'DICTIONNAIRE', editeur: 'Karthala', annee: 1990, nbExemplaires: 6, valeur: 12000 },
  { titre: 'Bescherelle — La conjugaison pour tous', auteur: 'Collectif', type: 'DICTIONNAIRE', editeur: 'Hatier', annee: 2019, nbExemplaires: 12, valeur: 6000 },
  { titre: 'Atlas du Sénégal', auteur: 'Collectif', type: 'ENCYCLOPEDIE', editeur: 'Jeune Afrique', annee: 2020, nbExemplaires: 5, valeur: 20000 },
  { titre: 'Encyclopédie des sciences', auteur: 'Collectif', type: 'ENCYCLOPEDIE', editeur: 'Larousse', annee: 2021, nbExemplaires: 4, valeur: 25000 },
];

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { OR: [{ slug: 'seydi-jamil' }, { slug: 'seydijamil' }] },
    select: { id: true, nom: true },
  });
  if (!tenant) {
    throw new Error("École Seydi Jamil introuvable — lancez d'abord seed-seydi-jamil.cjs");
  }
  console.log(`École : ${tenant.nom} (${tenant.id})`);

  let crees = 0;
  let majs = 0;

  for (const o of OUVRAGES) {
    const existant = await prisma.ouvrage.findFirst({
      where: { tenantId: tenant.id, titre: o.titre, auteur: o.auteur },
    });

    if (existant) {
      // Des exemplaires peuvent être sortis : on ne réinitialise pas le stock
      // disponible, on lui applique l'écart d'exemplaires.
      const ecart = o.nbExemplaires - existant.nbExemplaires;
      await prisma.ouvrage.update({
        where: { id: existant.id },
        data: {
          type: o.type, editeur: o.editeur ?? null, annee: o.annee ?? null,
          isbn: o.isbn ?? null, valeur: o.valeur ?? null,
          nbExemplaires: o.nbExemplaires,
          nbDisponibles: Math.max(0, Math.min(o.nbExemplaires, existant.nbDisponibles + ecart)),
          actif: true,
        },
      });
      majs++;
    } else {
      await prisma.ouvrage.create({
        data: {
          tenantId: tenant.id,
          titre: o.titre, auteur: o.auteur, type: o.type,
          editeur: o.editeur ?? null, annee: o.annee ?? null,
          isbn: o.isbn ?? null, valeur: o.valeur ?? null,
          nbExemplaires: o.nbExemplaires, nbDisponibles: o.nbExemplaires,
        },
      });
      crees++;
    }
  }

  // Tarifs : posés seulement s'ils n'ont jamais été configurés, pour ne pas
  // écraser un paramétrage fait par l'école.
  const config = await prisma.ecoleConfig.findUnique({
    where: { tenantId: tenant.id },
    select: { tarifsBibliotheque: true },
  });
  if (config && !config.tarifsBibliotheque) {
    await prisma.ecoleConfig.update({
      where: { tenantId: tenant.id },
      data: { tarifsBibliotheque: TARIFS },
    });
    console.log('Tarifs de bibliothèque initialisés.');
  }

  const total = await prisma.ouvrage.count({ where: { tenantId: tenant.id, actif: true } });
  const exemplaires = await prisma.ouvrage.aggregate({
    where: { tenantId: tenant.id, actif: true },
    _sum: { nbExemplaires: true },
  });

  console.log(`Ouvrages créés : ${crees}`);
  console.log(`Ouvrages mis à jour : ${majs}`);
  console.log(`Catalogue : ${total} titres, ${exemplaires._sum.nbExemplaires ?? 0} exemplaires.`);
}

main()
  .catch((e) => { console.error(e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
