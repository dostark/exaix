#!/usr/bin/env -S deno run --allow-all
/**
 * @module ProbeSseLiveness
 * @path tests/scenario_framework/scripts/probe_sse_liveness.ts
 * @architectural-layer Test
 * @description Boots the MCP server on its SSE transport, waits for the port to accept a
 *   connection, reports liveness, and ALWAYS terminates the child. A scenario cannot do
 *   this in YAML: a foreground long-running server can only ever exit non-zero (killed by
 *   the step timeout) and leaks the process on a shared runner — the lifecycle concern
 *   pre-gap GAP-8 raised. Chooses an ephemeral port by default so parallel runs cannot
 *   collide.
 * @dependencies []
 * @related-files [exaix-team/apps/mcp-server/main.ts, tests/scenario_framework/scenarios/mcp_server/sse-liveness.yaml]
 */

import { dirname, fromFileUrl, resolve } from "@std/path";

const SCRIPTS_DIR = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, "..", "..", "..");
const SERVER_ENTRY = resolve(REPO_ROOT, "exaix-team", "apps", "mcp-server", "main.ts");
const DENO_CONFIG = resolve(REPO_ROOT, "deno.json");
const DEFAULT_BOOT_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 250;

/** Ask the OS for a free port, then release it — avoids fixed-port collisions in CI. */
export function pickEphemeralPort(): number {
  const listener = Deno.listen({ port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

/** Poll until the port accepts a TCP connection, or the deadline passes. */
export async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const conn = await Deno.connect({ hostname: "127.0.0.1", port });
      conn.close();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  return false;
}

if (import.meta.main) {
  const portArgIndex = Deno.args.indexOf("--port");
  const port = portArgIndex >= 0 && portArgIndex + 1 < Deno.args.length
    ? parseInt(Deno.args[portArgIndex + 1], 10)
    : pickEphemeralPort();

  const child = new Deno.Command("deno", {
    args: ["run", "-A", "--config", DENO_CONFIG, SERVER_ENTRY, "--transport", "sse", "--port", String(port)],
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  let alive = false;
  try {
    alive = await waitForPort(port, DEFAULT_BOOT_TIMEOUT_MS);
  } finally {
    // Always reap the server, including when the port never came up.
    try {
      child.kill("SIGTERM");
    } catch { /* already gone */ }
    await child.status;
    await child.stdout.cancel().catch(() => {});
    await child.stderr.cancel().catch(() => {});
  }

  console.log(JSON.stringify({ sse_alive: alive, port }, null, 2));
  Deno.exit(alive ? 0 : 1);
}
