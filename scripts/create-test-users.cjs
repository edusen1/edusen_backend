#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { spawnSync } = require('node:child_process');

let prisma = new PrismaClient();

const PLATFORM_ROLES = ['SUPER_ADMIN', 'GESTIONNAIRE'];
const TENANT_ROLES = ['ADMIN', 'CAISSIER', 'SURVEILLANT', 'ENSEIGNANT', 'ELEVE', 'PARENT', 'RH'];
const USERS_PER_ROLE = 2;
const PASSWORD = process.env.SEED_TEST_PASSWORD || 'TempPass1234!';

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

async function ensureSchemaReady() {
  const result = await prisma.$queryRawUnsafe(
    'SELECT to_regclass(\'public."Tenant"\') AS table_name',
  );

  if (Array.isArray(result) && result[0] && result[0].table_name) {
    return;
  }

  await prisma.$disconnect();

  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const dbPush = spawnSync(npxCommand, ['prisma', 'db', 'push', '--skip-generate'], {
    stdio: 'inherit',
    env: process.env,
    cwd: process.cwd(),
  });

  if (dbPush.status !== 0) {
    throw new Error('Unable to initialize database schema with "prisma db push".');
  }

  prisma = new PrismaClient();
}

async function ensureTenant() {
  const existing = await prisma.tenant.findFirst({
    where: { slug: 'test-seed' },
  });

  if (existing) {
    return existing;
  }

  return prisma.tenant.create({
    data: {
      slug: 'test-seed',
      nom: 'Test Seed School',
      emailContact: 'admin@test-seed.local',
      telephone: '+221700000000',
      adresse: 'Seed tenant for automated test users',
      plan: 'TRIAL',
      actif: true,
    },
  });
}

async function upsertPlatformUser(role, index, passwordHash) {
  const email = `${role.toLowerCase()}${index}@test-seed.local`;

  await prisma.plateformeUtilisateur.upsert({
    where: { email },
    update: {
      nom: role,
      prenom: `Test${index}`,
      telephone: `+221770000${index}${index}`,
      motDePasse: passwordHash,
      rolePlateforme: role,
      actif: true,
    },
    create: {
      nom: role,
      prenom: `Test${index}`,
      email,
      telephone: `+221770000${index}${index}`,
      motDePasse: passwordHash,
      rolePlateforme: role,
      actif: true,
    },
  });

  return { scope: 'platform', role, email, password: PASSWORD };
}

async function upsertTenantUser(tenantId, role, index, passwordHash) {
  const roleSlug = slugify(role);
  const email = `${roleSlug}${index}@test-seed.local`;
  const username = `${roleSlug}${index}`;

  await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId,
        email,
      },
    },
    update: {
      username,
      firstName: role,
      lastName: `Test${index}`,
      telephone: `+221780000${index}${index}`,
      passwordHash,
      role,
      actif: true,
      mustChangePwd: false,
      matricule: role === 'ELEVE' ? `ELV-${index}` : null,
    },
    create: {
      tenantId,
      username,
      email,
      passwordHash,
      firstName: role,
      lastName: `Test${index}`,
      telephone: `+221780000${index}${index}`,
      role,
      actif: true,
      mustChangePwd: false,
      matricule: role === 'ELEVE' ? `ELV-${index}` : null,
    },
  });

  return { scope: 'tenant', role, email, username, password: PASSWORD };
}

async function main() {
  await ensureSchemaReady();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const credentials = [];
  const tenant = await ensureTenant();

  for (const role of PLATFORM_ROLES) {
    for (let index = 1; index <= USERS_PER_ROLE; index += 1) {
      credentials.push(await upsertPlatformUser(role, index, passwordHash));
    }
  }

  for (const role of TENANT_ROLES) {
    for (let index = 1; index <= USERS_PER_ROLE; index += 1) {
      credentials.push(await upsertTenantUser(tenant.id, role, index, passwordHash));
    }
  }

  console.log(`Tenant: ${tenant.nom} (${tenant.slug})`);
  console.log(`Tenant ID: ${tenant.id}`);
  console.log(`Password used for all generated accounts: ${PASSWORD}`);
  console.log('');

  for (const item of credentials) {
    const base = `[${item.scope}] ${item.role} -> ${item.email}`;
    if (item.username) {
      console.log(`${base} | username=${item.username} | password=${item.password}`);
    } else {
      console.log(`${base} | password=${item.password}`);
    }
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
