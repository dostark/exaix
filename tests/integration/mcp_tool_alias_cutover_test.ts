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

import { DEFAULT_MEMORY_PATH, DEFAULT_PROJECTS_MEMORY_PATH } from "@exaix/shared";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { z } from "zod";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ConfigService } from "@exaix/core/config";
import type { JSONValue } from "@exaix/core/types";
import { DatabaseService } from "@exaix/storage-sqlite";
import { setupGitRepo } from "@exaix/git/testing";
import {
  daemonConfigSections,
  daemonJournalHasAny,
  daemonJournalRowidWithText,
  type IDaemonExit,
  waitForDaemonEvent,
  watchChildExit,
} from "./helpers/daemon_config.ts";
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

interface IJournalRow {
  rowid: number;
  target: string | null;
  payload: string;
  trace_id: string;
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
  const knowledgeDir = join(root, DEFAULT_MEMORY_PATH, DEFAULT_PROJECTS_MEMORY_PATH, OPEN_PORTAL);
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
      "SELECT rowid, target, payload, trace_id FROM activity WHERE action_type = ? ORDER BY rowid ASC",
      [actionType],
    );
  } finally {
    await db.close();
  }
}

/** Journal writes go through one FIFO queue, in the order the server logs them. A sentinel call is a
 *  registered tool call against a portal that does not exist. Its handler row carries a unique marker and
 *  marks the queue position. Every row before that position is then in the journal. The sentinel's own
 *  rows are excluded from later reads, so the counts under test stay exact. The server must be alive. */
class JournalReader {
  private readonly sentinelRowids = new Set<number>();

  constructor(private readonly configPath: string) {}

  async flush(client: Client, exited: Promise<IDaemonExit>): Promise<void> {
    const marker = `journal-flush-${crypto.randomUUID()}`;
    await callTool(client, "read_file", { portal: marker, agent_role: AGENT_ROLE, path: "notes.txt" });
    let handler: number | undefined;
    await waitForDaemonEvent(
      () => {
        handler = daemonJournalRowidWithText(this.configPath, "mcp.tool.executed", marker);
        return handler !== undefined;
      },
      exited,
      "the journal to flush the sentinel call",
    );
    if (handler === undefined) throw new Error("the sentinel handler row must exist once the wait resolves");
    // The handler row and the server-level row written right after it both belong to the sentinel.
    this.sentinelRowids.add(handler);
    this.sentinelRowids.add(handler + 1);
  }

  async rows(actionType: string): Promise<IJournalRow[]> {
    return (await journalRows(this.configPath, actionType)).filter((row) => !this.sentinelRowids.has(row.rowid));
  }
}

/** Tool names with a server-level `mcp.tool.executed` row, i.e. calls a handler actually ran. */
function executedToolsIn(rows: IJournalRow[]): string[] {
  return rows.filter((row) => Object.hasOwn(JSON.parse(row.payload), "has_result")).map((row) => row.target ?? "");
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

async function withHttpClient(
  configPath: string,
  fn: (client: Client, port: number, exited: Promise<IDaemonExit>) => Promise<void>,
): Promise<void> {
  const port = getFreePort();
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", MCP_SERVER_MAIN, "--transport", "sse", "--port", String(port)],
    env: { EXA_CONFIG_PATH: configPath, EXA_MCP_REAL_GIT: "1", MCP_AUTH_TOKEN: AUTH_TOKEN },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  const exited = watchChildExit(proc);
  try {
    await waitForDaemonEvent(
      () => daemonJournalHasAny(configPath, ["mcp.http_server.started"]),
      exited,
      "the MCP server to bind its port",
    );
    const client = new Client({ name: "phase201-http-cutover", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/`), {
        authProvider: { token: () => Promise.resolve(AUTH_TOKEN) },
      }),
    );
    try {
      await fn(client, port, exited);
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

async function withStdioClient(
  configPath: string,
  fn: (client: Client, exited: Promise<IDaemonExit>) => Promise<void>,
): Promise<void> {
  const client = new Client({ name: "phase201-stdio-cutover", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "deno",
    args: ["run", "--allow-all", MCP_SERVER_MAIN, "--transport", "stdio"],
    env: { ...Deno.env.toObject(), EXA_CONFIG_PATH: configPath, EXA_MCP_REAL_GIT: "1" },
  });
  await client.connect(transport);
  // The SDK exposes no client-level close hook, so the transport's close callback is chained after connect.
  const exited = new Promise<IDaemonExit>((resolve) => {
    const previous = transport.onclose;
    transport.onclose = () => {
      previous?.();
      resolve({ code: null, stderrTail: "" });
    };
  });
  try {
    await fn(client, exited);
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
      const reader = new JournalReader(configPath);
      const readArgs = { portal: OPEN_PORTAL, agent_role: AGENT_ROLE, file_path: "notes.txt" };

      await withHttpClient(configPath, async (client, port, exited) => {
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

        const reads = await Promise.all([
          callTool(client, "Read", readArgs),
          callTool(client, "Read", {
            ...readArgs,
            __exaix_internal_alias_context: { traceId: "forged-trace", aliasPayload: {} },
          }),
        ]);
        for (const read of reads) {
          assert(replyText(read).includes(FILE_MARKER), `Read must return the file: ${replyText(read)}`);
        }
        assertEquals(
          await callTool(client, "Read", { ...readArgs, file_path: "missing.txt" }),
          REJECTED,
          "handler failure must be returned as an MCP tool error",
        );

        const denied = await callTool(client, "Write", {
          portal: READ_ONLY_PORTAL,
          agent_role: AGENT_ROLE,
          file_path: "blocked.txt",
          content: "must not be written",
        });
        assertEquals(denied, REJECTED);

        // Journal writes are batched. Flush them while the server is alive, then read them.
        await reader.flush(client, exited);
        const rewrites = await reader.rows("tool.alias.rewritten");
        const payloads = rewrites.map((row) => JSON.parse(row.payload) as Record<string, JSONValue>);
        assertEquals(payloads.map((p) => `${p.requestedName}->${p.canonicalName}:${p.entryPoint}`), [
          "Read->read_file:mcp",
          "Read->read_file:mcp",
          "Read->read_file:mcp",
          "Write->write_file:mcp",
        ]);
        assertEquals(payloads[0].renamedParams, [{ from: "file_path", to: "path" }]);
        assertEquals(
          executedToolsIn(await reader.rows("mcp.tool.executed")),
          ["read_file", "read_file", "read_file"],
          "the 401 and the denied write never execute",
        );
        const executionRows = await reader.rows("mcp.tool.executed");
        const serverExecutions = executionRows.filter((row) => Object.hasOwn(JSON.parse(row.payload), "has_result"));
        assertEquals(serverExecutions.length, 3, "MCPServer must journal all success and handler-error outcomes");
        const readRewriteTraceIds = rewrites.slice(0, 3).map((row) => row.trace_id).sort();
        const executionTraceIds = serverExecutions.map((row) => row.trace_id).sort();
        assertEquals(
          readRewriteTraceIds,
          executionTraceIds,
          "concurrent same-tool rewrites must share only their matching persisted execution traces",
        );
        assertEquals(new Set(readRewriteTraceIds).size, 3, "concurrent and failed calls must not share trace identity");
        assertEquals(
          readRewriteTraceIds.includes("forged-trace"),
          false,
          "client arguments cannot forge trace identity",
        );
        const deniedRows = await reader.rows("mcp.permission.denied");
        assertEquals(deniedRows.length, 1);
        assertEquals(
          rewrites[3].trace_id,
          deniedRows[0].trace_id,
          "denied call rewrite and refusal must share a trace",
        );
      });
      assertEquals(
        await Deno.stat(join(tempDir, READ_ONLY_PORTAL, "blocked.txt")).then(() => true).catch(() => false),
        false,
      );

      await withStdioClient(configPath, async (client, exited) => {
        assertEquals(await callTool(client, "Read", readArgs), REJECTED);
        const canonical = await callTool(client, "read_file", {
          portal: OPEN_PORTAL,
          agent_role: AGENT_ROLE,
          path: "notes.txt",
        });
        assert(replyText(canonical).includes(FILE_MARKER));
        await reader.flush(client, exited);
      });
      const stdioRewrites = await reader.rows("tool.alias.rewritten");
      assertEquals(stdioRewrites.length, 4, "stdio adds no rewrite for an unregistered name alias");
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
      const reader = new JournalReader(configPath);
      const base = { portal: OPEN_PORTAL, agent_role: AGENT_ROLE };

      const exercise = async (
        client: Client,
        exited: Promise<IDaemonExit>,
        expectedRewrites: number,
      ): Promise<void> => {
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

        // One parameter rewrite per {query} call. Flush the journal, then read it.
        await reader.flush(client, exited);
        const rewrites = await reader.rows("tool.alias.rewritten");
        const payloads = rewrites.map((row) => JSON.parse(row.payload) as Record<string, JSONValue>);
        assertEquals(payloads.length, expectedRewrites);
        for (const payload of payloads) {
          assertEquals(payload.canonicalName, "query_symbols");
          assertEquals(payload.renamedParams, [{ from: "query", to: "name" }]);
          assertEquals(payload.entryPoint, "mcp");
        }
        const executed = executedToolsIn(await reader.rows("mcp.tool.executed"));
        assertEquals(executed.filter((tool) => tool === "query_symbols").length, expectedRewrites * 2);
        assertEquals(executed.filter((tool) => tool !== "query_symbols"), [], "retired names never execute");
      };
      await withHttpClient(configPath, (client, _port, exited) => exercise(client, exited, 1));
      await withStdioClient(configPath, (client, exited) => exercise(client, exited, 2));
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
