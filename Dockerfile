# =============================================
# Stage 1 — Builder
# =============================================
FROM node:20-alpine AS builder

# Force dev deps — Coolify injects NODE_ENV=production at buildtime which
# causes npm ci to skip devDependencies (@nestjs/cli is there, nest cmd needed)
ENV NODE_ENV=development

# Native deps for bcrypt (napi-v3 binding)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

# Generate Prisma client before compiling TypeScript
RUN npx prisma generate

COPY . .

RUN npm run build

# =============================================
# Stage 2 — Runner (lean production image)
# =============================================
FROM node:20-alpine AS runner

# dumb-init: proper PID 1 signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

ENV NODE_ENV=production

# Copy only what the runtime needs
COPY --from=builder /app/node_modules  ./node_modules
COPY --from=builder /app/dist          ./dist
COPY --from=builder /app/prisma        ./prisma
COPY --from=builder /app/package.json  ./package.json

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

# Simple liveness check — any HTTP response means the server is up
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/ || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["./docker-entrypoint.sh"]
