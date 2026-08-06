#!/usr/bin/env node

/**
 * Seed des PlanFeature et PlanLimit par défaut.
 * Idempotent — utilise upsert, peut être relancé sans risque.
 *
 * Usage: node scripts/seed-plan-features.cjs
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

// ── Feature matrix ──────────────────────────────────────────────────────────
// true = enabled, false = disabled

const PLANS = ['TRIAL', 'STARTER', 'STANDARD', 'PREMIUM'];

const FEATURES = [
  // WhatsApp
  { key: 'WHATSAPP_OTP',            defaults: [true,  true,  true,  true ] },
  { key: 'WHATSAPP_COMMUNICATION',  defaults: [false, false, true,  true ] },
  { key: 'WHATSAPP_BULLETIN',       defaults: [false, false, true,  true ] },
  { key: 'WHATSAPP_PAIEMENT',       defaults: [false, false, true,  true ] },
  { key: 'WHATSAPP_ABSENCE',        defaults: [false, false, false, true ] },
  { key: 'WHATSAPP_BROADCAST',      defaults: [false, false, false, true ] },

  // Gestion scolaire
  { key: 'BULLETINS',               defaults: [true,  true,  true,  true ] },
  { key: 'NOTES',                   defaults: [true,  true,  true,  true ] },
  { key: 'INSCRIPTIONS',            defaults: [true,  true,  true,  true ] },
  { key: 'ABSENCES',                defaults: [true,  true,  true,  true ] },
  { key: 'DISCIPLINE',              defaults: [true,  true,  true,  true ] },
  { key: 'COMMUNICATION',           defaults: [true,  true,  true,  true ] },
  { key: 'EDT',                     defaults: [true,  true,  true,  true ] },
  { key: 'CALENDRIER',              defaults: [true,  true,  true,  true ] },

  // Documents et exports
  { key: 'CARTES_SCOLAIRES',        defaults: [false, true,  true,  true ] },
  { key: 'RECUS_PAIEMENT',          defaults: [false, true,  true,  true ] },
  { key: 'BULLETINS_PDF',           defaults: [false, true,  true,  true ] },
  { key: 'EXPORT_EXCEL',            defaults: [false, true,  true,  true ] },
  { key: 'RAPPORTS_AVANCES',        defaults: [false, false, true,  true ] },

  // Administration avancée
  { key: 'MULTI_ADMIN',             defaults: [false, false, true,  true ] },
  { key: 'POINTAGE',                defaults: [false, true,  true,  true ] },
  { key: 'PAIE_PERSONNEL',          defaults: [false, false, true,  true ] },
  { key: 'PROGRAMMES',              defaults: [false, true,  true,  true ] },
  { key: 'TEMPLATES_CUSTOM',        defaults: [false, false, false, true ] },
  { key: 'API_EXTERNE',             defaults: [false, false, false, true ] },
  { key: 'SECURITE_QR',             defaults: [false, false, true,  true ] },
];

// ── Limits matrix ───────────────────────────────────────────────────────────
// 0 = unlimited

const LIMITS = [
  { key: 'maxEleves',           defaults: [50,   500,  2000, 0    ] },
  { key: 'maxUsers',            defaults: [10,   50,   200,  0    ] },
  { key: 'maxClasses',          defaults: [5,    20,   100,  0    ] },
  { key: 'maxAdmins',           defaults: [1,    1,    3,    0    ] },
  { key: 'maxStorageMb',        defaults: [1024, 5120, 20480, 102400] },
  { key: 'maxBulletinsParMois', defaults: [100,  1000, 5000, 0    ] },
  { key: 'maxWhatsappParJour',  defaults: [10,   50,   500,  0    ] },
  { key: 'dureeEssaiJours',     defaults: [30,   0,    0,    0    ] },
];

async function main() {
  console.log('Seeding plan features and limits...');

  // Plan Features
  let featCount = 0;
  for (const feat of FEATURES) {
    for (let i = 0; i < PLANS.length; i++) {
      await prisma.planFeature.upsert({
        where: { plan_featureKey: { plan: PLANS[i], featureKey: feat.key } },
        create: { plan: PLANS[i], featureKey: feat.key, actif: feat.defaults[i] },
        update: { actif: feat.defaults[i] },
      });
      featCount++;
    }
  }
  console.log(`  ${featCount} plan features upserted`);

  // Plan Limits
  let limCount = 0;
  for (const lim of LIMITS) {
    for (let i = 0; i < PLANS.length; i++) {
      await prisma.planLimit.upsert({
        where: { plan_limitKey: { plan: PLANS[i], limitKey: lim.key } },
        create: { plan: PLANS[i], limitKey: lim.key, limitValue: lim.defaults[i] },
        update: { limitValue: lim.defaults[i] },
      });
      limCount++;
    }
  }
  console.log(`  ${limCount} plan limits upserted`);

  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
