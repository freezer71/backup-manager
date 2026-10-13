# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Application : pas d'outils de dump (les scripts tournent dans le runner).
# Le code appartient à root : le processus (uid app) ne peut pas le modifier.
FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Europe/Paris DATA_DIR=/data NAS_DIR=/mnt/backups-nas

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 app && useradd --uid 1001 --gid app --create-home app \
 && mkdir -p /data /mnt/backups-nas /work /run/bm && chown app:app /data /mnt/backups-nas

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

USER app
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]

# Runner isolé : exécute les scripts de backup, sans la base, sans sa clé, sans le NAS.
# Tourne en root avec seulement CHOWN/SETUID/SETGID/KILL (voir docker-compose.yml) pour lancer
# chaque run sous son propre uid.
FROM node:24-bookworm-slim AS runner
WORKDIR /runner
ENV NODE_ENV=production TZ=Europe/Paris RUNNER_SOCKET=/run/bm/runner.sock WORK_DIR=/work APP_GID=1001

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg bash tzdata \
 && install -d /usr/share/keyrings \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && curl -fsSL https://pgp.mongodb.com/server-8.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/mongodb.gpg] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/8.0 main" > /etc/apt/sources.list.d/mongodb.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 mongodb-database-tools \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /work /run/bm

COPY lib/runner/env.ts lib/runner/execute.ts lib/runner/mask.ts ./lib/runner/
COPY runner/server.ts ./runner/

VOLUME /work
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD test -S "$RUNNER_SOCKET" || exit 1
CMD ["node", "runner/server.ts"]
