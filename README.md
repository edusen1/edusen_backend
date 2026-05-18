# NouraSchool Backend NestJS (Nouveau Projet)

Nouveau projet indépendant pour la migration complète du backend vers NestJS.

## Ce qui est inclus
- Architecture NestJS professionnelle (modules + common)
- Fastify, Helmet, CORS, Rate limit
- JWT + RBAC (roles) + endpoints publics
- Multi-tenant via `X-Tenant-Id`
- Prisma (PostgreSQL) avec schéma de base
- Swagger (`/docs`)
- Routes métier couvrant les contextes:
  - `/api/platform/*`
  - `/api/v1/*`
  - `/api/admin/*`
  - `/api/enseignant/*`
  - `/api/eleve/*`
  - `/api/parent/*`
  - `/api/caisse/*`

## Démarrage
```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run start:dev
```

## Remarque
Ce projet est isolé de `nouraschool_backend` (Java/Quarkus), pour permettre une migration progressive sans risque.
