const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`ALTER TYPE "StatutInscription" ADD VALUE IF NOT EXISTS 'INACTIF'`);

  const termine = await prisma.$executeRawUnsafe(`
    UPDATE "Inscription"
    SET "statut" = 'INACTIF'::"StatutInscription"
    WHERE "statut" = 'TERMINE'
  `);

  const historiques = await prisma.$executeRawUnsafe(`
    UPDATE "Inscription" AS inscription
    SET "statut" = 'INACTIF'::"StatutInscription"
    FROM "AnneeAcademique" AS annee
    WHERE inscription."tenantId" = annee."tenantId"
      AND annee."actif" = true
      AND inscription."statut" = 'ACTIF'
      AND inscription."anneeAcademiqueId" <> annee."id"
  `);

  console.log(`Inscriptions TERMINE -> INACTIF: ${termine}`);
  console.log(`Inscriptions historiques ACTIF -> INACTIF: ${historiques}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
