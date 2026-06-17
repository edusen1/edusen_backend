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

const email = (process.env.PLATFORM_SUPER_ADMIN_EMAIL || 'superadmin@nouraschool.local').trim().toLowerCase();
const password = process.env.PLATFORM_SUPER_ADMIN_PASSWORD || 'Noura@2026!';
const nom = (process.env.PLATFORM_SUPER_ADMIN_NOM || 'NouraSchool').trim();
const prenom = (process.env.PLATFORM_SUPER_ADMIN_PRENOM || 'Super Admin').trim();
const telephone = (process.env.PLATFORM_SUPER_ADMIN_TELEPHONE || '').trim() || null;
const shouldResetPassword = process.env.PLATFORM_SUPER_ADMIN_RESET_PASSWORD === 'true';

async function main() {
  const existing = await prisma.plateformeUtilisateur.findUnique({ where: { email } });

  if (existing) {
    const data = {
      nom,
      prenom,
      telephone,
      rolePlateforme: 'SUPER_ADMIN',
      actif: true,
    };

    if (shouldResetPassword) {
      data.motDePasse = await bcrypt.hash(password, 12);
    }

    await prisma.plateformeUtilisateur.update({
      where: { email },
      data,
    });

    console.log(`[seed-platform-super-admin] Super Admin existe deja: ${email}${shouldResetPassword ? ' (mot de passe reinitialise)' : ''}`);
    return;
  }

  await prisma.plateformeUtilisateur.create({
    data: {
      nom,
      prenom,
      email,
      telephone,
      rolePlateforme: 'SUPER_ADMIN',
      actif: true,
      motDePasse: await bcrypt.hash(password, 12),
    },
  });

  console.log(`[seed-platform-super-admin] Super Admin cree: ${email}`);
  console.log('[seed-platform-super-admin] Definissez PLATFORM_SUPER_ADMIN_PASSWORD en production et changez-le apres la premiere connexion.');
}

main()
  .catch((error) => {
    console.error('[seed-platform-super-admin] Echec:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
