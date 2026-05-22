#!/bin/sh
set -e

echo "[entrypoint] Running Prisma migrations..."
npx prisma migrate deploy

echo "[entrypoint] Running seed scripts..."
node scripts/patch-amadou-parcours.cjs || echo "[entrypoint] patch-amadou-parcours: done (errors ignored)"

echo "[entrypoint] Starting NestJS server..."
exec node dist/main
