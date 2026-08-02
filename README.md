# Edusen Backend

Backend NestJS multi-tenant pour la gestion scolaire.

## Ce qui est inclus
- Architecture NestJS professionnelle (modules + common)
- Fastify, Helmet, CORS, Rate limit
- JWT + RBAC (roles) + endpoints publics
- Multi-tenant via `X-Tenant-Id`
- Prisma (PostgreSQL) avec schema de base
- Swagger (`/docs`)
- Routes metier couvrant les contextes:
  - `/api/platform/*`
  - `/api/v1/*`
  - `/api/admin/*`
  - `/api/enseignant/*`
  - `/api/eleve/*`
  - `/api/parent/*`
  - `/api/caisse/*`

## Demarrage
```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run setup:seed
npm run start:dev
```

## Seed
- `npm run seed` pour recharger les donnees de demo
- `npm run setup:seed` pour generer Prisma, synchroniser la base, puis lancer le seed

## Remarque
Ce projet remplace l'ancien backend Java/Quarkus.