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

const HISTORICAL_YEARS = [
  { libelle: '2019-2020', debut: new Date('2019-10-01'), fin: new Date('2020-07-31'), niveauCode: 'PS', classeNom: 'Petite Section A' },
  { libelle: '2020-2021', debut: new Date('2020-10-01'), fin: new Date('2021-07-31'), niveauCode: 'MS', classeNom: 'Moyenne Section A' },
  { libelle: '2021-2022', debut: new Date('2021-10-01'), fin: new Date('2022-07-31'), niveauCode: 'GS', classeNom: 'Grande Section A' },
  { libelle: '2022-2023', debut: new Date('2022-10-01'), fin: new Date('2023-07-31'), niveauCode: 'CI', classeNom: 'CI A (2022-2023)' },
  { libelle: '2023-2024', debut: new Date('2023-10-01'), fin: new Date('2024-07-31'), niveauCode: 'CP', classeNom: 'CP A (2023-2024)' },
  { libelle: '2024-2025', debut: new Date('2024-10-01'), fin: new Date('2025-07-31'), niveauCode: 'CE1', classeNom: 'CE1 A (2024-2025)' },
];

async function upsertById(modelName, where, createData, updateData) {
  const existing = await prisma[modelName].findFirst({ where });
  if (existing) {
    return prisma[modelName].update({ where: { id: existing.id }, data: updateData });
  }
  return prisma[modelName].create({ data: createData });
}
//a
async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);
  console.log(`Tenant: ${tenant.nom} (${tenant.id})`);

  const eleve = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: ELEVE_EMAIL } });
  if (!eleve) throw new Error(`Elève "${ELEVE_EMAIL}" introuvable`);
  console.log(`Elève: ${eleve.firstName} ${eleve.lastName} (${eleve.id})`);

  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) throw new Error('Aucun admin trouvé pour ce tenant');
  console.log(`Admin (creePar): ${admin.firstName} ${admin.lastName}`);

  let created = 0;
  let skipped = 0;

  for (const yr of HISTORICAL_YEARS) {
    const niveau = await prisma.niveau.findFirst({ where: { tenantId: tenant.id, code: yr.niveauCode } });
    if (!niveau) {
      console.warn(`  SKIP ${yr.libelle}: niveau "${yr.niveauCode}" introuvable`);
      skipped++;
      continue;
    }

    const annee = await upsertById(
      'anneeAcademique',
      { tenantId: tenant.id, libelle: yr.libelle },
      { tenantId: tenant.id, libelle: yr.libelle, dateDebut: yr.debut, dateFin: yr.fin, estCourante: false, actif: false },
      { dateDebut: yr.debut, dateFin: yr.fin, estCourante: false, actif: false },
    );

    const classe = await upsertById(
      'classe',
      { tenantId: tenant.id, nom: yr.classeNom, anneeAcademiqueId: annee.id },
      { tenantId: tenant.id, nom: yr.classeNom, niveauId: niveau.id, anneeAcademiqueId: annee.id, effectifMax: 30, actif: false },
      { niveauId: niveau.id, effectifMax: 30, actif: false },
    );

    const numeroInscription = `INS-${yr.libelle}-AMADOU`;
    const existing = await prisma.inscription.findFirst({ where: { numeroInscription } });
    if (existing) {
      console.log(`  OK (existe) ${yr.libelle} → ${yr.classeNom}`);
      skipped++;
      continue;
    }

    await prisma.inscription.create({
      data: {
        tenantId: tenant.id,
        numeroInscription,
        eleveId: eleve.id,
        classeId: classe.id,
        anneeAcademiqueId: annee.id,
        statut: 'TERMINE',
        creePar: admin.id,
      },
    });

    console.log(`  CREE ${yr.libelle} → ${yr.classeNom} (${yr.niveauCode})`);
    created++;
  }

  console.log('');
  console.log(`Terminé: ${created} inscription(s) créée(s), ${skipped} ignorée(s).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
