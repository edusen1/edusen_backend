#!/bin/sh

if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  BLUE='\033[1;34m'
  GREEN='\033[1;32m'
  YELLOW='\033[1;33m'
  RED='\033[1;31m'
  CYAN='\033[1;36m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  BLUE=''
  GREEN=''
  YELLOW=''
  RED=''
  CYAN=''
  DIM=''
  RESET=''
fi

log_step() {
  printf '%b\n' "${BLUE}▶ $1${RESET}"
}

log_ok() {
  printf '%b\n' "${GREEN}✅ $1${RESET}"
}

log_warn() {
  printf '%b\n' "${YELLOW}⚠️  $1${RESET}"
}

log_error() {
  printf '%b\n' "${RED}❌ $1${RESET}"
}

repair_teacher_payment_response_migration() {
  migration_name="20260623_add_teacher_payment_response"

  case "$migrate_log" in
    *P3009*"$migration_name"*) ;;
    *) return 1 ;;
  esac

  log_warn "Migration Prisma $migration_name marquée en échec. Réparation contrôlée du schéma..."

  if [ -z "$DATABASE_URL" ]; then
    log_error "DATABASE_URL manquant : impossible d'exécuter la réparation SQL."
    return 1
  fi

  repair_log=$(
    npx prisma db execute --url "$DATABASE_URL" --stdin 2>&1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('"PaiementProfesseur"') IS NULL THEN
    CREATE TABLE "PaiementProfesseur" (
      "id" UUID NOT NULL DEFAULT gen_random_uuid(),
      "tenantId" UUID NOT NULL,
      "enseignantId" UUID NOT NULL,
      "dateDebut" DATE NOT NULL,
      "dateFin" DATE NOT NULL,
      "heuresEffectuees" DOUBLE PRECISION NOT NULL,
      "heuresDeduites" DOUBLE PRECISION NOT NULL,
      "montant" DOUBLE PRECISION NOT NULL,
      "statut" "StatutPaiement" NOT NULL DEFAULT 'EN_ATTENTE',
      "reference" VARCHAR(80) NOT NULL,
      "initialisePar" UUID,
      "notificationId" UUID,
      "observations" TEXT,
      "motifRejet" TEXT,
      "reponduLe" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PaiementProfesseur_pkey" PRIMARY KEY ("id")
    );
  END IF;
END $$;

ALTER TABLE "PaiementProfesseur"
  ADD COLUMN IF NOT EXISTS "motifRejet" TEXT,
  ADD COLUMN IF NOT EXISTS "reponduLe" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "PaiementProfesseur_reference_key"
  ON "PaiementProfesseur"("reference");

CREATE INDEX IF NOT EXISTS "PaiementProfesseur_tenantId_enseignantId_dateDebut_dateFin_idx"
  ON "PaiementProfesseur"("tenantId", "enseignantId", "dateDebut", "dateFin");

CREATE INDEX IF NOT EXISTS "PaiementProfesseur_tenantId_statut_idx"
  ON "PaiementProfesseur"("tenantId", "statut");
SQL
  )
  repair_exit=$?
  echo "$repair_log"

  if [ $repair_exit -ne 0 ]; then
    log_error "Réparation SQL de $migration_name échouée."
    return 1
  fi

  resolve_log=$(npx prisma migrate resolve --applied "$migration_name" 2>&1)
  resolve_exit=$?
  echo "$resolve_log"

  if [ $resolve_exit -ne 0 ]; then
    log_error "Impossible de marquer $migration_name comme appliquée."
    return 1
  fi

  log_ok "Migration Prisma $migration_name réparée"
  return 0
}

printf '\n%b\n' "${CYAN}╔══════════════════════════════════════════════════════╗${RESET}"
printf '%b\n' "${CYAN}║        🎓  NouraSchool Backend — Démarrage           ║${RESET}"
printf '%b\n\n' "${CYAN}╚══════════════════════════════════════════════════════╝${RESET}"
printf '%b\n' "${DIM}Environment=${NODE_ENV:-production} Port=${PORT:-3000}${RESET}"

# ── 1. Migrations Prisma ──────────────────────────────────────────────────────
log_step "📦 Exécution des migrations Prisma"

# Capturer la sortie sans set -e pour gérer les erreurs manuellement
migrate_log=$(npx prisma migrate deploy 2>&1)
migrate_exit=$?

echo "$migrate_log"

if [ $migrate_exit -ne 0 ]; then
  if repair_teacher_payment_response_migration; then
    log_step "📦 Relance des migrations Prisma après réparation"
    migrate_log=$(npx prisma migrate deploy 2>&1)
    migrate_exit=$?
    echo "$migrate_log"
  fi

  if [ $migrate_exit -ne 0 ]; then
    log_error "Migrations Prisma échouées. Arrêt du démarrage pour préserver l'intégrité du schéma."
    exit 1
  fi
fi

log_ok "Migrations Prisma à jour"

echo ""

# ── 2. Scripts de seed ────────────────────────────────────────────────────────
log_step "🌱 Scripts de seed complémentaires"
node scripts/seed-platform-super-admin.cjs 2>&1 && log_ok "seed-platform-super-admin" || log_warn "seed-platform-super-admin ignoré"
node scripts/patch-amadou-parcours.cjs 2>&1 && log_ok "patch-amadou-parcours" || log_warn "patch-amadou-parcours ignoré"
node scripts/seed-amadou-notes.cjs     2>&1 && log_ok "seed-amadou-notes"     || log_warn "seed-amadou-notes ignoré"
echo ""

# ── 3. Démarrage ──────────────────────────────────────────────────────────────
log_step "🚀 Démarrage du serveur NestJS"
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-8}"
# Garde une marge mémoire pour PostgreSQL/Redis/Chromium dans un conteneur SaaS.
export NODE_OPTIONS="${NODE_OPTIONS:---max_old_space_size=768}"
printf '%b\n\n' "${DIM}Commande: node dist/main${RESET}"
echo ""
exec node dist/main
