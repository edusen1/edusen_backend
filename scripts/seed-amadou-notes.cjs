#!/usr/bin/env node
'use strict';

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

const TENANT_SLUG = 'ecole-noura-dakar';
const ELEVE_EMAIL = 'baamadou@gmail.com';

// Notes de test par année : 9 valeurs = 3 semestres × 3 matières (sur 10)
const GRADES_BY_YEAR = {
  '2019-2020': [6.5, 7.0, 6.5, 7.0, 7.5, 7.0, 7.5, 8.0, 7.5],
  '2020-2021': [7.0, 7.5, 7.0, 7.5, 8.0, 7.5, 8.0, 8.5, 8.0],
  '2021-2022': [7.5, 8.0, 7.5, 8.0, 8.5, 8.0, 8.5, 9.0, 8.5],
  '2022-2023': [7.0, 7.5, 7.0, 7.5, 8.0, 7.5, 8.0, 8.5, 8.0],
  '2023-2024': [8.0, 8.5, 8.0, 8.5, 9.0, 8.5, 9.0, 9.5, 9.0],
  '2024-2025': [8.5, 9.0, 8.5, 9.0, 9.5, 9.0, 9.5, 9.5, 9.5],
};

const PERIODES = ['SEMESTRE_1', 'SEMESTRE_2', 'SEMESTRE_3'];

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);
  console.log(`Tenant: ${tenant.nom} (${tenant.id})`);

  const eleve = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: ELEVE_EMAIL } });
  if (!eleve) throw new Error(`Élève "${ELEVE_EMAIL}" introuvable`);
  console.log(`Élève: ${eleve.firstName} ${eleve.lastName} (${eleve.id})`);

  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) throw new Error('Aucun admin trouvé');

  const matieres = await prisma.matiere.findMany({
    where: { tenantId: tenant.id, actif: true },
    orderBy: { libelle: 'asc' },
    take: 3,
  });

  if (!matieres.length) {
    console.error('Aucune matière active trouvée. Créez au moins une matière d\'abord.');
    process.exit(1);
  }

  console.log(`Matières: ${matieres.map((m) => m.libelle).join(', ')}`);

  let createdNotes = 0;
  let skippedNotes = 0;
  let createdCours = 0;

  for (const [annee, grades] of Object.entries(GRADES_BY_YEAR)) {
    const inscription = await prisma.inscription.findFirst({
      where: { tenantId: tenant.id, eleveId: eleve.id, anneeAcademique: { libelle: annee } },
      include: { anneeAcademique: true, classe: true },
    });

    if (!inscription) {
      console.log(`  SKIP ${annee}: inscription introuvable`);
      continue;
    }

    const { classeId, anneeAcademiqueId } = inscription;
    console.log(`\n  ${annee} → ${inscription.classe.nom}`);

    // Créer les cours manquants (admin comme enseignant titulaire)
    for (const matiere of matieres) {
      const existing = await prisma.cours.findFirst({
        where: { tenantId: tenant.id, matiereId: matiere.id, classeId, anneeAcademiqueId },
      });
      if (!existing) {
        await prisma.cours.create({
          data: { tenantId: tenant.id, matiereId: matiere.id, classeId, enseignantId: admin.id, anneeAcademiqueId, coefficient: 1 },
        });
        console.log(`    COURS créé: ${matiere.libelle}`);
        createdCours++;
      }
    }

    // Créer les notes par semestre × matière
    let idx = 0;
    for (const periode of PERIODES) {
      for (const matiere of matieres) {
        const noteValue = grades[idx % grades.length];
        idx++;

        const exists = await prisma.note.findFirst({
          where: {
            tenantId: tenant.id,
            eleveId: eleve.id,
            matiereId: matiere.id,
            trimestre: periode,
            anneeScolaire: annee,
            typeEvaluation: 'DEVOIR',
          },
        });

        if (exists) {
          skippedNotes++;
          continue;
        }

        await prisma.note.create({
          data: {
            tenantId: tenant.id,
            eleveId: eleve.id,
            matiereId: matiere.id,
            typeEvaluation: 'DEVOIR',
            note: noteValue,
            noteSur: 10,
            trimestre: periode,
            anneeScolaire: annee,
          },
        });
        createdNotes++;
      }
    }
  }

  console.log('');
  console.log(`Terminé: ${createdNotes} note(s) créée(s), ${skippedNotes} ignorée(s), ${createdCours} cours créé(s).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
