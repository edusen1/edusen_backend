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
const TENANT_SLUG = process.env.SEED_TENANT_SLUG || 'ecole-noura-dakar';
const PASSWORD = process.env.SEED_PASSWORD || 'Noura@2026!';

async function generateTenantCode(field) {
  for (let index = 0; index < 50; index += 1) {
    const code = `DEMO${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const existing = await prisma.tenant.findFirst({ where: { [field]: code } });
    if (!existing) return code;
  }
  throw new Error(`Impossible de générer ${field}`);
}

async function resolveTenant() {
  const bySlug = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (bySlug) return bySlug;

  const firstTenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
  if (firstTenant) {
    console.log(`[seed-demo] Tenant "${TENANT_SLUG}" introuvable, utilisation de "${firstTenant.slug}" (${firstTenant.nom}).`);
    return firstTenant;
  }

  const tenant = await prisma.tenant.create({
    data: {
      slug: TENANT_SLUG,
      nom: 'École Démo Passage',
      plan: 'TRIAL',
      actif: true,
      codeAccesEleve: await generateTenantCode('codeAccesEleve'),
      codeAccesEnseignant: await generateTenantCode('codeAccesEnseignant'),
      codeAccesCaissier: await generateTenantCode('codeAccesCaissier'),
      codeAccesAdmin: await generateTenantCode('codeAccesAdmin'),
      codeAccesSurveillant: await generateTenantCode('codeAccesSurveillant'),
      codeAccesRh: await generateTenantCode('codeAccesRh'),
    },
  });
  console.log(`[seed-demo] Tenant créé: ${tenant.slug}`);
  return tenant;
}

async function upsertUser(tenantId, data) {
  const existing = await prisma.user.findFirst({ where: { tenantId, matricule: data.matricule } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      tenantId,
      username: data.matricule,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      matricule: data.matricule,
      role: 'ELEVE',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      actif: true,
      mustChangePwd: true,
    },
  });
}

async function main() {
  const tenant = await resolveTenant();

  const cycle = await prisma.cycle.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'DEMO-COLLEGE' } },
    update: { libelle: 'Collège Démo', actif: true },
    create: { tenantId: tenant.id, code: 'DEMO-COLLEGE', libelle: 'Collège Démo', actif: true },
  });

  const niveau3 = await prisma.niveau.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'DEMO-3E' } },
    update: { libelle: '3ème Démo', ordre: 23, moyennePassage: 10, actif: true },
    create: { tenantId: tenant.id, cycleId: cycle.id, code: 'DEMO-3E', libelle: '3ème Démo', ordre: 23, moyennePassage: 10, actif: true },
  });
  const niveau2 = await prisma.niveau.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'DEMO-2NDE' } },
    update: { libelle: 'Seconde Démo', ordre: 24, moyennePassage: 10, actif: true },
    create: { tenantId: tenant.id, cycleId: cycle.id, code: 'DEMO-2NDE', libelle: 'Seconde Démo', ordre: 24, moyennePassage: 10, actif: true },
  });

  const previousYear = await prisma.anneeAcademique.upsert({
    where: { tenantId_libelle: { tenantId: tenant.id, libelle: '2025-2026' } },
    update: { actif: false, estCourante: false },
    create: { tenantId: tenant.id, libelle: '2025-2026', dateDebut: new Date('2025-10-01'), dateFin: new Date('2026-07-31'), actif: false, estCourante: false },
  });
  const currentYear = await prisma.anneeAcademique.upsert({
    where: { tenantId_libelle: { tenantId: tenant.id, libelle: '2026-2027' } },
    update: { actif: true, estCourante: true },
    create: { tenantId: tenant.id, libelle: '2026-2027', dateDebut: new Date('2026-10-01'), dateFin: null, actif: true, estCourante: true },
  });
  await prisma.anneeAcademique.updateMany({ where: { tenantId: tenant.id, id: { not: currentYear.id } }, data: { actif: false, estCourante: false } });

  const classe3 = await prisma.classe.findFirst({ where: { tenantId: tenant.id, nom: '3ème Démo A', anneeAcademiqueId: previousYear.id } })
    ?? await prisma.classe.create({ data: { tenantId: tenant.id, nom: '3ème Démo A', cycleId: cycle.id, niveauId: niveau3.id, anneeAcademiqueId: previousYear.id, actif: false } });
  const classe2 = await prisma.classe.findFirst({ where: { tenantId: tenant.id, nom: 'Seconde Démo A', anneeAcademiqueId: currentYear.id } })
    ?? await prisma.classe.create({ data: { tenantId: tenant.id, nom: 'Seconde Démo A', cycleId: cycle.id, niveauId: niveau2.id, anneeAcademiqueId: currentYear.id, actif: true } });

  const [admis, derogation, exclu] = await Promise.all([
    upsertUser(tenant.id, { firstName: 'Awa', lastName: 'Passage', matricule: 'DEMO-PASSAGE-OK', email: 'awa.passage.demo@noura.test' }),
    upsertUser(tenant.id, { firstName: 'Boubacar', lastName: 'Derogation', matricule: 'DEMO-PASSAGE-DEMANDE', email: 'boubacar.derogation.demo@noura.test' }),
    upsertUser(tenant.id, { firstName: 'Mariam', lastName: 'Exclue', matricule: 'DEMO-EXCLUE', email: 'mariam.exclue.demo@noura.test' }),
  ]);

  for (const student of [admis, derogation, exclu]) {
    await prisma.inscription.upsert({
      where: { tenantId_eleveId_anneeAcademiqueId: { tenantId: tenant.id, eleveId: student.id, anneeAcademiqueId: previousYear.id } },
      update: { classeId: classe3.id, statut: 'TERMINE' },
      create: { tenantId: tenant.id, eleveId: student.id, classeId: classe3.id, anneeAcademiqueId: previousYear.id, numeroInscription: `DEMO-INS-${student.matricule}`, statut: 'TERMINE', creePar: student.id },
    });
  }

  const demoBulletins = [
    { eleveId: admis.id, trimestre: 'TRIMESTRE_1', moyenne: 13 },
    { eleveId: admis.id, trimestre: 'TRIMESTRE_2', moyenne: 12 },
    { eleveId: derogation.id, trimestre: 'TRIMESTRE_1', moyenne: 8 },
    { eleveId: derogation.id, trimestre: 'TRIMESTRE_2', moyenne: 9 },
  ];
  for (const bulletin of demoBulletins) {
    const existing = await prisma.bulletin.findFirst({
      where: { tenantId: tenant.id, eleveId: bulletin.eleveId, trimestre: bulletin.trimestre, anneeScolaire: '2025-2026' },
      select: { id: true },
    });
    if (!existing) {
      await prisma.bulletin.create({
        data: { tenantId: tenant.id, eleveId: bulletin.eleveId, classeId: classe3.id, trimestre: bulletin.trimestre, anneeScolaire: '2025-2026', moyenne: bulletin.moyenne },
      });
    }
  }

  await prisma.inscription.upsert({
    where: { tenantId_eleveId_anneeAcademiqueId: { tenantId: tenant.id, eleveId: exclu.id, anneeAcademiqueId: currentYear.id } },
    update: { classeId: classe2.id, statut: 'EXCLU' },
    create: { tenantId: tenant.id, eleveId: exclu.id, classeId: classe2.id, anneeAcademiqueId: currentYear.id, numeroInscription: `DEMO-EXCLU-${Date.now().toString(36).toUpperCase()}`, statut: 'EXCLU', creePar: exclu.id },
  });

  console.log('Seed passage/exclusion terminé.');
  console.log('Awa Passage: moyenne suffisante');
  console.log('Boubacar Derogation: demande de passage attendue');
  console.log('Mariam Exclue: inscription bloquée sur 2026-2027');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
