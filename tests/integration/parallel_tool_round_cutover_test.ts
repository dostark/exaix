/**
 * @module ParallelToolRoundCutoverTest
 * @path tests/integration/parallel_tool_round_cutover_test.ts
 * @description Phase 202 Step 8. Each shipped parallel-tool-round path runs through a real daemon with
 *   real config. The loopback openai-chat fixture records every request body the daemon sends, so the
 *   wire flags and replayed messages are asserted as sent. Covered paths: compatible planning replay,
 *   a Config DB override of tools.parallel_calls, ReAct native execution through plan approval (off and
 *   cap), and the serial Flow singleton replay on the Team edition.
 * @architectural-layer Integration
 * @related-files [
 *   "tests/integration/helpers/compatible_daemon.ts",
 *   "tests/integration/helpers/daemon_config.ts",
 *   "packages/execution/src/planning_tool_loop.ts",
 *   "packages/execution/src/strategies/react_loop_strategy.ts",
 *   "packages/flow/src/dynamic_step_executor.ts"
 * ]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX } from "@exaix/core";
import { assertDaemonPidIsDead, bootRealDaemon, REQUEST_OUTCOME_ACTIONS } from "./helpers/daemon_config.ts";
import {
  approvePlan,
  createPortal,
  firstPlanId,
  FIXTURE_API_KEY,
  FIXTURE_API_KEY_ENV,
  type IFixtureBody,
  type ITraceRow,
  payloadOf,
  readTraceRows,
  seedConfigOverride,
  startCompatibleFixture,
  textCompletion,
  toolCallCompletion,
  writeCompatAgent,
  writeCompatibleConfig,
  writePlanningRequest,
} from "./helpers/compatible_daemon.ts";

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
const FILE_NAMES = ["a", "b", "c"] as const;
const PLANNING_CALL_IDS = ["PLAN_CALL_A", "PLAN_CALL_B", "PLAN_CALL_C"];
const REFUSAL = "tool call limit reached for this round; call skipped";
const CI_SKIP = Deno.env.get("CI") === "true";

interface IToolSummaryPayload {
  tool: string;
  phase?: string;
  resultSummary: string;
}

interface ITerminalPayload {
  rounds: number;
  toolCalls: number;
}

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

function toolMessages(body: IFixtureBody): Array<{ id: string | undefined; content: string }> {
  return (body.messages ?? []).filter((message) => message.role === "tool").map((message) => ({
    id: message.tool_call_id,
    content: String(message.content ?? ""),
  }));
}

function assistantToolCallIds(body: IFixtureBody): string[][] {
  return (body.messages ?? []).filter((message) => message.tool_calls?.length).map((message) =>
    (message.tool_calls ?? []).map((call) => call.id)
  );
}

function toolRows(rows: ITraceRow[]): IToolSummaryPayload[] {
  return rows.filter((row) => row.action_type === "dynamic_tool_call").map((row) =>
    JSON.parse(row.payload) as IToolSummaryPayload
  );
}

/** Boots a planning request against the compatible fixture. The optional DB override is seeded first. */
async function runCompatiblePlanning(
  dbOverride: { key: string; value: string } | undefined,
  toolsLines: string[],
): Promise<{ fixture: ReturnType<typeof startCompatibleFixture>; markers: string[]; rows: ITraceRow[] }> {
  const root = await Deno.makeTempDir({ prefix: "phase202-cutover-planning-" });
  const portal = join(root, "portal");
  const configPath = join(root, "exa.config.toml");
  const markers = FILE_NAMES.map((name) => marker(name.toUpperCase()));
  const fixture = startCompatibleFixture((index) =>
    index === 0
      ? toolCallCompletion(FILE_NAMES.map((name, i) => ({ id: PLANNING_CALL_IDS[i], path: `src/${name}.ts` })))
      : textCompletion(planContent(markers))
  );
  try {
    await createPortal(portal, portalFiles(markers));
    writeCompatibleConfig(configPath, root, fixture.port, portal, {
      planningTools: true,
      nativeTools: false,
      toolsLines,
    });
    if (dbOverride) seedConfigOverride(root, dbOverride.key, dbOverride.value);
    await writeCompatAgent(root, "compat-agent", ["read_file"]);
    const traceId = crypto.randomUUID();
    const boot = await bootRealDaemon(configPath, {
      extraEnv: { [FIXTURE_API_KEY_ENV]: FIXTURE_API_KEY },
      denoPermissions: COMPAT_PERMISSIONS,
      midFlight: () => writePlanningRequest(root, traceId, "Phase 202 compatible planning cutover"),
      waitForAfterInject: async () =>
        (await readTraceRows(configPath, traceId)).some((row) => REQUEST_OUTCOME_ACTIONS.includes(row.action_type)),
    });
    assertDaemonPidIsDead(boot.pid);
    return { fixture, markers, rows: await readTraceRows(configPath, traceId) };
  } finally {
    await fixture.shutdown();
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test({
  name:
    "[phase202-cutover] compatible planning replays a three-call round whole, with no parallel flag under the auto default",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runCompatiblePlanning(undefined, []);
    assertEquals(fixture.bodies.length, 2, "one exploration request and one final request");
    const [exploration, replay] = fixture.bodies;
    assertEquals(exploration.parallel_tool_calls, undefined, "auto sends no parallel flag");
    assertEquals(assistantToolCallIds(replay), [PLANNING_CALL_IDS]);
    assertEquals(toolMessages(replay).map((message) => message.id), PLANNING_CALL_IDS);
    toolMessages(replay).forEach((message, index) => assert(message.content.includes(markers[index])));
    const completed = payloadOf<ITerminalPayload>(rows, "planning.tools.completed");
    assertEquals(completed?.rounds, 2);
    assertEquals(completed?.toolCalls, 3);
  },
});

Deno.test({
  name:
    "[phase202-cutover] a Config DB override of tools.parallel_calls=off reaches the planning round over a TOML auto",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runCompatiblePlanning({ key: "tools.parallel_calls", value: "off" }, []);
    const [exploration, replay] = fixture.bodies;
    assertEquals(exploration.parallel_tool_calls, false, "the override reaches the request as one call per response");
    const completed = payloadOf<ITerminalPayload>(rows, "planning.tools.completed");
    assertEquals(completed?.rounds, 2);
    assertEquals(completed?.toolCalls, 1);
    const calls = toolRows(rows);
    assertEquals(calls.length, 3, "every position is journaled, executed or refused");
    assert(calls[0].resultSummary.includes(markers[0]), "the first call executes");
    assertEquals(calls.slice(1).map((call) => call.resultSummary.includes(REFUSAL)), [true, true]);
    assertEquals(toolMessages(replay).map((message) => message.id), PLANNING_CALL_IDS);
    assert(toolMessages(replay)[0].content.includes(markers[0]));
    assertEquals(toolMessages(replay).slice(1).map((message) => message.content.includes(REFUSAL)), [true, true]);
  },
});

/** Boots a ReAct execution through plan approval: a plan, a two-call execution round, and the final answer. */
async function runReactExecution(toolsLines: string[]): Promise<{
  fixture: ReturnType<typeof startCompatibleFixture>;
  markers: string[];
  rows: ITraceRow[];
}> {
  const root = await Deno.makeTempDir({ prefix: "phase202-cutover-react-" });
  const portal = join(root, "portal");
  const configPath = join(root, "exa.config.toml");
  const markers = FILE_NAMES.map((name) => marker(name.toUpperCase()));
  const fixture = startCompatibleFixture((index) => {
    if (index === 0) return textCompletion(planContent(markers));
    if (index === 1) {
      return toolCallCompletion([{ id: "REACT_CALL_A", path: "src/a.ts" }, { id: "REACT_CALL_B", path: "src/b.ts" }]);
    }
    return textCompletion(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`);
  });
  try {
    await createPortal(portal, portalFiles(markers));
    writeCompatibleConfig(configPath, root, fixture.port, portal, {
      planningTools: false,
      nativeTools: true,
      toolsLines,
    });
    await writeCompatAgent(root, "compat-agent", ["read_file"]);
    const traceId = crypto.randomUUID();
    const plansDir = join(root, "Workspace", "Plans");
    const boot = await bootRealDaemon(configPath, {
      extraEnv: { [FIXTURE_API_KEY_ENV]: FIXTURE_API_KEY },
      denoPermissions: COMPAT_PERMISSIONS,
      midFlight: async (daemon) => {
        await writePlanningRequest(root, traceId, "Phase 202 ReAct cutover");
        let planId: string | undefined;
        await daemon.until(() => {
          planId = firstPlanId(plansDir);
          return planId !== undefined;
        }, "the daemon to write a review plan");
        assert(planId, "the daemon must write a plan before approval");
        await approvePlan(configPath, planId);
      },
      waitForAfterInject: async () =>
        (await readTraceRows(configPath, traceId)).some((row) =>
          ["execution.completed", "execution.failed", "request.failed"].includes(row.action_type)
        ),
    });
    assertDaemonPidIsDead(boot.pid);
    return { fixture, markers, rows: await readTraceRows(configPath, traceId) };
  } finally {
    await fixture.shutdown();
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test({
  name:
    "[phase202-cutover] ReAct native under tools.parallel_calls=off executes one of two calls and sends the one-call flag",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runReactExecution(['parallel_calls = "off"']);
    const execution = fixture.bodies[1];
    assertEquals(execution.parallel_tool_calls, false, "the execution request asks for one call per response");
    const replay = fixture.bodies[2];
    assertEquals(toolMessages(replay).map((message) => message.id), ["REACT_CALL_A", "REACT_CALL_B"]);
    assert(toolMessages(replay)[0].content.includes(markers[0]), "the executed call carries its marker");
    assert(toolMessages(replay)[1].content.includes(REFUSAL), "the second call is refused, and replayed as refused");
    assertEquals(toolRows(rows).length, 1, "only the executed call is journaled as a tool call");
    assert(rows.some((row) => row.action_type === "execution.completed"));
  },
});

Deno.test({
  name:
    "[phase202-cutover] ReAct native under auto with tools.max_calls_per_turn=1 executes one call and sends no parallel flag",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { fixture, markers, rows } = await runReactExecution(["max_calls_per_turn = 1"]);
    const execution = fixture.bodies[1];
    assertEquals(execution.parallel_tool_calls, undefined, "auto sends no parallel flag");
    const replay = fixture.bodies[2];
    assert(toolMessages(replay)[0].content.includes(markers[0]));
    assert(toolMessages(replay)[1].content.includes(REFUSAL));
    assertEquals(toolRows(rows).length, 1);
    assert(rows.some((row) => row.action_type === "execution.completed"));
  },
});

Deno.test({
  name:
    "[phase202-cutover] serial Flow replays one dynamic-step call as one assistant call and one tool result, on the Team edition",
  ignore: CI_SKIP,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.makeTempDir({ prefix: "phase202-cutover-flow-" });
    const portal = join(root, "portal");
    const configPath = join(root, "exa.config.toml");
    const markers = [marker("FLOW")];
    const traceId = crypto.randomUUID();
    const fixture = startCompatibleFixture((index) =>
      index === 0
        ? toolCallCompletion([{ id: "FLOW_CALL_A", path: "src/a.ts", portal: "cutover-portal" }])
        : textCompletion(`${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}done`)
    );
    try {
      await createPortal(portal, portalFiles([markers[0], marker("B"), marker("C")]));
      writeCompatibleConfig(configPath, root, fixture.port, portal, {
        planningTools: false,
        nativeTools: true,
        flowBinding: true,
      });
      await writeCompatAgent(root, "compat-flow", ["read_file"]);
      await writeFlowProbe(root);
      const boot = await bootRealDaemon(configPath, {
        extraEnv: { EXAIX_EDITION: "team", [FIXTURE_API_KEY_ENV]: FIXTURE_API_KEY },
        denoPermissions: COMPAT_PERMISSIONS,
        midFlight: () => writeFlowRequest(root, traceId),
        waitForAfterInject: async () =>
          (await readTraceRows(configPath, traceId)).some((row) =>
            row.action_type === "dynamic_step_completed" || row.action_type === "flow.step.failed"
          ),
      });
      assertDaemonPidIsDead(boot.pid);
      const rows = await readTraceRows(configPath, traceId);
      assertEquals(fixture.bodies.length, 2, "one dynamic-step call and one follow-up");
      const followUp = fixture.bodies[1];
      assertEquals(assistantToolCallIds(followUp), [["FLOW_CALL_A"]], "the singleton round replays as one call");
      assertEquals(toolMessages(followUp).map((message) => message.id), ["FLOW_CALL_A"]);
      assert(rows.some((row) => row.action_type === "dynamic_step_completed"), "the dynamic step ran its executor");
    } finally {
      await fixture.shutdown();
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
});

/** Writes the one-step dynamic flow the Team edition runs through DynamicStepExecutor. */
async function writeFlowProbe(root: string): Promise<void> {
  const dir = join(root, "Blueprints", "Flows");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "compat-probe.flow.yaml"),
    [
      'id: "compat-probe"',
      'name: "Compatible singleton probe"',
      'description: "One dynamic step over the compatible profile, used by the Phase 202 Step 8 cutover."',
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
    join(dir, "compat-probe.md"),
    [
      "---",
      `trace_id: "${traceId}"`,
      `created: "${new Date().toISOString()}"`,
      'status: "pending"',
      'priority: "normal"',
      'source: "cli"',
      'created_by: "parallel-tool-round-cutover"',
      'flow: "compat-probe"',
      "---",
      "",
      "# Probe dynamic execution",
      "",
      "Read src/a.ts and report it.",
      "",
    ].join("\n"),
  );
}
