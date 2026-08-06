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

printf '\n%b\n' "${CYAN}╔══════════════════════════════════════════════════════╗${RESET}"
printf '%b\n' "${CYAN}║        🎓  Edusen Backend — Démarrage           ║${RESET}"
printf '%b\n\n' "${CYAN}╚══════════════════════════════════════════════════════╝${RESET}"
printf '%b\n' "${DIM}Environment=${NODE_ENV:-production} Port=${PORT:-3000}${RESET}"

# ── 1. Migrations Prisma ──────────────────────────────────────────────────────
log_step "📦 Exécution des migrations Prisma"

# Resolve any previously failed migrations before deploying
migrate_log=$(npx prisma migrate deploy 2>&1)
migrate_exit=$?

echo "$migrate_log"

if [ $migrate_exit -ne 0 ]; then
  if echo "$migrate_log" | grep -q "P3009"; then
    log_warn "Migration echouee detectee — tentative de resolution automatique"
    failed_migration=$(echo "$migrate_log" | grep "migration started at" | sed 's/.*The `\(.*\)` migration started at.*/\1/')
    if [ -n "$failed_migration" ]; then
      log_step "Resolution de la migration: $failed_migration"
      npx prisma migrate resolve --rolled-back "$failed_migration" 2>&1
      log_step "Re-execution des migrations"
      retry_log=$(npx prisma migrate deploy 2>&1)
      retry_exit=$?
      echo "$retry_log"
      if [ $retry_exit -ne 0 ]; then
        log_error "Migrations Prisma echouees apres resolution. Arret du demarrage."
        exit 1
      fi
      log_ok "Migrations Prisma resolues et appliquees"
    else
      log_error "Impossible d'identifier la migration echouee. Arret du demarrage."
      exit 1
    fi
  else
    log_error "Migrations Prisma echouees. Arret du demarrage pour preserver l'integrite du schema."
    exit 1
  fi
else
  log_ok "Migrations Prisma a jour"
fi

echo ""

# ── 2. Scripts de seed ────────────────────────────────────────────────────────
# Seeds desactives — les donnees demo sont deja en base.
# Pour re-seeder manuellement : node scripts/seed-full-demo.cjs
log_step "🌱 Seeds"
node scripts/seed-platform-super-admin.cjs 2>&1 && log_ok "seed-platform-super-admin" || log_warn "seed-platform-super-admin ignore"
echo ""

# ── 3. Démarrage ──────────────────────────────────────────────────────────────
log_step "🚀 Démarrage du serveur NestJS"
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-8}"
# Garde une marge mémoire pour PostgreSQL/Redis/Chromium dans un conteneur SaaS.
export NODE_OPTIONS="${NODE_OPTIONS:---max_old_space_size=768}"
printf '%b\n\n' "${DIM}Commande: node dist/main${RESET}"
echo ""
exec node dist/main
