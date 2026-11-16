#!/bin/sh
# Runs a harness inside oven/bun at the host's Bun version, on a clean copy of the repo.
# Usage (from the repo root): packages/core/experiment/worker-preflight/in-docker.sh <script> [args...]
set -eu
repo=$(git rev-parse --show-toplevel)
results="$repo/packages/core/experiment/worker-preflight/results"
docker run --rm ${PLATFORM:+--platform "$PLATFORM"} -v "$repo:/src:ro" -v "$results:/results" "oven/bun:$(bun --version)" sh -c '
  mkdir /app && cd /src && tar --exclude=node_modules --exclude=.git -cf - . | tar -xf - -C /app
  cd /app && bun install --frozen-lockfile >/dev/null 2>&1
  cd packages/core/experiment/worker-preflight && rm -rf results && ln -s /results results
  exec bun "$@"' sh "$@"
