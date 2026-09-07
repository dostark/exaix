/**
 * @module McpServerSpecComplianceCutoverTest
 * @path tests/integration/mcp_server_spec_compliance_cutover_test.ts
 * @description Phase 163 Step 7 (mandatory, non-deferrable cutover) — proves BOTH halves
 *   of the phase from their real entry points, not simulated:
 *
 *   1. The redesigned `exactl mcp start` server speaks real Streamable HTTP to a real
 *      official-SDK client, matching Step 1's golden fixture exactly.
 *   2. The stdio transport is proven independently over a real subprocess pipe.
 *   3. A real `EXAIX_EDITION=team` daemon boot executes `analyze-codebase.flow.yaml`'s
 *      `execution_mode: dynamic` step through a real `DynamicStepExecutor`.
 *   4. `mcp.require_auth=true` (real config + `MCP_AUTH_TOKEN` env) is enforced end-to-end:
 *      unauthenticated requests are rejected 401 and a valid bearer token is accepted.
 *
 *   Mirrors Phase 162's `external_mcp_client_cutover_test.ts` subprocess discipline (real
 *   process, real port/pipe, real client) — never an in-process `MCPServer` construction.
 * @architectural-layer Test
 * @related-files [exaix-team/apps/mcp-server/main.ts, exaix-team/packages/mcp-server/server.ts, apps/daemon/main.ts, packages/flow/src/dynamic_step_executor.ts]
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { z } from "zod";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { toSdkCallToolResult } from "@exaix-team/mcp-server";
import { setupGitRepo } from "@exaix/git/testing";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import { bootRealDaemon, daemonConfigSections, writePortalDir } from "./helpers/daemon_config.ts";
import { runMigrationsIn } from "./helpers/migrate_test_db.ts";
import {
  GOLDEN_FIXTURE_PATH,
  GOLDEN_FIXTURE_SEED_FILES,
  type IGoldenFixtureCapture,
  REPRESENTATIVE_TOOL_CALLS,
} from "../../exaix-team/packages/mcp-server/tests/fixtures/golden_fixture_capture.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const PORTAL_ALIAS = "TestPortal";
const MCP_SERVER_MAIN = join(REPO_ROOT, "exaix-team", "apps", "mcp-server", "main.ts");
const DYNAMIC_STEP_COMPLETED = "dynamic_step_completed";

/** ReAct completion fixture: the dynamic step's single LLM call declares completion. */
const REACT_COMPLETE_FIXTURE = {
  promptHash: "0000000000000000000000000000000000000000000000000000000000000000",
  promptPreview: "\nYou are Senior Software Engineer,",
  response: JSON.stringify({
    reasoning: "Exploration objective met; no further tool calls needed.",
    action: { type: "complete", output: "Exploration complete." },
  }),
  model: "test",
  tokens: { input: 10, output: 10 },
  recordedAt: "2026-08-13T00:00:00Z",
};

function getFreePort(): number {
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

/** Seed a portal (real git repo + golden seed files) and return its path. */
async function seedPortal(root: string): Promise<string> {
  const portalPath = join(root, PORTAL_ALIAS);
  Deno.mkdirSync(portalPath, { recursive: true });
  for (const [filename, content] of Object.entries(GOLDEN_FIXTURE_SEED_FILES)) {
    Deno.writeTextFileSync(join(portalPath, filename), content);
  }
  await setupGitRepo(portalPath);
  return portalPath;
}

/** Write the MCP server workspace config (real git enabled for GIT-category parity). */
function writeMcpServerConfig(configPath: string, root: string, portalPath: string, extraSections = ""): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[[portals]]",
    `alias = "${PORTAL_ALIAS}"`,
    `target_path = "${portalPath}"`,
    'agents_allowed = ["*"]',
    "",
    extraSections,
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Wait until a TCP listener on `port` accepts connections (or timeout). */
async function waitForPort(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const conn = await Deno.connect({ port, hostname: "127.0.0.1" });
      conn.close();
      await new Promise((r) => setTimeout(r, 200));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`server never listened on port ${port} within ${timeoutMs}ms`);
}

interface IServerHandle {
  port: number;
  proc: Deno.ChildProcess;
  stop: () => Promise<void>;
}

/** Spawn `exaix-team/apps/mcp-server/main.ts --transport sse --port <free>` with `EXA_CONFIG_PATH`. */
async function startSseServer(
  configPath: string,
  extraEnv: Record<string, string> = {},
): Promise<IServerHandle> {
  const port = getFreePort();
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", MCP_SERVER_MAIN, "--transport", "sse", "--port", String(port)],
    env: { EXA_CONFIG_PATH: configPath, EXA_MCP_REAL_GIT: "1", ...extraEnv },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  await waitForPort(port);
  return {
    port,
    proc,
    stop: async () => {
      try {
        proc.kill("SIGTERM");
      } catch { /* already dead */ }
      try {
        await proc.status;
      } catch { /* already finished */ }
    },
  };
}

/** Assert the server's wire responses match the golden fixture exactly (tools/list + calls). */
async function assertGoldenFixtureParity(port: number, authToken?: string): Promise<void> {
  const checkedIn = JSON.parse(await Deno.readTextFile(GOLDEN_FIXTURE_PATH)) as IGoldenFixtureCapture;
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/`), {
    ...(authToken ? { authProvider: { token: () => Promise.resolve(authToken) } } : {}),
  });
  const client = new Client({ name: "phase-163-cutover-client", version: "1.0.0" });
  try {
    await client.connect(transport);

    const toolsList = await client.request({ method: "tools/list", params: {} }, z.unknown());
    assertEquals(
      JSON.parse(JSON.stringify(toolsList)),
      checkedIn.toolsList.result,
      "tools/list over the real CLI-served Streamable HTTP must match Step 1's golden fixture exactly",
    );

    for (const { category, toolName, args } of REPRESENTATIVE_TOOL_CALLS) {
      const callResult = await client.request(
        { method: "tools/call", params: { name: toolName, arguments: args } },
        z.unknown(),
      );
      const expected = toSdkCallToolResult(checkedIn.representativeToolCalls[category].result);
      assertEquals(
        JSON.parse(JSON.stringify(callResult)),
        JSON.parse(JSON.stringify(expected)),
        `representative tools/call for category '${category}' over the real CLI-served HTTP must match ` +
          "Step 1's golden fixture (adapted for the SDK's structuredContent mechanism where applicable)",
      );
    }
  } finally {
    await client.close();
  }
}

/** Seed a Team-edition daemon workspace with the real analyze-codebase flow + recordings. */
function seedAnalyzeCodebaseWorkspace(root: string): void {
  const flowsDir = join(root, "Blueprints", "Flows");
  Deno.mkdirSync(flowsDir, { recursive: true });
  Deno.copyFileSync(
    join(REPO_ROOT, "Blueprints", "Flows", "analyze-codebase.flow.yaml"),
    join(flowsDir, "analyze-codebase.flow.yaml"),
  );
  const agentRolesDir = join(root, "Blueprints", "Agents");
  Deno.mkdirSync(agentRolesDir, { recursive: true });
  Deno.copyFileSync(
    join(REPO_ROOT, "Blueprints", "Agents", "senior-coder.md"),
    join(agentRolesDir, "senior-coder.md"),
  );
  writePortalDir(root);
  const recordingsDir = join(root, "recordings");
  Deno.mkdirSync(recordingsDir, { recursive: true });
  Deno.writeTextFileSync(
    join(recordingsDir, "react-complete.json"),
    JSON.stringify(REACT_COMPLETE_FIXTURE, null, 2),
  );
}

function writeTeamDaemonConfig(configPath: string, root: string, portalDir: string, recordingsDir: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    `fixtures_dir = "${recordingsDir}"`,
    "",
    "[quality_gate]",
    "enabled = false",
    "",
    "[request_analysis]",
    "enabled = false",
    "",
    "[[portals]]",
    'alias = "workspace"',
    `target_path = "${portalDir}"`,
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

function writeAnalyzeCodebaseRequest(root: string): void {
  const dir = join(root, "Workspace", "Requests");
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(
    join(dir, "analyze-codebase-cutover.md"),
    [
      "---",
      'trace_id: "analyze-codebase-cutover"',
      `created: "${new Date().toISOString()}"`,
      'status: "pending"',
      'priority: "normal"',
      'source: "cli"',
      'created_by: "phase-163-cutover"',
      'flow: "analyze-codebase"',
      "---",
      "",
      "# Explore the workspace structure",
      "",
      "Explore the Blueprints and Workspace directories and report on their structure.",
      "",
    ].join("\n"),
  );
}

async function readLastEvent(configPath: string, actionType: string): Promise<boolean> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    const rows = await db.preparedAll<{ action_type: string }>(
      "SELECT action_type FROM activity WHERE action_type = ? LIMIT 1",
      [actionType],
    );
    return rows.length > 0;
  } catch {
    return false;
  } finally {
    await db.close();
  }
}

// Test 1: real Streamable HTTP over the CLI entry point

Deno.test({
  name:
    "[cutover] exactl mcp start --sse serves real Streamable HTTP; a real client lists/calls tools matching the golden fixture",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase-163-cutover-sse-" });
    const configPath = join(tempDir, "exa.config.toml");
    let handle: IServerHandle | undefined;
    try {
      await runMigrationsIn(tempDir);
      const portalPath = await seedPortal(tempDir);
      writeMcpServerConfig(configPath, tempDir, portalPath);
      handle = await startSseServer(configPath);
      await assertGoldenFixtureParity(handle.port);
    } finally {
      await handle?.stop();
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

// Test 2: real stdio over a subprocess pipe

Deno.test({
  name: "[cutover] exactl mcp start (stdio) serves a real client over stdio matching the golden fixture",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase-163-cutover-stdio-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      await runMigrationsIn(tempDir);
      const portalPath = await seedPortal(tempDir);
      writeMcpServerConfig(configPath, tempDir, portalPath);

      const checkedIn = JSON.parse(await Deno.readTextFile(GOLDEN_FIXTURE_PATH)) as IGoldenFixtureCapture;
      const transport = new StdioClientTransport({
        command: "deno",
        args: ["run", "--allow-all", MCP_SERVER_MAIN, "--transport", "stdio"],
        env: { ...Deno.env.toObject(), EXA_CONFIG_PATH: configPath, EXA_MCP_REAL_GIT: "1" },
      });
      const client = new Client({ name: "phase-163-cutover-stdio-client", version: "1.0.0" });
      try {
        await client.connect(transport);

        const toolsList = await client.request({ method: "tools/list", params: {} }, z.unknown());
        assertEquals(
          JSON.parse(JSON.stringify(toolsList)),
          checkedIn.toolsList.result,
          "tools/list over the real CLI-served stdio transport must match Step 1's golden fixture exactly",
        );

        for (const { category, toolName, args } of REPRESENTATIVE_TOOL_CALLS) {
          const callResult = await client.request(
            { method: "tools/call", params: { name: toolName, arguments: args } },
            z.unknown(),
          );
          const expected = toSdkCallToolResult(checkedIn.representativeToolCalls[category].result);
          assertEquals(
            JSON.parse(JSON.stringify(callResult)),
            JSON.parse(JSON.stringify(expected)),
            `representative tools/call for category '${category}' over stdio must match Step 1's golden fixture`,
          );
        }
      } finally {
        await client.close();
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

// Test 3: real Team daemon boot executes analyze-codebase's dynamic step

Deno.test({
  name:
    "[cutover] EXAIX_EDITION=team real daemon boot executes analyze-codebase.flow.yaml's dynamic step via a real DynamicStepExecutor",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase-163-cutover-daemon-" });
    const configPath = join(tempDir, "exa.config.toml");
    try {
      seedAnalyzeCodebaseWorkspace(tempDir);
      writeTeamDaemonConfig(configPath, tempDir, join(tempDir, "portal-repo"), join(tempDir, "recordings"));
      await bootRealDaemon(configPath, 6000, {
        extraEnv: { EXA_LLM_PROVIDER: "mock", EXAIX_EDITION: "team" },
        midFlight: () => writeAnalyzeCodebaseRequest(tempDir),
        afterInjectMs: 10000,
      });

      const completed = await readLastEvent(configPath, DYNAMIC_STEP_COMPLETED);
      assert(
        completed,
        "dynamic_step_completed must appear in the journal — the real analyze-codebase.flow.yaml's " +
          "execution_mode: dynamic step must run through DynamicStepExecutor on a real Team daemon boot",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

// Test 4: real config-driven auth over the CLI entry point

Deno.test({
  name:
    "[cutover] exactl mcp start --sse with mcp.require_auth=true (real config + MCP_AUTH_TOKEN env) rejects unauthenticated requests and accepts a valid bearer token",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase-163-cutover-auth-" });
    const configPath = join(tempDir, "exa.config.toml");
    const token = "phase-163-cutover-secret-token";
    let handle: IServerHandle | undefined;
    try {
      await runMigrationsIn(tempDir);
      const portalPath = await seedPortal(tempDir);
      writeMcpServerConfig(configPath, tempDir, portalPath, "[mcp]\nrequire_auth = true\n");
      handle = await startSseServer(configPath, { MCP_AUTH_TOKEN: token });

      const rpcBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
      const baseUrl = `http://localhost:${handle.port}/`;

      // No Authorization header → 401.
      const noAuth = await fetch(baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: rpcBody,
      });
      assertEquals(noAuth.status, 401, "an unauthenticated request must be rejected with 401");

      // Wrong bearer token → 401.
      const wrongAuth = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer wrong-token",
        },
        body: rpcBody,
      });
      assertEquals(wrongAuth.status, 401, "a request with the wrong bearer token must be rejected with 401");

      // Valid bearer token → the client connects and lists tools successfully.
      const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
        authProvider: { token: () => Promise.resolve(token) },
      });
      const client = new Client({ name: "phase-163-cutover-auth-client", version: "1.0.0" });
      try {
        await client.connect(transport);
        const toolsList = await client.request({ method: "tools/list", params: {} }, z.unknown());
        assertExists(toolsList, "a request with the valid bearer token must succeed and list tools");
      } finally {
        await client.close();
      }
    } finally {
      await handle?.stop();
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
