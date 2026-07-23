FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# The nginx-unprivileged image ships the same nginx binary but runs as the
# `nginx` user (uid 101), listens on 8080 instead of 80, and doesn't need
# CAP_NET_BIND_SERVICE. docker-compose maps the host port at 8080.
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
