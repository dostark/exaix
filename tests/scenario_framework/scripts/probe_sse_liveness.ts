#!/usr/bin/env -S deno run --allow-all
/**
 * @module ProbeSseLiveness
 * @path tests/scenario_framework/scripts/probe_sse_liveness.ts
 * @architectural-layer Test
 * @description Boots the MCP server on its SSE transport in a temporary workspace, waits until
 *   the server journals that it bound its port, confirms a connection is accepted, and ALWAYS
 *   terminates the child. A scenario cannot do this in YAML: a foreground long-running server can
 *   only ever exit non-zero (killed by the step timeout) and leaks the process on a shared runner —
 *   the lifecycle concern pre-gap GAP-8 raised. Chooses an ephemeral port by default so parallel
 *   runs cannot collide. The wait ends on the journaled bind event, or fails when the server exits.
 * @dependencies []
 * @related-files [exaix-team/apps/mcp-server/main.ts, tests/scenario_framework/scenarios/mcp_server/sse-liveness.yaml]
 */

import * as pathBuilders from "@exaix/shared";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { Database } from "@db/sqlite";
import { scenarioRepoRoot } from "./scenario_repo_root.ts";

const SCRIPTS_DIR = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = scenarioRepoRoot(SCRIPTS_DIR);
const SERVER_ENTRY = resolve(REPO_ROOT, "exaix-team", "apps", "mcp-server", "main.ts");
const DENO_CONFIG = resolve(REPO_ROOT, "deno.json");
const SETUP_DB_SCRIPT = resolve(REPO_ROOT, "scripts", "setup_db.ts");
const MIGRATIONS_DIR = resolve(REPO_ROOT, "migrations");
const BOUND_EVENT = "mcp.http_server.started";
/** How often the journal is re-read. A cadence, not a deadline: the wait also ends when the server exits. */
const POLL_INTERVAL_MS = 100;

/** Ask the OS for a free port, then release it — avoids fixed-port collisions in CI. */
export function pickEphemeralPort(): number {
  const listener = Deno.listen({ port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

/** A minimal workspace: the config names its root, and the journal is migrated before the server boots. */
async function prepareWorkspace(workspace: string): Promise<string> {
  const configPath = join(workspace, "exa.config.toml");
  await Deno.writeTextFile(configPath, `[system]\nroot = "${workspace}"\n`);
  const migrated = await new Deno.Command("deno", {
    args: ["run", "-A", "--config", DENO_CONFIG, SETUP_DB_SCRIPT],
    cwd: workspace,
    env: { EXA_MIGRATIONS_DIR: MIGRATIONS_DIR },
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!migrated.success) {
    throw new Error(`setup_db.ts failed: ${new TextDecoder().decode(migrated.stderr)}`);
  }
  return configPath;
}

/** True once the journal holds the server's bind row. Read-only: the server owns the writes. */
function bindRecorded(configPath: string): boolean {
  try {
    const db = new Database(pathBuilders.runtimePath(dirname(configPath), "journal.db"), { readonly: true });
    try {
      return db.prepare("SELECT 1 FROM activity WHERE action_type = ? LIMIT 1").get(BOUND_EVENT) !== undefined;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** Resolves once the server journals its bind. Rejects at once if the server exits first. */
async function waitForBind(configPath: string, server: Deno.ChildProcess): Promise<void> {
  for (;;) {
    if (bindRecorded(configPath)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), POLL_INTERVAL_MS);
    });
    const outcome = await Promise.race([tick, server.status]);
    clearTimeout(timer);
    if (outcome === undefined) continue;
    if (bindRecorded(configPath)) return;
    throw new Error(`MCP server exited with code ${outcome.code} before binding its port`);
  }
}

/** One connection attempt, made once the bind is journaled. A bound listener accepts it immediately. */
async function acceptsConnection(port: number): Promise<boolean> {
  try {
    const conn = await Deno.connect({ hostname: "127.0.0.1", port });
    conn.close();
    return true;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  const portArgIndex = Deno.args.indexOf("--port");
  const port = portArgIndex >= 0 && portArgIndex + 1 < Deno.args.length
    ? parseInt(Deno.args[portArgIndex + 1], 10)
    : pickEphemeralPort();

  const workspace = Deno.makeTempDirSync({ prefix: "sse-liveness-" });
  let alive = false;
  let child: Deno.ChildProcess | undefined;
  try {
    const configPath = await prepareWorkspace(workspace);
    child = new Deno.Command("deno", {
      args: ["run", "-A", "--config", DENO_CONFIG, SERVER_ENTRY, "--transport", "sse", "--port", String(port)],
      env: { EXA_CONFIG_PATH: configPath },
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    await waitForBind(configPath, child);
    alive = await acceptsConnection(port);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    // Always reap the server, including when it never bound.
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch { /* already gone */ }
      await child.status;
      await child.stdout.cancel().catch(() => {});
      await child.stderr.cancel().catch(() => {});
    }
    await Deno.remove(workspace, { recursive: true }).catch(() => {});
  }

  console.log(JSON.stringify({ sse_alive: alive, port }, null, 2));
  Deno.exit(alive ? 0 : 1);
}
