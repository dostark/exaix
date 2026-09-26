/**
 * @module McpToolAliasCutoverTest
 * @path tests/integration/mcp_tool_alias_cutover_test.ts
 * @description Team-only cutover for MCP tool names over the real transports. A spawned
 *   `exaix-team/apps/mcp-server/main.ts` serves Streamable HTTP with bearer auth and, in a
 *   second subprocess, stdio. HTTP rewrites a general-purpose alias to its canonical tool with
 *   one journaled rewrite and keeps its auth and portal-permission guards. Stdio registers
 *   canonical names only. Both transports list canonical names, accept `query_symbols` with
 *   `{name}` or the legacy `{query}`, and reject retired native names and their variants.
 * @architectural-layer Test
 * @related-files [exaix-team/apps/mcp-server/main.ts, exaix-team/packages/mcp-server/server.ts, packages/mcp/server/mcp_tool_call_canonicalizer.ts, tests/integration/mcp_server_spec_compliance_cutover_test.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { z } from "zod";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ConfigService } from "@exaix/core/config";
import type { JSONValue } from "@exaix/core/types";
import { DatabaseService } from "@exaix/storage-sqlite";
import { setupGitRepo } from "@exaix/git/testing";
import { daemonConfigSections } from "./helpers/daemon_config.ts";
import { runMigrationsIn } from "./helpers/migrate_test_db.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const MCP_SERVER_MAIN = join(REPO_ROOT, "exaix-team", "apps", "mcp-server", "main.ts");
const OPEN_PORTAL = "AliasPortal";
const READ_ONLY_PORTAL = "ReadOnlyPortal";
const AGENT_ROLE = "phase201-cutover";
const AUTH_TOKEN = "phase201-cutover-token";
const FILE_MARKER = "EXAIX_P201_MCP_MARKER_9d2f";
const RETIRED_SYMBOL_NAMES = ["exaix_portal_symbols", "list_symbols", " QUERY_SYMBOLS ", "Query_Symbols"];
const SYMBOLS = [
  { name: "greet", kind: "function", file: "src/main.ts", signature: "function greet()", pageRankScore: 5 },
  { name: "Greeter", kind: "class", file: "src/main.ts", signature: "class Greeter", pageRankScore: 3 },
  { name: "HelperOptions", kind: "interface", file: "src/helper.ts", signature: "interface X", pageRankScore: 1 },
];
const REJECTED = "rejected";
const JOURNAL_POLL_MS = 100;
const JOURNAL_WAIT_MS = 5000;

interface IJournalRow {
  target: string | null;
  payload: string;
}

interface IToolCallReply {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string; data?: JSONValue }>;
  structuredContent?: JSONValue;
}

type CallOutcome = IToolCallReply | typeof REJECTED;

function getFreePort(): number {
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function waitForPort(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const conn = await Deno.connect({ port, hostname: "127.0.0.1" });
      conn.close();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, JOURNAL_POLL_MS));
    }
  }
  throw new Error(`server never listened on port ${port} within ${timeoutMs}ms`);
}

/** Two portals (one read-only), a readable marker file and a persisted symbol map. */
async function seedWorkspace(root: string): Promise<string> {
  await runMigrationsIn(root);
  const openPortal = join(root, OPEN_PORTAL);
  const readOnlyPortal = join(root, READ_ONLY_PORTAL);
  for (const portal of [openPortal, readOnlyPortal]) {
    await Deno.mkdir(portal, { recursive: true });
    await Deno.writeTextFile(join(portal, "notes.txt"), `${FILE_MARKER}\n`);
    await setupGitRepo(portal);
  }
  const knowledgeDir = join(root, "Memory", "Projects", OPEN_PORTAL);
  await Deno.mkdir(knowledgeDir, { recursive: true });
  await Deno.writeTextFile(
    join(knowledgeDir, "knowledge.json"),
    JSON.stringify({
      portal: OPEN_PORTAL,
      gatheredAt: new Date().toISOString(),
      version: 1,
      architectureOverview: "Symbols fixture.",
      layers: [],
      keyFiles: [],
      conventions: [],
      dependencies: [],
      techStack: { primaryLanguage: "typescript" },
      symbolMap: SYMBOLS,
      stats: { totalFiles: 2, totalDirectories: 1, extensionDistribution: { ".ts": 2 } },
      metadata: { durationMs: 1, mode: "standard", filesScanned: 2, filesRead: 2 },
    }),
  );
  const configPath = join(root, "exa.config.toml");
  await Deno.writeTextFile(
    configPath,
    [
      ...daemonConfigSections(root, ""),
      "",
      "[ai]",
      'provider = "mock"',
      'model = "test"',
      "",
      "[mcp]",
      "require_auth = true",
      "",
      "[[portals]]",
      `alias = "${OPEN_PORTAL}"`,
      `target_path = "${openPortal}"`,
      'agents_allowed = ["*"]',
      "",
      "[[portals]]",
      `alias = "${READ_ONLY_PORTAL}"`,
      `target_path = "${readOnlyPortal}"`,
      'agents_allowed = ["*"]',
      'operations = ["read"]',
      "",
    ].join("\n"),
  );
  return configPath;
}

async function journalRows(configPath: string, actionType: string): Promise<IJournalRow[]> {
  const db = new DatabaseService(new ConfigService(configPath).getAll());
  try {
    return await db.preparedAll<IJournalRow>(
      "SELECT target, payload FROM activity WHERE action_type = ? ORDER BY rowid ASC",
      [actionType],
    );
  } finally {
    await db.close();
  }
}

/** Journal writes flush asynchronously in the server subprocess. Polls until `ready` holds. */
async function settledRows(
  configPath: string,
  actionType: string,
  ready: (rows: IJournalRow[]) => boolean,
): Promise<IJournalRow[]> {
  const deadline = Date.now() + JOURNAL_WAIT_MS;
  let rows = await journalRows(configPath, actionType);
  while (!ready(rows) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, JOURNAL_POLL_MS));
    rows = await journalRows(configPath, actionType);
  }
  return rows;
}

/** Tool names with a server-level `mcp.tool.executed` row, i.e. calls a handler actually ran. */
function executedToolsIn(rows: IJournalRow[]): string[] {
  return rows.filter((row) => Object.hasOwn(JSON.parse(row.payload), "has_result")).map((row) => row.target ?? "");
}

async function executedTools(configPath: string, minimum = 0): Promise<string[]> {
  return executedToolsIn(
    await settledRows(configPath, "mcp.tool.executed", (rows) => executedToolsIn(rows).length >= minimum),
  );
}

async function callTool(client: Client, name: string, args: Record<string, JSONValue>): Promise<CallOutcome> {
  try {
    const reply = await client.request(
      { method: "tools/call", params: { name, arguments: args } },
      z.unknown(),
    ) as IToolCallReply;
    return reply.isError === true ? REJECTED : reply;
  } catch {
    return REJECTED;
  }
}

async function listedNames(client: Client): Promise<string[]> {
  const listed = await client.request({ method: "tools/list", params: {} }, z.unknown()) as {
    tools: Array<{ name: string }>;
  };
  return listed.tools.map((tool) => tool.name);
}

function replyText(outcome: CallOutcome): string {
  return outcome === REJECTED ? "" : JSON.stringify(outcome);
}

function symbolNames(outcome: CallOutcome): string[] {
  if (outcome === REJECTED) return [];
  const structured = outcome.structuredContent as { data?: JSONValue } | JSONValue | undefined;
  const fromStructured = structured && !Array.isArray(structured) && typeof structured === "object"
    ? (structured as { data?: JSONValue }).data
    : structured;
  const fromContent = outcome.content?.find((item) => Array.isArray(item.data))?.data;
  const data = Array.isArray(fromStructured) ? fromStructured : fromContent;
  return (Array.isArray(data) ? data : []).map((entry) => (entry as { name: string }).name);
}

async function withHttpClient(configPath: string, fn: (client: Client, port: number) => Promise<void>): Promise<void> {
  const port = getFreePort();
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", MCP_SERVER_MAIN, "--transport", "sse", "--port", String(port)],
    env: { EXA_CONFIG_PATH: configPath, EXA_MCP_REAL_GIT: "1", MCP_AUTH_TOKEN: AUTH_TOKEN },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  try {
    await waitForPort(port);
    const client = new Client({ name: "phase201-http-cutover", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/`), {
        authProvider: { token: () => Promise.resolve(AUTH_TOKEN) },
      }),
    );
    try {
      await fn(client, port);
    } finally {
      await client.close();
    }
  } finally {
    try {
      proc.kill("SIGTERM");
    } catch { /* already exited */ }
    await proc.status.catch(() => {});
  }
}

async function withStdioClient(configPath: string, fn: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ name: "phase201-stdio-cutover", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: "deno",
      args: ["run", "--allow-all", MCP_SERVER_MAIN, "--transport", "stdio"],
      env: { ...Deno.env.toObject(), EXA_CONFIG_PATH: configPath, EXA_MCP_REAL_GIT: "1" },
    }),
  );
  try {
    await fn(client);
  } finally {
    await client.close();
  }
}

Deno.test({
  name:
    "[mcp-cutover] CLI-served real HTTP executes Read {file_path} with one rewrite and preserves authentication/permission denial; real stdio rejects unregistered name aliases",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase201-mcp-alias-cutover-" });
    try {
      const configPath = await seedWorkspace(tempDir);
      const readArgs = { portal: OPEN_PORTAL, agent_role: AGENT_ROLE, file_path: "notes.txt" };

      await withHttpClient(configPath, async (client, port) => {
        const unauthenticated = await fetch(`http://localhost:${port}/`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "Read", arguments: readArgs },
          }),
        });
        await unauthenticated.body?.cancel();
        assertEquals(unauthenticated.status, 401);

        const read = await callTool(client, "Read", readArgs);
        assert(replyText(read).includes(FILE_MARKER), `Read must return the file: ${replyText(read)}`);

        const denied = await callTool(client, "Write", {
          portal: READ_ONLY_PORTAL,
          agent_role: AGENT_ROLE,
          file_path: "blocked.txt",
          content: "must not be written",
        });
        assertEquals(denied, REJECTED);

        // Journal writes are batched. Read them while the server is alive to flush them.
        const rewrites = await settledRows(configPath, "tool.alias.rewritten", (rows) => rows.length >= 2);
        const payloads = rewrites.map((row) => JSON.parse(row.payload) as Record<string, JSONValue>);
        assertEquals(payloads.map((p) => `${p.requestedName}->${p.canonicalName}:${p.entryPoint}`), [
          "Read->read_file:mcp",
          "Write->write_file:mcp",
        ]);
        assertEquals(payloads[0].renamedParams, [{ from: "file_path", to: "path" }]);
        assertEquals(await executedTools(configPath, 1), ["read_file"], "the 401 and the denied write never execute");
      });
      assertEquals(
        await Deno.stat(join(tempDir, READ_ONLY_PORTAL, "blocked.txt")).then(() => true).catch(() => false),
        false,
      );

      await withStdioClient(configPath, async (client) => {
        assertEquals(await callTool(client, "Read", readArgs), REJECTED);
        const canonical = await callTool(client, "read_file", {
          portal: OPEN_PORTAL,
          agent_role: AGENT_ROLE,
          path: "notes.txt",
        });
        assert(replyText(canonical).includes(FILE_MARKER));
      });
      const stdioRewrites = await journalRows(configPath, "tool.alias.rewritten");
      assertEquals(stdioRewrites.length, 2, "stdio adds no rewrite for an unregistered name alias");
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[mcp-cutover] real HTTP and stdio accept query_symbols {query}/{name}, expose canonical catalogs and reject obsolete names and native case/whitespace variants without execution",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "phase201-mcp-symbols-cutover-" });
    try {
      const configPath = await seedWorkspace(tempDir);
      const base = { portal: OPEN_PORTAL, agent_role: AGENT_ROLE };

      const exercise = async (client: Client, expectedRewrites: number): Promise<void> => {
        const names = await listedNames(client);
        assert(names.includes("query_symbols"), JSON.stringify(names));
        for (const retired of ["exaix_portal_symbols", "list_symbols"]) {
          assertEquals(names.includes(retired), false, retired);
        }
        const byName = symbolNames(await callTool(client, "query_symbols", { ...base, name: "greet" }));
        const byQuery = symbolNames(await callTool(client, "query_symbols", { ...base, query: "greet" }));
        assertEquals(byName, ["greet", "Greeter"]);
        assertEquals(byQuery, byName);
        for (const retired of RETIRED_SYMBOL_NAMES) {
          assertEquals(await callTool(client, retired, { ...base, name: "greet" }), REJECTED, retired);
        }

        // One parameter rewrite per {query} call. Read while the server is alive to flush it.
        const rewrites = await settledRows(
          configPath,
          "tool.alias.rewritten",
          (rows) => rows.length >= expectedRewrites,
        );
        const payloads = rewrites.map((row) => JSON.parse(row.payload) as Record<string, JSONValue>);
        assertEquals(payloads.length, expectedRewrites);
        for (const payload of payloads) {
          assertEquals(payload.canonicalName, "query_symbols");
          assertEquals(payload.renamedParams, [{ from: "query", to: "name" }]);
          assertEquals(payload.entryPoint, "mcp");
        }
        const executed = await executedTools(configPath, expectedRewrites * 2);
        assertEquals(executed.filter((tool) => tool === "query_symbols").length, expectedRewrites * 2);
        assertEquals(executed.filter((tool) => tool !== "query_symbols"), [], "retired names never execute");
      };
      await withHttpClient(configPath, (client) => exercise(client, 1));
      await withStdioClient(configPath, (client) => exercise(client, 2));
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
