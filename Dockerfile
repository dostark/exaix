# syntax=docker/dockerfile:1.7
#
# Exaix agent sandbox image.
#
# The container is the *authoritative* containment boundary for agent execution:
# even a full in-process escape (e.g. via the SQLite FFI dependency) is confined to
# this container's mounts and network rather than the host. The in-container Deno
# permission flags are defense-in-depth only.
#
# Build:   docker build -t exaix-sandbox:dev .
# Run:     see compose.sandbox.yaml for the hardened runtime profile.

# ---------------------------------------------------------------------------
# Stage 1 — builder: vendor the module graph and warm the SQLite FFI native lib
# ---------------------------------------------------------------------------
FROM denoland/deno:2.8.2 AS builder

ENV DENO_DIR=/deno-dir
WORKDIR /app

# Install the Node/build toolchain FIRST: some npm packages still resolve native
# artifacts at install time, and `deno bundle` needs the platform esbuild binary.
# Installing it after the cache would make the cache step fail.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl nodejs npm build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

# Copy the module-graph inputs first so dependency caching is its own layer.
COPY deno.json deno.lock ./
COPY unslop.config.json layout.json ./

# Warm the tree-sitter grammar tarballs before the source copy. They are only read as
# WASM from the npm cache (the native install scripts are not allowed), and this layer
# depends only on the lockfile, so a source change never refetches or rebuilds them.
RUN --mount=type=cache,target=/cache/deno,sharing=locked \
    printf '{"nodeModulesDir":"none"}\n' > /tmp/grammar-cache.json \
    && DENO_DIR=/cache/deno deno cache --config /tmp/grammar-cache.json \
      npm:web-tree-sitter@0.26.12 npm:tree-sitter@0.25.0 npm:tree-sitter-python@0.25.0 \
      npm:tree-sitter-rust@0.24.0 npm:tree-sitter-go@0.25.0 npm:tree-sitter-java@0.23.5 \
      npm:tree-sitter-javascript@0.25.0 \
    && cp -a /cache/deno/. /deno-dir/ \
    && rm /tmp/grammar-cache.json

COPY packages/ packages/
COPY apps/ apps/
COPY exaix-team/ exaix-team/
COPY unslop-ts/ unslop-ts/

# Vendor the daemon module graph into DENO_DIR. (The CLI `exactl` is not run inside
# the daemon container; one of its commands imports from tests/, which is excluded.)
# The module cache lives in a BuildKit cache mount, so a rebuild after a dependency
# change reuses what was already downloaded. The copy bakes the modules into this layer.
RUN --mount=type=cache,target=/cache/deno,sharing=locked \
    DENO_DIR=/cache/deno deno cache --config deno.json apps/daemon/main.ts \
    && cp -a /cache/deno/. /deno-dir/

# @db/sqlite loads a native library that @denosaurs/plug downloads at RUNTIME from
# GitHub. Warm it here so the .so is baked into DENO_DIR and the runtime container
# can run with restricted network egress (no GitHub access needed at start).
RUN --mount=type=cache,target=/cache/deno,sharing=locked \
    printf 'import { Database } from "@db/sqlite";\nconst db = new Database(":memory:");\ndb.close();\n' > /tmp/warm_sqlite.ts \
    && DENO_DIR=/cache/deno deno run --config deno.json --allow-ffi --allow-read --allow-write --allow-env --allow-net /tmp/warm_sqlite.ts \
    && cp -a /cache/deno/. /deno-dir/ \
    && rm /tmp/warm_sqlite.ts

# ---------------------------------------------------------------------------
# Delegate CLIs: one stage per CLI, each installed into its own npm prefix at a pinned
# version. A version bump rebuilds only that CLI's stage, and the npm download cache is a
# BuildKit cache mount, so a rebuild reuses what was already downloaded.
# ---------------------------------------------------------------------------
# Claude Code comes from its official installer, pinned to a version. HOME points into the
# stage's prefix, so the binary lands in /opt/cli/claude/.local/bin. pipefail makes a failed
# download fail the build instead of installing nothing.
FROM builder AS cli-claude
RUN ["/bin/bash", "-o", "pipefail", "-c", "curl -fsSL https://claude.ai/install.sh | HOME=/opt/cli/claude bash -s 2.1.302"]

FROM builder AS cli-opencode
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install -g --prefix /opt/cli/opencode --fetch-timeout=60000 --fetch-retries=5 opencode-ai@1.19.3

FROM builder AS cli-codex
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install -g --prefix /opt/cli/codex --fetch-timeout=60000 --fetch-retries=5 @openai/codex@0.163.0

# ---------------------------------------------------------------------------
# Devcontainer: the builder toolchain plus the delegate CLIs from their own stages. The
# test images build from `builder` and never copy these, so a CLI change cannot slow them.
# OpenRouter does not require a binary — it is configured via env vars only.
# ---------------------------------------------------------------------------
FROM builder AS devcontainer
COPY --from=cli-claude /opt/cli/claude /opt/cli/claude
COPY --from=cli-opencode /opt/cli/opencode /opt/cli/opencode
COPY --from=cli-codex /opt/cli/codex /opt/cli/codex
ENV PATH="/opt/cli/claude/.local/bin:/opt/cli/opencode/bin:/opt/cli/codex/bin:${PATH}"
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install -g node-gyp

FROM denoland/deno:2.8.2 AS runtime

# git is required by GitService and the run_command allowlist; ca-certificates for TLS.
# node/npm are intentionally omitted — add them only if your portals need JS tooling.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV DENO_DIR=/deno-dir
# Mount the Exaix runtime home (workspace, memory, journal) here as a volume.
ENV EXA_HOME=/exa

# Dedicated non-root runtime user (uid/gid 10001).
RUN groupadd --gid 10001 exaix \
  && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/exaix exaix \
  && mkdir -p /app /exa \
  && chown -R 10001:10001 /exa /home/exaix

WORKDIR /app
COPY --from=builder --chown=10001:10001 /deno-dir /deno-dir
# deno.json sets nodeModulesDir "auto". The rootfs is read-only, so ship the prepared node_modules.
COPY --from=builder --chown=10001:10001 /app/node_modules /app/node_modules
COPY --chown=10001:10001 deno.json ./
# The builder's lockfile matches this module graph. The read-only rootfs cannot rewrite a drifted one.
COPY --from=builder --chown=10001:10001 /app/deno.lock ./
COPY --chown=10001:10001 unslop.config.json layout.json ./
COPY --chown=10001:10001 packages/ packages/
COPY --chown=10001:10001 apps/ apps/
# deno.json lists these workspace members. The config does not load without them.
COPY --chown=10001:10001 exaix-team/ exaix-team/
COPY --chown=10001:10001 unslop-ts/ unslop-ts/

USER 10001:10001
WORKDIR /exa

# Scoped permissions mirror deno.json's hardened `start` task (defense-in-depth;
# the container boundary is what actually contains an escape).
ENTRYPOINT ["deno", "run", \
  "--config", "/app/deno.json", \
  "--allow-read", "--allow-write", "--allow-net", "--allow-env", "--allow-ffi", "--allow-import", \
  "--allow-run=git,deno,exoctl,opencode,claude,ls,grep,echo,printf,pwd,whoami,id,date,uptime,which,type,command,hash,alias", \
  "/app/apps/daemon/main.ts"]

# ---------------------------------------------------------------------------
# Stage 3 — eval-jail: the delegate-run container for the eval harness's bare cells.
# The runner mounts ONLY the task worktree into this container (`--mount
# src=<worktree>,dst=/worktree`), so the repo's fixtures — including the
# `reference.patch` solution for the very task under test — are NOT present in the
# delegate's filesystem. Solution leakage becomes structurally impossible, and the
# opencode permission config / claude tool flags become defense-in-depth.
# The jail does NOT run the Exaix daemon, so it deliberately skips the builder's
# deno module-graph cache (which carries the grammar and native packages) — it only
# needs node (for Claude Code) and the delegate CLIs.
# Build:   docker build --target eval-jail -t exaix-eval-jail .
# ---------------------------------------------------------------------------
FROM denoland/deno:2.8.2 AS eval-jail

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl nodejs npm build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

# The delegate CLIs come from their pinned stages (cli-*), so the sandbox never runs an install
# script. Each prefix is world-readable, so any --user can run them.
COPY --from=cli-claude /opt/cli/claude /opt/cli/claude
COPY --from=cli-opencode /opt/cli/opencode /opt/cli/opencode
ENV PATH="/opt/cli/claude/.local/bin:/opt/cli/opencode/bin:${PATH}"
RUN set -eux; command -v claude && command -v opencode

# The runner passes `--user <host-uid>:<host-gid>` so the bind-mounted worktree (owned by the
# host user) is writable; HOME=/tmp gives the delegate a writable cache. The image default user
# is only a fallback when --user is absent.
ENV HOME=/tmp
WORKDIR /worktree

# ---------------------------------------------------------------------------
# Stage 4 — dev-test: the worker-container image for the Phase 207 Batch-2 pool.
# It extends the warmed `builder` toolchain and adds git + procps and the test-graph
# cache. The repo is bind-mounted read-write at run time; the copied tests/scripts
# only warm DENO_DIR so the worker's `--network none` driver resolves offline.
# Build:   docker build --target dev-test -t exaix-dev-test:dev .
# ---------------------------------------------------------------------------
FROM builder AS dev-test

# git is required by Batch-2 tests that run git; procps supplies pkill/ps for the
# in-container driver's per-file reap. ca-certificates matches the builder stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates procps \
  && rm -rf /var/lib/apt/lists/*

# The scenario runner and several daemon tests spawn `exactl` as a bare command from
# PATH (the host has it from `deno install`). Install a shim that runs the bind-mounted
# repo, so the container's exactl matches the checkout under test.
RUN printf '#!/bin/sh\nexec deno run --allow-all --config /workspaces/exaix/deno.json /workspaces/exaix/apps/exactl/main.ts "$@"\n' > /usr/local/bin/exactl \
  && chmod 0755 /usr/local/bin/exactl

COPY tests/ tests/
COPY scripts/ scripts/
COPY docs/CODE_STYLE.md docs/CODE_STYLE.md

# Warm the driver entrypoint's import graph (plus the test/package/app graph) so the
# worker resolves every module with `--network none`. Cache the entrypoint, not the
# whole scripts/ tree: `deno task check` excludes scripts/, so a directory-wide cache
# can fail on an unrelated script error. The computed `npm:tree-sitter-<lang>/…wasm`
# specifiers are warmed by the builder's source-independent grammar layer.
# Cache the engine entries and source, not `unslop-ts/`: its Bun/Node examples import
# packages (for example `typescript-eslint`) that the parent import map does not define.
RUN deno cache --config deno.json scripts/test_container_driver.ts tests/ packages/ apps/ exaix-team/ \
  unslop-ts/deno.json unslop-ts/mod.ts unslop-ts/deno.ts unslop-ts/eslint.ts unslop-ts/src \
  packages/core/tests/skills/skill_folder_performance_test.ts

# `deno bundle` fetches the esbuild platform binary lazily. The portal policy installer runs
# it in the network-isolated test container, so warm the exact dependency during the image build.
RUN printf 'export const probe = 1;\n' > /tmp/bundle_probe.ts \
  && deno bundle --config deno.json /tmp/bundle_probe.ts -o /tmp/bundle_probe.js \
  && rm -f /tmp/bundle_probe.ts /tmp/bundle_probe.js

# The worker runs as `--user <host-uid>:<host-gid>`; make the warmed cache writable by
# any uid (the runtime stage pins a fixed uid; dev-test cannot).
RUN chmod -R a+rwX /deno-dir
