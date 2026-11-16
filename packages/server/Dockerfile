# The v2 server and its built UI, single-arch (spec #134, decision 12). Build from the repo root:
#   docker build -f packages/server/Dockerfile .
# Phase 4 adds multi-arch builds and publishing.
FROM oven/bun:1.4.2

WORKDIR /app
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY packages ./packages
RUN bun install --frozen-lockfile && bun run --cwd packages/web build

# Holds the database, its pre-migration copies, the `auto` key file and plugin config dirs. Runs as
# root, so a bind mount that Docker creates root-owned on a Linux host stays writable.
ENV DATA_DIR=/config PORT=5000
VOLUME ["/config"]
EXPOSE 5000

CMD ["bun", "packages/server/src/main.ts"]
