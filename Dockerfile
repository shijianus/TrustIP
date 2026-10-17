# Three stages: `build` compiles the SPA with every dependency, `deps` installs
# the production dependencies alone, and `production` is the runtime — no dev
# dependency, no compiler toolchain, no package manager, run as the unprivileged
# `node` user (uid 1000) the official image ships.

# ---------- build: dev dependencies + vite build ----------
FROM node:24-alpine AS build-stage
# corepack ships with the node image and provisions pnpm at the version pinned
# by the `packageManager` field in package.json — no global npm install needed.
RUN corepack enable
# node-gyp toolchain for native deps without musl prebuilds (node-pty, pulled
# in by the code-inspector dev plugin) — build stage only.
RUN apk add --no-cache python3 make g++
WORKDIR /app
# Copy the manifests first so this layer (and the install below) stays cached
# unless dependencies actually change. pnpm-workspace.yaml carries the
# allowBuilds approvals; pnpm-lock.yaml is required by --frozen-lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# ---------- deps: production dependencies only ----------
FROM node:24-alpine AS deps-stage
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --prod drops devDependencies (vite, the code-inspector / node-pty chain,
# nodemon, tailwind); every runtime native dependency ships a musl prebuild.
RUN pnpm install --frozen-lockfile --prod

# ---------- production: runtime ----------
FROM node:24-alpine AS production-stage
WORKDIR /app
# Owned by `node`: the backend downloads its offline datasets into
# common/<name>-db/ at first boot and must be able to create them.
RUN chown node:node /app
# node_modules is copied as-is (pnpm's symlink farm into .pnpm is preserved
# within /app), so the runtime needs no install step and no package manager.
COPY --from=deps-stage --chown=node:node /app/node_modules ./node_modules
COPY --from=build-stage --chown=node:node /app/package.json ./
COPY --from=build-stage --chown=node:node /app/dist ./dist
COPY --from=build-stage --chown=node:node /app/backend-server.js ./
COPY --from=build-stage --chown=node:node /app/frontend-server.js ./
# npm start boots the backend with `--import ./sentry-instrument.js`
COPY --from=build-stage --chown=node:node /app/sentry-instrument.js ./
COPY --from=build-stage --chown=node:node /app/api ./api
COPY --from=build-stage --chown=node:node /app/common ./common
COPY --from=build-stage --chown=node:node /app/docker/healthcheck.js ./docker/healthcheck.js
# The dataset directories exist (empty, node-owned) so a named volume mounted
# on one (deploy/docker-compose.vps.yml) inherits that owner instead of root.
RUN mkdir -p common/maxmind-db common/as-rel-db common/as-org-db common/peeringdb-db common/oui-db \
    && chown node:node common/maxmind-db common/as-rel-db common/as-org-db common/peeringdb-db common/oui-db

USER node

EXPOSE 18966

# Node-only probe (the alpine image has no curl): the static server on
# FRONTEND_PORT and the API behind it on BACKEND_PORT must both answer.
# start-period covers a first boot that is still downloading datasets.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "docker/healthcheck.js"]

# Start application
CMD ["npm", "start"]
