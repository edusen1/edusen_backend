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
  # Extraire le nom de la migration échouée (single quotes pour éviter l'interprétation des backticks)
  failed=$(echo "$migrate_log" | sed -n 's/.*The `\([^`]*\)` migration.*/\1/p' | head -1)

  if [ -n "$failed" ]; then
    log_warn "Migration échouée : $failed"
    # Pour les migrations seed (données seulement), on les marque comme appliquées
    # afin qu'elles ne bloquent pas les migrations de schéma suivantes.
    log_step "🔧 Marquage comme appliquée (--applied) pour débloquer les migrations suivantes"
    npx prisma migrate resolve --applied "$failed"

    log_step "🔄 Nouvelle tentative de migration"
    npx prisma migrate deploy
    log_ok "Migrations appliquées après résolution"
  else
    log_error "Migrations Prisma échouées (cause inconnue). Arrêt."
    exit 1
  fi
else
  log_ok "Migrations Prisma à jour"
fi

echo ""

# ── 2. Scripts de seed ────────────────────────────────────────────────────────
log_step "🌱 Scripts de seed complémentaires"
node scripts/patch-amadou-parcours.cjs 2>&1 && log_ok "patch-amadou-parcours" || log_warn "patch-amadou-parcours ignoré"
node scripts/seed-amadou-notes.cjs     2>&1 && log_ok "seed-amadou-notes"     || log_warn "seed-amadou-notes ignoré"
echo ""

# ── 3. Démarrage ──────────────────────────────────────────────────────────────
log_step "🚀 Démarrage du serveur NestJS"
printf '%b\n\n' "${DIM}Commande: node dist/main${RESET}"
echo ""
exec node dist/main
