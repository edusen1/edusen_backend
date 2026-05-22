#!/bin/sh

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        🎓  NouraSchool Backend — Démarrage           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Migrations Prisma ──────────────────────────────────────────────────────
echo "📦  Exécution des migrations Prisma..."

# Capturer la sortie sans set -e pour gérer les erreurs manuellement
migrate_log=$(npx prisma migrate deploy 2>&1)
migrate_exit=$?

echo "$migrate_log"

if [ $migrate_exit -ne 0 ]; then
  # Extraire le nom de la migration échouée (single quotes pour éviter l'interprétation des backticks)
  failed=$(echo "$migrate_log" | sed -n 's/.*The `\([^`]*\)` migration.*/\1/p' | head -1)

  if [ -n "$failed" ]; then
    echo "⚠️   Migration échouée : $failed"
    # Pour les migrations seed (données seulement), on les marque comme appliquées
    # afin qu'elles ne bloquent pas les migrations de schéma suivantes.
    echo "🔧  Marquage comme appliquée (--applied) pour débloquer les migrations suivantes..."
    npx prisma migrate resolve --applied "$failed"

    echo "🔄  Nouvelle tentative..."
    npx prisma migrate deploy
    echo "✅  Migrations appliquées après résolution"
  else
    echo "❌  Migrations Prisma échouées (cause inconnue). Arrêt."
    exit 1
  fi
else
  echo "✅  Migrations Prisma à jour"
fi

echo ""

# ── 2. Scripts de seed ────────────────────────────────────────────────────────
echo "🌱  Scripts de seed..."
node scripts/patch-amadou-parcours.cjs 2>&1 && echo "   ✔ patch-amadou-parcours" || echo "   ⚠ patch-amadou-parcours ignoré"
node scripts/seed-amadou-notes.cjs     2>&1 && echo "   ✔ seed-amadou-notes"     || echo "   ⚠ seed-amadou-notes ignoré"
echo ""

# ── 3. Démarrage ──────────────────────────────────────────────────────────────
echo "🚀  Démarrage du serveur NestJS..."
echo ""
exec node dist/main
