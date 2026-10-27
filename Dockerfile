# syntax=docker/dockerfile:1
# Multi-stage build for the OpenRent images: api (also serves admin + widget), worker, storefront.
#   docker build --target api -t openrent/api .
#   docker build --target worker -t openrent/worker .
#   docker build --target storefront -t openrent/storefront .

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openrent/api build \
 && pnpm --filter @openrent/worker build \
 && pnpm --filter @openrent/cli build \
 && pnpm --filter @openrent/admin build \
 && pnpm --filter @openrent/storefront build \
 && pnpm --filter @openrent/widget build
RUN pnpm --filter @openrent/api deploy --prod --legacy /out/api \
 && pnpm --filter @openrent/worker deploy --prod --legacy /out/worker \
 && pnpm --filter @openrent/storefront deploy --prod --legacy /out/storefront

# API and worker render document PDFs with headless Chromium (PRD FR-DOC-2).
FROM node:24-slim AS api
ENV NODE_ENV=production PORT=7070 OPENRENT_MIGRATIONS_DIR=/app/dist/migrations ADMIN_DIST=/app/admin WIDGET_DIST=/app/widget PLUGINS_CONFIG=/app/plugins.json THEMES_CONFIG=/app/themes.json PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /out/api/node_modules ./node_modules
# Noto CJK gives Japanese documents real glyphs instead of empty boxes.
RUN node node_modules/playwright/cli.js install --with-deps chromium-headless-shell \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/apps/api/package.json ./package.json
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/admin/build ./admin
COPY --from=build /src/apps/widget/dist ./widget
COPY --from=build /src/plugins.json ./plugins.json
COPY --from=build /src/themes.json ./themes.json
USER node
EXPOSE 7070
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:7070/api/v1/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

FROM node:24-slim AS worker
ENV NODE_ENV=production PLUGINS_CONFIG=/app/plugins.json PLAYWRIGHT_BROWSERS_PATH=/ms-playwright OPENRENT_MIGRATIONS_DIR=/app/migrations OPENRENT_INVARIANTS_FILE=/app/sql/invariants.sql
WORKDIR /app
COPY --from=build /out/worker/node_modules ./node_modules
# Noto CJK gives Japanese documents real glyphs instead of empty boxes.
RUN node node_modules/playwright/cli.js install --with-deps chromium-headless-shell \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*
# pg_dump/pg_restore for `openrent backup` and `restore`, matching the compose PostgreSQL 16.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-common ca-certificates \
  && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/apps/worker/package.json ./package.json
COPY --from=build /src/apps/worker/dist ./dist
COPY --from=build /src/packages/cli/dist ./cli
COPY --from=build /src/plugins.json ./plugins.json
# `openrent restore` and `openrent migrate` run the migrations and invariants from here.
COPY --from=build /src/packages/db/migrations ./migrations
COPY --from=build /src/packages/db/sql ./sql
# `docker compose exec worker openrent backup --out /backups/2026-10-25`
RUN printf '#!/bin/sh\nexec node /app/cli/main.js "$@"\n' > /usr/local/bin/openrent && chmod +x /usr/local/bin/openrent \
  && mkdir -p /backups && chown node:node /backups
USER node
CMD ["node", "dist/main.js"]

FROM node:24-slim AS storefront
ENV NODE_ENV=production PORT=7072
WORKDIR /app
COPY --from=build /out/storefront/node_modules ./node_modules
COPY --from=build /src/apps/storefront/package.json ./package.json
COPY --from=build /src/apps/storefront/build ./build
USER node
EXPOSE 7072
CMD ["node", "build/index.js"]
