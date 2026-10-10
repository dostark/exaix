/**
 * @module CompatibleDaemonHelper
 * @path tests/integration/helpers/compatible_daemon.ts
 * @description Shared harness for daemon tests that drive the loopback openai-chat fixture. The fixture
 *   records every chat request body, so a test can assert the wire flags and replayed messages a real
 *   daemon sent. The helper also writes the compatible-profile config, builds a git-backed portal, and
 *   approves a plan through exactl, which the execution path requires.
 * @architectural-layer Test
 * @related-files [tests/integration/helpers/daemon_config.ts, tests/integration/openai_compatible_daemon_cutover_test.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService, ensureConfigDb, insertOverride, migrateConfigDb, seedConfigDb } from "@exaix/core/config";
import { Database } from "@db/sqlite";
import type { JSONValue } from "@exaix/core";
import { setupGitRepo } from "@exaix/git/testing";
import { daemonConfigSections } from "./daemon_config.ts";

/** One chat message as the fixture received it. */
export interface IFixtureMessage {
  role: string;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}

/** The chat-completion request body the fixture received, with the fields the cutover asserts on. */
export interface IFixtureBody {
  tools?: Array<{ function?: { name: string } }>;
  tool_choice?: string | { type: string; function?: { name: string } };
  parallel_tool_calls?: boolean;
  messages?: IFixtureMessage[];
}

/** A running loopback fixture. `bodies` holds every chat request body in arrival order. */
export interface ICompatibleFixture {
  port: number;
  bodies: IFixtureBody[];
  shutdown(): Promise<void>;
}

/** The live provider a daemon run calls. */
export type LiveProvider = "deepseek" | "anthropic";

/** The options that shape the compatible-profile daemon config. */
export interface ICompatibleConfigOptions {
  planningTools: boolean;
  nativeTools: boolean;
  /** Lines of the `[tools]` table. Empty leaves every key at its default. */
  toolsLines?: string[];
  maxCallsPerRound?: number;
  /** Adds the catalog service and the default binding that the Flow path resolves its provider through. */
  flowBinding?: boolean;
  /** Sends chat to the DeepSeek API through its profile instead of the loopback fixture. */
  live?: boolean;
  /** Names the live provider when `live` is set. Unset means DeepSeek. */
  liveProvider?: LiveProvider;
}

/** One trace-scoped journal row. */
export interface ITraceRow {
  action_type: string;
  trace_id: string | null;
  payload: string;
}

export const REPO_ROOT = join(import.meta.dirname!, "..", "..", "..");
export const FIXTURE_MODEL = "compat-fixture-v1";
/** The credential the local-test profile reads from its environment variable. */
export const FIXTURE_API_KEY = "local-fixture-key";
export const FIXTURE_API_KEY_ENV = "EXA_COMPAT_TEST_API_KEY";
/** The DeepSeek preset the live leg binds to: its model, its canonical catalog id, and its key variable. */
export const LIVE_MODEL = "deepseek-v4-pro";
export const LIVE_CANONICAL_MODEL = "deepseek/deepseek-v4-pro";
export const LIVE_KEY_ENV = "DEEPSEEK_API_KEY";
/** The Anthropic live leg's model. The Anthropic provider reads its key from ANTHROPIC_API_KEY. */
/** Defaults to Haiku 5.5. EXA_TEST_ANTHROPIC_MODEL picks another Claude model for one live run. */
export const LIVE_ANTHROPIC_MODEL = Deno.env.get("EXA_TEST_ANTHROPIC_MODEL") ?? "claude-haiku-5-5";
const FIXTURE_TIMEOUT_MS = 10000;
const LIVE_TIMEOUT_MS = 120000;
const EMBEDDING_DIMENSIONS = 768;

/** Starts the loopback fixture. `respond` gets the zero-based index of each chat request and its body. */
export function startCompatibleFixture(
  respond: (index: number, body: IFixtureBody) => Record<string, JSONValue>,
): ICompatibleFixture {
  const bodies: IFixtureBody[] = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
    if (new URL(request.url).pathname === "/api/embed") {
      const embedding = await request.json() as { input?: string[] };
      return Response.json({ embeddings: (embedding.input ?? []).map(() => Array(EMBEDDING_DIMENSIONS).fill(0)) });
    }
    const body = await request.json() as IFixtureBody;
    const index = bodies.length;
    bodies.push(body);
    return Response.json(respond(index, body));
  });
  return {
    port: (server.addr as Deno.NetAddr).port,
    bodies,
    shutdown: () => server.shutdown(),
  };
}

/** A chat-completion response that carries a text answer. */
export function textCompletion(content: string): Record<string, JSONValue> {
  return {
    model: FIXTURE_MODEL,
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
  };
}

/** A chat-completion response that carries the given tool calls. */
export function toolCallCompletion(
  calls: Array<{ id: string; path: string; portal?: string }>,
): Record<string, JSONValue> {
  return {
    model: FIXTURE_MODEL,
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: "read_file",
            arguments: JSON.stringify(call.portal ? { path: call.path, portal: call.portal } : { path: call.path }),
          },
        })),
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
  };
}

/** The catalog service and default binding that route the Flow path to the loopback fixture. */
function fixtureBinding(port: number): string[] {
  return [
    "[catalog.services.compat-fixture]",
    'adapter = "openai-chat"',
    'profile = "local-test"',
    `endpoint = "http://127.0.0.1:${port}/v1/chat/completions"`,
    "allow_insecure_loopback = true",
    'transport = "local"',
    'interface = "api"',
    `serves = { "openai-chat/${FIXTURE_MODEL}" = "${FIXTURE_MODEL}" }`,
    "",
    `[catalog.models."openai-chat/${FIXTURE_MODEL}"]`,
    'model_provider = "openai-chat"',
    "",
    "[bindings.default]",
    'service = "compat-fixture"',
    `model = "openai-chat/${FIXTURE_MODEL}"`,
    "",
  ];
}

/** The default binding that routes the Flow path to the DeepSeek preset in the built-in catalog. */
function liveBinding(): string[] {
  return ["[bindings.default]", 'service = "deepseek"', `model = "${LIVE_CANONICAL_MODEL}"`, ""];
}

/** The compatible-profile lines. The fixture profile names its loopback endpoint. DeepSeek takes its profile default. */
function compatibleLines(port: number, model: string, live: boolean): string[] {
  return live ? ['profile = "deepseek"', `model = "${model}"`] : [
    'profile = "local-test"',
    `endpoint = "http://127.0.0.1:${port}/v1/chat/completions"`,
    `model = "${model}"`,
    "allow_insecure_loopback = true",
  ];
}

/** Writes the daemon config that selects the compatible local-test profile, or the DeepSeek profile when live. */
export function writeCompatibleConfig(
  configPath: string,
  root: string,
  port: number,
  portalDir: string,
  options: ICompatibleConfigOptions,
): void {
  const planning = options.planningTools
    ? [
      "[planning]",
      "tools_enabled = true",
      "max_tool_rounds = 2",
      "max_tool_result_tokens = 2000",
      ...(options.maxCallsPerRound !== undefined ? [`max_tool_calls_per_round = ${options.maxCallsPerRound}`] : []),
      "",
    ]
    : [];
  const tools = options.toolsLines?.length ? ["[tools]", ...options.toolsLines, ""] : [];
  const anthropic = options.live === true && options.liveProvider === "anthropic";
  if (anthropic && options.flowBinding) throw new Error("The Anthropic live leg has no Flow binding.");
  const model = anthropic ? LIVE_ANTHROPIC_MODEL : options.live ? LIVE_MODEL : FIXTURE_MODEL;
  const timeoutMs = options.live ? LIVE_TIMEOUT_MS : FIXTURE_TIMEOUT_MS;
  const binding = options.flowBinding ? (options.live ? liveBinding() : fixtureBinding(port)) : [];
  const lines = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    "timeout_ms = 30000",
    "",
    "[agents]",
    'default_model = "compat-agent"',
    "",
    "[models.compat-agent]",
    `provider = "${anthropic ? "anthropic" : "openai-chat"}"`,
    `model = "${model}"`,
    `timeout_ms = ${timeoutMs}`,
    "",
    ...(anthropic ? [] : ["[models.compat-agent.compatible]", ...compatibleLines(port, model, options.live === true)]),
    "",
    "[quality_gate]",
    "enabled = false",
    "",
    "[execution]",
    `native_tools_enabled = ${options.nativeTools}`,
    "",
    ...planning,
    ...tools,
    ...binding,
    "[memory.embedding]",
    'provider = "ollama"',
    'model = "nomic-embed-text"',
    `baseUrl = "http://127.0.0.1:${port}"`,
    "",
    "[[portals]]",
    'alias = "cutover-portal"',
    `target_path = "${portalDir}"`,
  ];
  Deno.writeTextFileSync(configPath, lines.join("\n"));
}

/** Seeds one Config DB override before the daemon boots, so the boot must read it through the adapter. */
export function seedConfigOverride(root: string, key: string, value: string): void {
  const db = new Database(ensureConfigDb(root));
  try {
    migrateConfigDb(db);
    seedConfigDb(db);
    insertOverride(db, key, value, "cli", "hot");
  } finally {
    db.close();
  }
}

/** Writes the portal's files, then makes them a committed git repository. */
export async function createPortal(portalDir: string, files: Record<string, string>): Promise<void> {
  await Deno.mkdir(portalDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const path = join(portalDir, name);
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, body);
  }
  await setupGitRepo(portalDir, { initialCommit: true });
  for (const args of [["add", "-A"], ["commit", "-m", "Add fixture files"]]) {
    const git = await new Deno.Command("git", { args, cwd: portalDir, stdout: "piped", stderr: "piped" }).output();
    assertEquals(git.code, 0, new TextDecoder().decode(git.stderr));
  }
}

/** Writes an agent blueprint that uses the compatible model with the given permitted tools. */
export async function writeCompatAgent(
  root: string,
  role: string,
  permittedTools: string[],
  modelRef: string = `openai-chat:${FIXTURE_MODEL}`,
): Promise<void> {
  const dir = join(root, "Blueprints", "Agents");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, `${role}.md`),
    [
      "---",
      `agent_role: "${role}"`,
      `name: "${role}"`,
      `model: "${modelRef}"`,
      "model_size: M",
      "characteristics: [fastest]",
      'capabilities: ["react"]',
      'created: "2026-10-10T00:00:00Z"',
      'created_by: "parallel-tool-round-cutover"',
      'version: "1.0.0"',
      'description: "Compatible-profile cutover fixture"',
      "default_skills: []",
      `permitted_tools: [${permittedTools.map((tool) => `"${tool}"`).join(", ")}]`,
      "---",
      "Read the requested files and report what they contain.",
      "",
    ].join("\n"),
  );
}

/** Writes a planning request for the compatible agent against the fixture portal. */
export async function writePlanningRequest(root: string, traceId: string, subject: string): Promise<void> {
  const dir = join(root, "Workspace", "Requests");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, `r-${traceId.slice(0, 8)}.md`),
    [
      "---",
      `trace_id: "${traceId}"`,
      `created: "${new Date().toISOString()}"`,
      "status: pending",
      "priority: normal",
      "agent_role: compat-agent",
      "portal: cutover-portal",
      "source: cli",
      'created_by: "test@example.com"',
      `subject: "${subject}"`,
      "---",
      "",
      "# Request",
      "",
      "Call read_file for src/a.ts, src/b.ts and src/c.ts in one response, then produce a plan.",
      "",
    ].join("\n"),
  );
}

/** The first review plan id in `plansDir`, or undefined before the daemon writes one. */
export function firstPlanId(plansDir: string): string | undefined {
  try {
    const plan = [...Deno.readDirSync(plansDir)].find((entry) => entry.isFile && entry.name.endsWith(".md"));
    return plan?.name.slice(0, -3);
  } catch {
    // The daemon creates the plans directory after it receives the request.
    return undefined;
  }
}

/** Approves a plan through exactl. Execution starts only after approval. */
export async function approvePlan(configPath: string, planId: string): Promise<void> {
  const approval = await new Deno.Command("deno", {
    args: ["run", "--allow-all", join(REPO_ROOT, "apps", "exactl", "main.ts"), "plan", "approve", planId],
    env: { EXA_CONFIG_PATH: configPath },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(
    approval.code,
    0,
    new TextDecoder().decode(approval.stderr) || new TextDecoder().decode(approval.stdout),
  );
}

/** The trace-scoped journal rows, oldest first. */
export async function readTraceRows(configPath: string, traceId: string): Promise<ITraceRow[]> {
  const db = new DatabaseService(new ConfigService(configPath).getAll());
  try {
    return await db.preparedAll<ITraceRow>(
      "SELECT action_type, trace_id, payload FROM activity WHERE trace_id = ? ORDER BY rowid ASC",
      [traceId],
    );
  } finally {
    await db.close();
  }
}

/** The payload of a row's action, parsed. */
export function payloadOf<T>(rows: ITraceRow[], action: string): T | undefined {
  const row = rows.find((candidate) => candidate.action_type === action);
  return row ? JSON.parse(row.payload) as T : undefined;
}
