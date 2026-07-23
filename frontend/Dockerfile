FROM node:20-alpine AS build
WORKDIR /app

# Build context is the repo root (see docker-compose.yml). Everything the
# frontend build touches is copied in explicitly; the repo-level
# .dockerignore keeps postgres-data/, desktop/, website/, .git/ etc. out of
# the daemon transfer.

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund

# shared/ must land at /shared so that /app/src/api/types.ts resolves
# '../../../shared/api-contracts' (three parents from types.ts → /shared).
# Copy it before the frontend tree so the workdir layout is deterministic.
COPY shared /shared
COPY frontend ./

RUN npm run build

# The nginx-unprivileged image ships the same nginx binary but runs as the
# `nginx` user (uid 101), listens on 8080 instead of 80, and doesn't need
# CAP_NET_BIND_SERVICE. docker-compose maps the host port at 8080.
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
