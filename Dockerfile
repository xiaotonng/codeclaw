# syntax=docker/dockerfile:1.7
#
# Pikiclaw — Docker image
#
# Layered approach:
#   1. `builder`  full deps, compiles TS + builds Vite dashboard
#   2. `deps`     production-only node_modules (no devDeps)
#   3. `runtime`  Node 20 slim + agent CLIs (claude / codex / gemini) baked in,
#                 non-root user, /workspace and /home/piki/.pikiclaw as volumes
#
# Build:
#   docker build -t pikiclaw:local .
#
# Run (named volumes + Telegram example):
#   docker run --rm -it -p 3939:3939 \
#     -e TELEGRAM_BOT_TOKEN=...:... \
#     -e ANTHROPIC_API_KEY=sk-ant-... \
#     -v pikiclaw-config:/home/piki/.pikiclaw \
#     -v pikiclaw-workspace:/workspace \
#     ghcr.io/xiaotonng/pikiclaw:latest
#
# See docs/DOCKER.md for the full reference.

ARG NODE_VERSION=20-bookworm-slim

# ---------------------------------------------------------------------------
# Stage 1 — builder: install all deps, compile TS, build the Vite dashboard.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder

WORKDIR /build

# Native modules (@napi-rs/keyring is optional but pulls a tiny build chain)
# need python + a C toolchain. Slim has neither; install minimally.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

# Install with full deps so tsc + vite are available.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy only what `npm run build` (tsc + vite) needs. .dockerignore
# already keeps node_modules, dist/, .pikiclaw/, .scratch/, etc. out.
COPY tsconfig.json ./tsconfig.json
COPY src ./src
COPY dashboard ./dashboard

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — deps: production-only node_modules (drops devDeps to slim runtime).
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps

WORKDIR /deps

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 3 — runtime: Node + agent CLIs + compiled pikiclaw.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

ARG CLAUDE_CODE_VERSION=latest
ARG CODEX_VERSION=latest
ARG GEMINI_CLI_VERSION=latest

# tini reaps zombies and forwards SIGTERM/SIGINT cleanly to the Node process.
# git + ca-certs are needed by agent CLIs and skill installers.
# curl is used by HEALTHCHECK and by the gh-cli apt repo install below.
# gh is a frequent dependency in agent skills (release/PR triage flows).
# sqlite3 is invoked by codex driver to read the rate-limit usage state DB —
# omitting it surfaces a harmless "sqlite3: not found" warning to logs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        tini \
        curl \
        dumb-init \
        sqlite3 \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# Non-root user. uid/gid 1000 keeps host bind-mounts portable on Linux hosts
# (where the first interactive user is typically 1000). `node:slim` ships a
# pre-existing `node` user at uid/gid 1000, so remove it first to free the id
# range — we want a stable `piki` username regardless of base-image churn.
ARG PUID=1000
ARG PGID=1000
RUN if id node >/dev/null 2>&1; then userdel -r node 2>/dev/null || true; fi \
 && if getent group node >/dev/null 2>&1; then groupdel node 2>/dev/null || true; fi \
 && groupadd -g ${PGID} piki \
 && useradd -m -u ${PUID} -g ${PGID} -s /bin/bash piki

# Bake the three first-party agent CLIs into a piki-owned npm prefix. Installing
# globally to /usr/local would write a root-owned tree, so subsequent
# `npm install -g <pkg>@latest` from the dashboard / auto-updater would fail
# with EACCES. A per-user prefix lets piki update them without sudo.
# Each CLI is independently optional — a failure to install one must not abort
# the whole build (e.g. a transient registry hiccup or a yanked version tag).
ENV NPM_CONFIG_PREFIX=/home/piki/.npm-global
RUN mkdir -p /home/piki/.npm-global && chown -R piki:piki /home/piki/.npm-global
USER piki
RUN set -eux; \
    for spec in \
        "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
        "@openai/codex@${CODEX_VERSION}" \
        "@google/gemini-cli@${GEMINI_CLI_VERSION}" ; do \
        npm install -g --no-audit --no-fund "$spec" || echo "warn: failed to install $spec"; \
    done; \
    npm cache clean --force
USER root

WORKDIR /app

# Bring in the prod-only node_modules and the compiled output.
COPY --chown=piki:piki package.json package-lock.json ./
COPY --from=deps    --chown=piki:piki /deps/node_modules ./node_modules
COPY --from=builder --chown=piki:piki /build/dist ./dist
COPY --from=builder --chown=piki:piki /build/dashboard/dist ./dashboard/dist

# Persistent dirs the entrypoint expects to exist.
RUN mkdir -p /workspace /home/piki/.pikiclaw \
             /home/piki/.claude /home/piki/.codex /home/piki/.gemini \
 && chown -R piki:piki /workspace /home/piki

COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/pikiclaw-entrypoint
RUN chmod +x /usr/local/bin/pikiclaw-entrypoint

USER piki

ENV NODE_ENV=production \
    HOME=/home/piki \
    PIKICLAW_DOCKER=1 \
    PIKICLAW_OPEN_BROWSER=0 \
    PIKICLAW_WORKDIR=/workspace \
    PATH=/home/piki/.npm-global/bin:/usr/local/bin:/usr/bin:/bin

EXPOSE 3939

VOLUME ["/home/piki/.pikiclaw", "/workspace"]

# /api/state returns 200 once the bot has settled; before that the dashboard
# is still bound but the bot may still be coming up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3939/api/state >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/pikiclaw-entrypoint"]
CMD ["--no-daemon", "--workdir", "/workspace"]
