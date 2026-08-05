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

migrate_log=$(npx prisma migrate deploy 2>&1)
migrate_exit=$?

echo "$migrate_log"

if [ $migrate_exit -ne 0 ]; then
  log_error "Migrations Prisma échouées. Arrêt du démarrage pour préserver l'intégrité du schéma."
  exit 1
fi

log_ok "Migrations Prisma à jour"

echo ""

# ── 2. Scripts de seed ────────────────────────────────────────────────────────
log_step "🌱 Scripts de seed complémentaires"
node scripts/seed-platform-super-admin.cjs 2>&1 && log_ok "seed-platform-super-admin" || log_warn "seed-platform-super-admin ignoré"
node scripts/seed-seydi-jamil.cjs          2>&1 && log_ok "seed-seydi-jamil"          || log_warn "seed-seydi-jamil ignoré"
node scripts/patch-amadou-parcours.cjs 2>&1 && log_ok "patch-amadou-parcours" || log_warn "patch-amadou-parcours ignoré"
node scripts/seed-amadou-notes.cjs     2>&1 && log_ok "seed-amadou-notes"     || log_warn "seed-amadou-notes ignoré"
node scripts/seed-full-demo.cjs        2>&1 && log_ok "seed-full-demo"        || log_warn "seed-full-demo ignoré"
echo ""

# ── 3. Démarrage ──────────────────────────────────────────────────────────────
log_step "🚀 Démarrage du serveur NestJS"
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-8}"
# Garde une marge mémoire pour PostgreSQL/Redis/Chromium dans un conteneur SaaS.
export NODE_OPTIONS="${NODE_OPTIONS:---max_old_space_size=768}"
printf '%b\n\n' "${DIM}Commande: node dist/main${RESET}"
echo ""
exec node dist/main
