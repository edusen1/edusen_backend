#!/bin/sh
set -e

echo "[entrypoint] Running Prisma migrations..."
if ! npx prisma migrate deploy 2>&1 | tee /tmp/prisma-migrate.log; then
  if grep -q "20260522_seed_parent_child_summaries" /tmp/prisma-migrate.log; then
    echo "[entrypoint] Resolving failed seed migration 20260522_seed_parent_child_summaries as rolled back..."
    npx prisma migrate resolve --rolled-back 20260522_seed_parent_child_summaries
    echo "[entrypoint] Retrying Prisma migrations..."
    npx prisma migrate deploy
  else
    echo "[entrypoint] Prisma migrations failed."
    exit 1
  fi
fi

echo "[entrypoint] Running seed scripts..."
node scripts/patch-amadou-parcours.cjs || echo "[entrypoint] patch-amadou-parcours: done (errors ignored)"
node scripts/seed-amadou-notes.cjs || echo "[entrypoint] seed-amadou-notes: done (errors ignored)"

echo "[entrypoint] Starting NestJS server..."
exec node dist/main
