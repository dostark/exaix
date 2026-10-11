/**
 * @module ParallelRoundDaemonHelper
 * @path tests/integration/helpers/parallel_round_daemon.ts
 * @description Runners for the Phase 202 Step 8 daemon cutover. Each runner boots one real daemon with real config,
 *   through a portal, and returns the trace-scoped journal. In fixture mode the loopback openai-chat fixture serves a
 *   script and records every request body. In live mode chat goes to the DeepSeek API, the fixture serves only
 *   embeddings, and any chat request that reaches the fixture is recorded so the test can reject it.
 * @architectural-layer Test
 * @related-files [
 *   "tests/integration/helpers/compatible_daemon.ts",
 *   "tests/integration/helpers/daemon_config.ts",
 *   "tests/integration/parallel_tool_round_cutover_test.ts",
 *   "tests/integration/parallel_tool_round_live_test.ts"
 * ]
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import type { JSONValue } from "@exaix/core";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX } from "@exaix/core";
import {
  assertDaemonPidIsDead,
  bootRealDaemon,
  type IRunningDaemon,
  REQUEST_FAILURE_ACTIONS,
  REQUEST_OUTCOME_ACTIONS,
} from "./daemon_config.ts";
import {
  approvePlan,
  createPortal,
  firstPlanId,
  FIXTURE_API_KEY,
  FIXTURE_API_KEY_ENV,
  FIXTURE_MODEL,
  type IAgentIntent,
  type ICompatibleConfigOptions,
  type ICompatibleFixture,
  type IFixtureBody,
  type ITraceRow,
  LIVE_ANTHROPIC_MODEL,
  LIVE_MODEL,
  LIVE_OPENAI_MODEL,
  LIVE_OPENROUTER_MODEL,
  type LiveProvider,
  readTraceRows,
  seedConfigOverride,
  startCompatibleFixture,
  textCompletion,
  toolCallCompletion,
  writeCompatAgent,
  writeCompatibleConfig,
  writePlanningRequest,
} from "./compatible_daemon.ts";

/** The journal payload of a planning round's terminal row. */
export interface ITerminalPayload {
  rounds: number;
  toolCalls: number;
}

/** The journal payload of a failure row. Only the provider's error text and reason code are read. */
export interface IFailurePayload {
  error?: string;
  providerReasonCode?: string;
}

/** The journal payload of one tool call. `resultSummary` keeps the first characters of the result. */
export interface IToolSummaryPayload {
  tool: string;
  phase?: string;
  resultSummary: string;
}

/** A Config DB override seeded before the daemon boots. */
export interface IConfigOverride {
  key: string;
  value: string;
}

export interface IPlanningRoundOptions {
  live: boolean;
  /** The live provider when `live` is set. Unset means DeepSeek. */
  liveProvider?: LiveProvider;
  /** The OpenAI model when the live provider is OpenAI. Unset means LIVE_OPENAI_MODEL. */
  liveModel?: string;
  /** The effort and thinking the agent declares for this round. Unset keeps the blueprint default. */
  intent?: IAgentIntent;
  toolsLines: string[];
  dbOverride?: IConfigOverride;
  /** Overrides planning.max_tool_calls_per_round for this round. Unset keeps the shipped default. */
  maxCallsPerRound?: number;
  /** Overrides planning.max_tool_rounds for this round. Unset keeps the cutover's two rounds. */
  maxToolRounds?: number;
}

export interface IReactRoundOptions {
  live: boolean;
  /** The live provider when `live` is set. Unset means DeepSeek. */
  liveProvider?: LiveProvider;
  toolsLines: string[];
  /** Makes the scripted planning response empty, so the planning request fails and writes no plan. */
  planFails?: boolean;
}

export interface IFlowRoundOptions {
  live: boolean;
  /** The live provider when `live` is set. Unset means DeepSeek. */
  liveProvider?: LiveProvider;
  /** The environment the daemon boots with, for example the edition that enables dynamic steps. */
  extraEnv: Record<string, string>;
}

/** What a runner returns: the fixture, the markers in the portal files, and the trace-scoped journal rows. */
export interface IRoundRun {
  fixture: ICompatibleFixture;
  markers: string[];
  rows: ITraceRow[];
}

/** The paths and trace of one round, available to its setup and boot callbacks. */
interface IRoundContext {
  root: string;
  configPath: string;
  traceId: string;
}

/** Everything one round needs before its daemon boots. */
interface IRoundSetup {
  prefix: string;
  live: boolean;
  liveProvider?: LiveProvider;
  liveModel?: string;
  intent?: IAgentIntent;
  files: Record<string, string>;
  markers: string[];
  respond: (index: number, body: IFixtureBody) => Record<string, JSONValue>;
  config: Omit<ICompatibleConfigOptions, "live">;
  role: string;
  dbOverride?: IConfigOverride;
  extraEnv?: Record<string, string>;
  prepare?: (ctx: IRoundContext) => Promise<void>;
  midFlight: (daemon: IRunningDaemon, ctx: IRoundContext) => Promise<void>;
  done: (rows: ITraceRow[]) => boolean;
}

/** The compatible local-test profile needs loopback networking, the key variable, and config reads. */
const COMPAT_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
  "--allow-sys",
  "--allow-ffi",
  "--allow-net=127.0.0.1",
];
/** The DeepSeek profile calls its API host. The loopback fixture still serves embeddings on 127.0.0.1. */
const LIVE_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
  "--allow-sys",
  "--allow-ffi",
  "--allow-net=api.deepseek.com,127.0.0.1",
];
/** The Anthropic profile calls its API host. The loopback fixture still serves embeddings on 127.0.0.1. */
const ANTHROPIC_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
  "--allow-sys",
  "--allow-ffi",
  "--allow-net=api.anthropic.com,127.0.0.1",
];
/** The OpenAI profile calls its API host. The loopback fixture still serves embeddings on 127.0.0.1. */
const OPENAI_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
  "--allow-sys",
  "--allow-ffi",
  "--allow-net=api.openai.com,127.0.0.1",
];
/** The OpenRouter profile calls its API host. The loopback fixture still serves embeddings on 127.0.0.1. */
const OPENROUTER_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
  "--allow-sys",
  "--allow-ffi",
  "--allow-net=openrouter.ai,127.0.0.1",
];
const LIVE_UNEXPECTED_CHAT = "chat must not reach the loopback fixture in a live run";
const FLOW_ID = "compat-probe";
export const FILE_NAMES = ["a", "b", "c"] as const;
export const PLANNING_CALL_IDS = ["PLAN_CALL_A", "PLAN_CALL_B", "PLAN_CALL_C"];
export const REFUSAL = "tool call limit reached for this round; call skipped";
/** Journal rows that end a round in failure, including the provider call that failed inside it. */
const FAILURE_ROW_ACTIONS: readonly string[] = [...REQUEST_FAILURE_ACTIONS, "llm.call.failed", "execution.failed"];
const MAX_FAILURE_DETAIL = 240;

function marker(name: string): string {
  return `EXAIX_P202_${name}_${crypto.randomUUID().slice(0, 8)}`;
}

/** The portal files, one per planning call. Each file carries its own marker. */
function portalFiles(markers: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    FILE_NAMES.map((name, index) => [`src/${name}.ts`, `export const v = "${markers[index]}";\n`]),
  );
}

/** A plan that names every marker the round produced. */
function planContent(markers: readonly string[]): string {
  return JSON.stringify({
    title: "Parallel tool round cutover",
    description: `The round produced ${markers.join(" and ")}.`,
    steps: [{ step: 1, title: "Report the round", description: markers.join(" ") }],
  });
}

/** The tool calls the journal recorded, oldest first. A refused call is recorded with its refusal text. */
export function toolRows(rows: ITraceRow[]): IToolSummaryPayload[] {
  return rows.filter((row) => row.action_type === "dynamic_tool_call").map((row) =>
    JSON.parse(row.payload) as IToolSummaryPayload
  );
}

/** The action names of the journal rows, for failure messages that say where a live round stopped. */
export function journalActions(rows: ITraceRow[]): string {
  return rows.map((row) => row.action_type).join(", ");
}

/** The first failure row's action and error text, so a live failure names its cause. */
export function journalFailure(rows: ITraceRow[]): string {
  const row = rows.find((candidate) => FAILURE_ROW_ACTIONS.includes(candidate.action_type));
  if (!row) return "the journal holds no failure row";
  const payload = JSON.parse(row.payload) as IFailurePayload;
  const detail = `${row.action_type}: ${String(payload.error ?? "")} ${String(payload.providerReasonCode ?? "")}`;
  return detail.trim().slice(0, MAX_FAILURE_DETAIL);
}

/** The fixture's answer in a live run. A live chat request should never reach the fixture, and the test rejects one that does. */
function unexpectedChat(): Record<string, JSONValue> {
  return textCompletion(LIVE_UNEXPECTED_CHAT);
}

/** Chooses the scripted fixture response in fixture mode, and the unexpected-chat answer in live mode. */
function respondFor(
  live: boolean,
  script: (index: number, body: IFixtureBody) => Record<string, JSONValue>,
): (index: number, body: IFixtureBody) => Record<string, JSONValue> {
  return live ? unexpectedChat : script;
}

/** The environment a daemon boots with. The fixture key is set only where the fixture serves chat. */
function bootEnv(setup: IRoundSetup): Record<string, string> {
  const fixtureKey: Record<string, string> = setup.live ? {} : { [FIXTURE_API_KEY_ENV]: FIXTURE_API_KEY };
  return { ...fixtureKey, ...setup.extraEnv };
}

/** The agent's model reference: the fixture, DeepSeek, or the named direct live provider. */
function modelRefFor(setup: IRoundSetup): string {
  if (!setup.live) return `openai-chat:${FIXTURE_MODEL}`;
  if (setup.liveProvider === "anthropic") return `anthropic:${LIVE_ANTHROPIC_MODEL}`;
  if (setup.liveProvider === "openrouter") return `openrouter:${setup.liveModel ?? LIVE_OPENROUTER_MODEL}`;
  return setup.liveProvider === "openai"
    ? `openai:${setup.liveModel ?? LIVE_OPENAI_MODEL}`
    : `openai-chat:${LIVE_MODEL}`;
}

/** The child process permissions: loopback for the fixture, and the named live provider's host when live. */
function permissionsFor(setup: IRoundSetup): string[] {
  if (!setup.live) return COMPAT_PERMISSIONS;
  if (setup.liveProvider === "anthropic") return ANTHROPIC_PERMISSIONS;
  if (setup.liveProvider === "openrouter") return OPENROUTER_PERMISSIONS;
  return setup.liveProvider === "openai" ? OPENAI_PERMISSIONS : LIVE_PERMISSIONS;
}

/** Boots one real daemon for a round, then tears down the fixture and the temporary root. */
async function runRound(setup: IRoundSetup): Promise<IRoundRun> {
  const root = await Deno.makeTempDir({ prefix: setup.prefix });
  const portal = join(root, "portal");
  const configPath = join(root, "exa.config.toml");
  const fixture = startCompatibleFixture(setup.respond);
  try {
    await createPortal(portal, setup.files);
    writeCompatibleConfig(configPath, root, fixture.port, portal, {
      ...setup.config,
      live: setup.live,
      liveProvider: setup.liveProvider,
      liveModel: setup.liveModel,
    });
    if (setup.dbOverride) seedConfigOverride(root, setup.dbOverride.key, setup.dbOverride.value);
    await writeCompatAgent(root, setup.role, ["read_file"], modelRefFor(setup), setup.intent);
    const ctx: IRoundContext = { root, configPath, traceId: crypto.randomUUID() };
    if (setup.prepare) await setup.prepare(ctx);
    const boot = await bootRealDaemon(configPath, {
      extraEnv: bootEnv(setup),
      denoPermissions: permissionsFor(setup),
      midFlight: (daemon) => setup.midFlight(daemon, ctx),
      waitForAfterInject: async () => setup.done(await readTraceRows(configPath, ctx.traceId)),
    });
    assertDaemonPidIsDead(boot.pid);
    return { fixture, markers: setup.markers, rows: await readTraceRows(configPath, ctx.traceId) };
  } finally {
    await fixture.shutdown();
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

/** Boots a planning request. The optional Config DB override is seeded before the boot. */
export function runPlanningRound(options: IPlanningRoundOptions): Promise<IRoundRun> {
  const markers = FILE_NAMES.map((name) => marker(name.toUpperCase()));
  const script = (index: number): Record<string, JSONValue> =>
    index === 0
      ? toolCallCompletion(FILE_NAMES.map((name, i) => ({ id: PLANNING_CALL_IDS[i], path: `src/${name}.ts` })))
      : textCompletion(planContent(markers));
  return runRound({
    prefix: "phase202-cutover-planning-",
    live: options.live,
    liveProvider: options.liveProvider,
    liveModel: options.liveModel,
    intent: options.intent,
    files: portalFiles(markers),
    markers,
    respond: respondFor(options.live, script),
    config: {
      planningTools: true,
      nativeTools: false,
      toolsLines: options.toolsLines,
      maxCallsPerRound: options.maxCallsPerRound,
      maxToolRounds: options.maxToolRounds,
    },
    role: "compat-agent",
    dbOverride: options.dbOverride,
    midFlight: (_daemon, ctx) => writePlanningRequest(ctx.root, ctx.traceId, "Phase 202 compatible planning cutover"),
    done: (rows) => rows.some((row) => REQUEST_OUTCOME_ACTIONS.includes(row.action_type)),
  });
}

/** Boots a ReAct execution through plan approval: a plan, a two-call execution round, and the final answer. */
export function runReactRound(options: IReactRoundOptions): Promise<IRoundRun> {
  const markers = FILE_NAMES.map((name) => marker(name.toUpperCase()));
  const script = (index: number): Record<string, JSONValue> => {
    if (index === 0) return textCompletion(options.planFails === true ? "" : planContent(markers));
    if (index === 1) {
      return toolCallCompletion([{ id: "REACT_CALL_A", path: "src/a.ts" }, { id: "REACT_CALL_B", path: "src/b.ts" }]);
    }
    return textCompletion(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`);
  };
  return runRound({
    prefix: "phase202-cutover-react-",
    live: options.live,
    liveProvider: options.liveProvider,
    files: portalFiles(markers),
    markers,
    respond: respondFor(options.live, script),
    config: { planningTools: false, nativeTools: true, toolsLines: options.toolsLines },
    role: "compat-agent",
    midFlight: async (daemon, ctx) => {
      await writePlanningRequest(ctx.root, ctx.traceId, "Phase 202 ReAct cutover");
      const plansDir = join(ctx.root, "Workspace", "Plans");
      let planId: string | undefined;
      let rows: ITraceRow[] = [];
      // A failed planning request writes no plan, so the wait must also end on the failure row.
      await daemon.until(async () => {
        planId = firstPlanId(plansDir);
        rows = await readTraceRows(ctx.configPath, ctx.traceId);
        return planId !== undefined || rows.some((row) => REQUEST_FAILURE_ACTIONS.includes(row.action_type));
      }, "the daemon to write a review plan or fail the planning request");
      assert(planId, `the planning request wrote no plan: ${journalFailure(rows)}`);
      await approvePlan(ctx.configPath, planId);
    },
    done: (rows) =>
      rows.some((row) => ["execution.completed", "execution.failed", "request.failed"].includes(row.action_type)),
  });
}

/** Boots a dynamic Flow step on the Team edition. It reads one file, then answers. */
export function runFlowRound(options: IFlowRoundOptions): Promise<IRoundRun> {
  const markers = FILE_NAMES.map((name) => marker(name.toUpperCase()));
  const script = (index: number): Record<string, JSONValue> =>
    index === 0
      ? toolCallCompletion([{ id: "FLOW_CALL_A", path: "src/a.ts", portal: "cutover-portal" }])
      : textCompletion(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`);
  return runRound({
    prefix: "phase202-cutover-flow-",
    live: options.live,
    liveProvider: options.liveProvider,
    files: portalFiles(markers),
    markers,
    respond: respondFor(options.live, script),
    config: { planningTools: false, nativeTools: true, flowBinding: true, toolsLines: [] },
    role: "compat-flow",
    extraEnv: options.extraEnv,
    prepare: (ctx) => writeFlowProbe(ctx.root),
    midFlight: (_daemon, ctx) => writeFlowRequest(ctx.root, ctx.traceId),
    done: (rows) =>
      rows.some((row) => row.action_type === "dynamic_step_completed" || row.action_type === "flow.step.failed"),
  });
}

/** Writes the one-step dynamic flow the Team edition runs through DynamicStepExecutor. */
async function writeFlowProbe(root: string): Promise<void> {
  const dir = join(root, "Blueprints", "Flows");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, `${FLOW_ID}.flow.yaml`),
    [
      `id: "${FLOW_ID}"`,
      'name: "Compatible singleton probe"',
      'description: "One dynamic step, used by the Phase 202 Step 8 cutover."',
      'version: "1.0"',
      "steps:",
      "  - id: probe",
      '    name: "Probe dynamic execution"',
      "    agent_role: compat-flow",
      "    execution_mode: dynamic",
      "    permitted_tools:",
      "      - read_file",
      "    input:",
      "      source: request",
      "      transform: passthrough",
      "output:",
      "  from: probe",
      "  format: markdown",
      "settings:",
      "  maxParallelism: 1",
      "  failFast: true",
      "",
    ].join("\n"),
  );
}

async function writeFlowRequest(root: string, traceId: string): Promise<void> {
  const dir = join(root, "Workspace", "Requests");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, `${FLOW_ID}.md`),
    [
      "---",
      `trace_id: "${traceId}"`,
      `created: "${new Date().toISOString()}"`,
      'status: "pending"',
      'priority: "normal"',
      'source: "cli"',
      'created_by: "parallel-tool-round-cutover"',
      `flow: "${FLOW_ID}"`,
      "---",
      "",
      "# Probe dynamic execution",
      "",
      "Read src/a.ts from portal cutover-portal with read_file, then report its marker.",
      "",
    ].join("\n"),
  );
}
