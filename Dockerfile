FROM node:20-alpine AS builder

# Native deps for bcrypt (napi-v3 binding)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Always include devDependencies for the build, regardless of external NODE_ENV.
RUN npm ci --include=dev

COPY . .

# Generate Prisma client before compiling TypeScript, then remove dev deps for runtime.
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runner

# dumb-init + Chromium pour whatsapp-web.js (Puppeteer)
RUN apk add --no-cache \
    dumb-init wget \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

ENV NODE_ENV=production

# Copy only what the runtime needs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["./docker-entrypoint.sh"]
