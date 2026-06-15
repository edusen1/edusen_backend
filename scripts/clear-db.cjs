#!/usr/bin/env node

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

async function main() {
  const schema = 'public';
  const rows = await prisma.$queryRaw`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = ${schema}
      AND tablename NOT IN ('_prisma_migrations', 'prisma_migrations')
  `;

  const tableNames = rows.map((row) => row.tablename).filter(Boolean);
  if (tableNames.length === 0) {
    console.log('Aucune table trouvée à vider.');
    return;
  }

  const quotedTableNames = tableNames
    .map((name) => `"${name.replace(/"/g, '""')}"`)
    .join(', ');

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quotedTableNames} RESTART IDENTITY CASCADE`
  );

  console.log(`Base vidée avec succès. Tables tronquées : ${tableNames.join(', ')}`);
}

main()
  .catch((error) => {
    console.error('Erreur lors de la purge de la base :', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
