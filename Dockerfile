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

# Copy the module-graph inputs first so dependency caching is its own layer.
COPY deno.json deno.lock ./
COPY packages/ packages/
COPY apps/ apps/

# Vendor the daemon module graph into DENO_DIR. (The CLI `exactl` is not run inside
# the daemon container; one of its commands imports from tests/, which is excluded.)
RUN deno cache --config deno.json apps/daemon/main.ts

# @db/sqlite loads a native library that @denosaurs/plug downloads at RUNTIME from
# GitHub. Warm it here so the .so is baked into DENO_DIR and the runtime container
# can run with restricted network egress (no GitHub access needed at start).
RUN printf 'import { Database } from "@db/sqlite";\nconst db = new Database(":memory:");\ndb.close();\n' > /tmp/warm_sqlite.ts \
  && deno run --config deno.json --allow-ffi --allow-read --allow-write --allow-env --allow-net /tmp/warm_sqlite.ts \
  && rm /tmp/warm_sqlite.ts

# Install Node.js and delegate CLI tools (Claude Code, OpenCode CLI) for
# headless agent integration tests and dogfooding. The devcontainer (target
# "builder") needs these on PATH so the @provider_live E2E test can run.
# OpenRouter does not require a binary — it is configured via env vars only.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl nodejs npm build-essential python3 \
  && npm install -g node-gyp @anthropic-ai/claude-code \
  && curl -fsSL https://opencode.ai/install | bash \
  && rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache

# ---------------------------------------------------------------------------
# Stage 2 — runtime: non-root, minimal toolset, scoped permissions
# ---------------------------------------------------------------------------
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
COPY --chown=10001:10001 deno.json deno.lock ./
COPY --chown=10001:10001 packages/ packages/
COPY --chown=10001:10001 apps/ apps/

USER 10001:10001
WORKDIR /exa

# Scoped permissions mirror deno.json's hardened `start` task (defense-in-depth;
# the container boundary is what actually contains an escape).
ENTRYPOINT ["deno", "run", \
  "--config", "/app/deno.json", \
  "--allow-read", "--allow-write", "--allow-net", "--allow-env", "--allow-ffi", "--allow-import", \
  "--allow-run=git,deno,npm,node,exoctl,opencode,claude,ls,grep,echo,printf,pwd,whoami,id,date,uptime,which,type,command,hash,alias", \
  "/app/apps/daemon/main.ts"]

# ---------------------------------------------------------------------------
# Stage 3 — eval-jail: the delegate-run container for the eval harness's bare cells.
# The runner mounts ONLY the task worktree into this container (`--mount
# src=<worktree>,dst=/worktree`), so the repo's fixtures — including the
# `reference.patch` solution for the very task under test — are NOT present in the
# delegate's filesystem. Solution leakage becomes structurally impossible, and the
# opencode permission config / claude tool flags become defense-in-depth.
# The jail does NOT run the Exaix daemon, so it deliberately skips the builder's
# deno module-graph cache (which needs native tree-sitter compilation) — it only
# needs node (for Claude Code) and the delegate CLIs.
# Build:   docker build --target eval-jail -t exaix-eval-jail .
# ---------------------------------------------------------------------------
FROM denoland/deno:2.8.2 AS eval-jail

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl nodejs npm build-essential python3 \
  && npm install -g @anthropic-ai/claude-code \
  && curl -fsSL https://opencode.ai/install | bash \
  && rm -rf /var/lib/apt/lists/* /root/.npm /root/.cache

# Make the delegate CLIs resolvable for any --user. npm -g puts claude in /usr/local/bin
# (world-readable); the opencode install script drops the binary under the building user's
# home — which is root-private (0700) — so COPY it (dereferenced) into /usr/local/bin rather
# than symlinking, or a non-root delegate could not traverse the target.
RUN set -eux; \
    command -v claude; \
    opencode_src="$(find /root /usr/local /usr/bin /home -name opencode -type f 2>/dev/null | head -n1 || true)"; \
    if [ -n "$opencode_src" ]; then cp "$opencode_src" /usr/local/bin/opencode && chmod 755 /usr/local/bin/opencode; fi; \
    command -v opencode && command -v claude

# The runner passes `--user <host-uid>:<host-gid>` so the bind-mounted worktree (owned by the
# host user) is writable; HOME=/tmp gives the delegate a writable cache. The image default user
# is only a fallback when --user is absent.
ENV HOME=/tmp
WORKDIR /worktree
