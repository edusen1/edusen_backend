#!/bin/sh
set -e

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        🎓  NouraSchool Backend — Démarrage           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Migrations Prisma ──────────────────────────────────────────────────────
echo "📦  Exécution des migrations Prisma..."

run_migrate() {
  npx prisma migrate deploy 2>&1
}

migrate_output=$(run_migrate)
migrate_exit=$?

if [ $migrate_exit -ne 0 ]; then
  echo "$migrate_output"

  # Extraire le nom de la migration échouée depuis l'erreur P3009
  # Format : The `<nom>` migration started at ... failed
  failed_migration=$(echo "$migrate_output" | sed -n "s/.*The \`\([^\`]*\)\` migration.*/\1/p" | head -1)

  if [ -n "$failed_migration" ]; then
    echo "⚠️   Migration échouée détectée : $failed_migration"
    echo "🔧  Résolution automatique (rolled-back)..."
    npx prisma migrate resolve --rolled-back "$failed_migration"

    echo "🔄  Nouvelle tentative de migration..."
    if ! npx prisma migrate deploy; then
      echo "❌  Échec des migrations Prisma après résolution. Arrêt."
      exit 1
    fi
  else
    echo "❌  Échec des migrations Prisma (pas de migration identifiée). Arrêt."
    exit 1
  fi
else
  echo "$migrate_output"
fi

echo "✅  Migrations Prisma appliquées avec succès"
echo ""

# ── 2. Scripts de seed ────────────────────────────────────────────────────────
echo "🌱  Exécution des scripts de seed..."
node scripts/patch-amadou-parcours.cjs 2>&1 && echo "   ✔ patch-amadou-parcours" || echo "   ⚠ patch-amadou-parcours : ignoré"
node scripts/seed-amadou-notes.cjs     2>&1 && echo "   ✔ seed-amadou-notes"     || echo "   ⚠ seed-amadou-notes : ignoré"
echo ""

# ── 3. Démarrage du serveur ───────────────────────────────────────────────────
echo "🚀  Démarrage du serveur NestJS..."
echo ""
exec node dist/main
