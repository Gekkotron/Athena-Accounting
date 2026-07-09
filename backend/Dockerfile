FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build

# --- test stage -------------------------------------------------------------
# Reuses the build stage (full dev dependencies + source already present) and
# layers in the test files. Runs migrations then the DB-gated suite entirely
# inside the container, so no Node/npm is needed on the host — only Docker.
# Kept BEFORE the final production stage so the default build target stays prod.
FROM build AS test
ENV NODE_ENV=test
COPY vitest.config.ts ./
COPY tests ./tests
ENTRYPOINT ["sh", "scripts/docker-test-entrypoint.sh"]

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/server.js"]
