#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
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

const TENANT_NOM = 'Seydi Jamil';
const TENANT_SLUG = 'seydi-jamil';
const ADMIN_EMAIL = 'admin@seydijamil.sn';
const ADMIN_PASSWORD = 'Admin@2026!';

async function generateUniqueCode(field) {
  for (let i = 0; i < 20; i++) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const existing = await prisma.tenant.findFirst({ where: { [field]: code } });
    if (!existing) return code;
  }
  throw new Error(`Impossible de générer un code unique pour ${field}`);
}

async function main() {
  let tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    const [codeAccesEleve, codeAccesEnseignant, codeAccesCaissier, codeAccesAdmin, codeAccesSurveillant, codeAccesRh] =
      await Promise.all([
        generateUniqueCode('codeAccesEleve'),
        generateUniqueCode('codeAccesEnseignant'),
        generateUniqueCode('codeAccesCaissier'),
        generateUniqueCode('codeAccesAdmin'),
        generateUniqueCode('codeAccesSurveillant'),
        generateUniqueCode('codeAccesRh'),
      ]);

    tenant = await prisma.tenant.create({
      data: {
        slug: TENANT_SLUG,
        nom: TENANT_NOM,
        plan: 'TRIAL',
        actif: true,
        codeAccesEleve,
        codeAccesEnseignant,
        codeAccesCaissier,
        codeAccesAdmin,
        codeAccesSurveillant,
        codeAccesRh,
      },
    });
    console.log(`[seed-seydi-jamil] Tenant créé: ${tenant.nom} (id: ${tenant.id})`);
  } else {
    console.log(`[seed-seydi-jamil] Tenant "${TENANT_NOM}" existe déjà (id: ${tenant.id})`);
  }

  const existingAdmin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: ADMIN_EMAIL },
  });
  if (existingAdmin) {
    console.log(`[seed-seydi-jamil] Admin ${ADMIN_EMAIL} existe déjà`);
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: ADMIN_EMAIL,
      username: ADMIN_EMAIL,
      firstName: 'Admin',
      lastName: 'Seydi Jamil',
      passwordHash,
      role: 'ADMIN',
      actif: true,
      mustChangePwd: false,
    },
  });

  console.log(`[seed-seydi-jamil] Admin créé:`);
  console.log(`  Email    : ${ADMIN_EMAIL}`);
  console.log(`  Password : ${ADMIN_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error('[seed-seydi-jamil] Echec:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
