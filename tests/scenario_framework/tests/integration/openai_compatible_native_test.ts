/**
 * @module OpenAiCompatibleNativeScenarioTest
 * @path tests/scenario_framework/tests/integration/openai_compatible_native_test.ts
 * @description Runs the `openai-compatible-native` scenario through the real scenario runner and daemon against a loopback HTTP fixture, then asserts the wire contract, journal correlation and artifacts.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/agent_flows/openai-compatible-native.yaml, tests/scenario_framework/fixtures/phase155/local-compatible.toml, tests/scenario_framework/runner/synthetic_runner.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withEnv } from "@exaix/testing";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX } from "@exaix/core";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const SCENARIO_PATH = "scenarios/agent_flows/openai-compatible-native.yaml";
const DYNAMIC_SCENARIO_PATH = "scenarios/agent_flows/openai-compatible-native-dynamic.yaml";
const DYNAMIC_CALL_IDS = ["compat-dyn-read-1", "compat-dyn-read-2"];
const DYNAMIC_PATHS = ["src/utils.ts", "src/models.ts"];
const FAILURE_SCENARIO_PATH = "scenarios/agent_flows/openai-compatible-native-failure.yaml";
const CAPTURE_ENV = "EXA_CAPTURE_FIXTURES_DIR";
const SENSITIVE_SENTINEL = "SENSITIVE_UPSTREAM_BODY_9f3a";
const FIXTURE_MODEL = "compat-fixture-v1";
const FIXTURE_KEY = "local-fixture-key";
const PLANNING_CALL_ID = "compat-planning-read-1";
const EXECUTION_CALL_ID = "compat-exec-read-1";
const PORTAL_MARKER_PATH = "src/utils.ts";
const REPORT_SUMMARY_HEADER = "### EXECUTION REPORT SUMMARY ###";

interface IFixtureRequestBody {
  tool_choice?: string;
  tools?: Array<{ type: string; function?: { name: string } }>;
  response_format?: { type: string };
  messages?: Array<{ role: string; tool_call_id?: string; content?: string }>;
}

interface IFixtureMessage {
  content: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}

interface IObservedRequest {
  body: IFixtureRequestBody;
  authorization: string | null;
}

interface IActivityRow {
  action_type: string;
  trace_id: string | null;
  payload: string;
  cost_usd: number | null;
}

function completion(message: IFixtureMessage, finishReason: string, promptTokens: number): Response {
  return Response.json({
    model: FIXTURE_MODEL,
    choices: [{ message: { role: "assistant", ...message }, finish_reason: finishReason }],
    usage: { prompt_tokens: promptTokens, completion_tokens: 10, total_tokens: promptTokens + 10 },
  });
}

function toolCall(id: string, path: string, portal?: string): IFixtureMessage {
  return {
    content: null,
    tool_calls: [{
      id,
      type: "function",
      function: { name: "read_file", arguments: JSON.stringify(portal ? { portal, path } : { path }) },
    }],
  };
}

function startFixture(observed: IObservedRequest[], rejectChat = false, dynamicFlow = false): Deno.HttpServer {
  return Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
    if (new URL(request.url).pathname === "/api/embed") {
      const embedding = await request.json() as { input?: string[] };
      return Response.json({ embeddings: (embedding.input ?? []).map(() => Array(768).fill(0)) });
    }
    const body = await request.json() as IFixtureRequestBody;
    observed.push({ body, authorization: request.headers.get("authorization") });
    if (rejectChat) {
      return Response.json({ error: { type: "invalid_request_error", message: SENSITIVE_SENTINEL } }, { status: 400 });
    }
    const messages = body.messages ?? [];
    const hasToolResult = messages.some((message) => message.role === "tool");
    if (dynamicFlow && !body.response_format) {
      const completedRounds = messages.filter((message) => message.role === "tool").length;
      if (completedRounds < DYNAMIC_CALL_IDS.length) {
        return completion(
          toolCall(DYNAMIC_CALL_IDS[completedRounds], DYNAMIC_PATHS[completedRounds], "todo-app"),
          "tool_calls",
          40,
        );
      }
      return completion({ content: "Both modules were read." }, "stop", 60);
    }
    if (body.response_format) {
      if (!dynamicFlow && body.tools?.length && !hasToolResult) {
        return completion(toolCall(PLANNING_CALL_ID, PORTAL_MARKER_PATH), "tool_calls", 50);
      }
      return completion(
        {
          content: JSON.stringify({
            title: "Compatible native scenario",
            description: "Read the portal utility module and report it.",
            steps: [{ step: 1, title: "Read utils", description: `Read ${PORTAL_MARKER_PATH} and report.` }],
          }),
        },
        "stop",
        60,
      );
    }
    if (messages[0]?.content?.includes(REPORT_SUMMARY_HEADER)) {
      return completion({ content: "Report: utility module read." }, "stop", 30);
    }
    if (!body.tools?.length || body.tool_choice === "none") {
      return completion({ content: "ok" }, "stop", 20);
    }
    if (!hasToolResult) {
      return completion(toolCall(EXECUTION_CALL_ID, PORTAL_MARKER_PATH), "tool_calls", 70);
    }
    return completion(
      {
        content: `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}utility module read through the native tool`,
      },
      "stop",
      80,
    );
  });
}

async function assertScenarioPassed(
  failedSteps: string,
  workspaceRoot: string,
  observed: IObservedRequest[],
): Promise<void> {
  if (failedSteps === "[]") return;
  const rows = await readActivity(join(workspaceRoot, "exa.config.toml"));
  const diagnostics = rows.filter((row) => /fail|error|denied|hitl/.test(row.action_type)).map((row) =>
    `${row.action_type} ${row.payload.slice(0, 300)}`
  );
  throw new Error(`${failedSteps}\n${diagnostics.join("\n")}\nfixture requests: ${observed.length}`);
}

async function readActivity(configPath: string): Promise<IActivityRow[]> {
  const db = new DatabaseService(new ConfigService(configPath).getAll());
  try {
    return await db.preparedAll<IActivityRow>(
      "SELECT action_type, trace_id, payload, cost_usd FROM activity ORDER BY rowid ASC",
      [],
    );
  } finally {
    await db.close();
  }
}

Deno.test({
  name: "[phase155] openai-compatible-native scenario runs request through execution on the real local route",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const workspaceRoot = await Deno.makeTempDir({ prefix: "phase155-scenario-ws-" });
    const outputDir = await Deno.makeTempDir({ prefix: "phase155-scenario-out-" });
    const observed: IObservedRequest[] = [];
    const fixture = startFixture(observed);
    const port = (fixture.addr as Deno.NetAddr).port;
    try {
      let run: Awaited<ReturnType<typeof runSyntheticScenario>> | undefined;
      await withEnv({ EXA_COMPAT_TEST_API_KEY: FIXTURE_KEY }, async () => {
        run = await runSyntheticScenario({
          frameworkHome: FRAMEWORK_HOME,
          scenarioPath: SCENARIO_PATH,
          workspaceRoot,
          outputDir,
          mode: ScenarioExecutionMode.AUTO,
          env: { EXA_COMPAT_FIXTURE_PORT: String(port) },
        });
      });
      assert(run);
      assert(run.manifest.steps.length > 0);
      const failed = run.manifest.steps.filter((step: { executionStatus: string }) =>
        step.executionStatus !== "passed"
      );
      assertEquals(failed.length, 0, JSON.stringify(failed));
      assertEquals(run.manifest.outcome, "success");

      assert(observed.length >= 4, `fixture saw ${observed.length} requests`);
      assertEquals(observed.every((entry) => entry.authorization === `Bearer ${FIXTURE_KEY}`), true);
      const planningFirst = observed.find((entry) => entry.body.response_format);
      assert(planningFirst?.body.tools?.some((tool) => tool.function?.name === "read_file"));
      assertEquals(planningFirst?.body.tools?.some((tool) => tool.function?.name === "write_file"), false);
      const replays = observed.flatMap((entry) => (entry.body.messages ?? []).filter((m) => m.role === "tool"));
      assertEquals(
        new Set(replays.map((message) => message.tool_call_id)),
        new Set([PLANNING_CALL_ID, EXECUTION_CALL_ID]),
      );
      const execFirst = observed.find((entry) => !entry.body.response_format && entry.body.tools?.length);
      assertEquals(execFirst?.body.tool_choice, "required");
      const execReplay = observed.find((entry) =>
        !entry.body.response_format && (entry.body.messages ?? []).some((m) => m.tool_call_id === EXECUTION_CALL_ID)
      );
      assertEquals(execReplay?.body.tool_choice, "auto");

      const rows = await readActivity(join(workspaceRoot, "exa.config.toml"));
      const generations = rows.filter((row) => row.action_type === "llm.call.completed");
      assert(generations.length >= 4, JSON.stringify(rows.map((row) => row.action_type)));
      for (const generation of generations) {
        const payload = JSON.parse(generation.payload) as { model?: string; provider?: string; cost_status?: string };
        assertEquals(payload.model, FIXTURE_MODEL);
        assert(!String(payload.provider).startsWith("mock"), generation.payload);
        assertEquals(payload.cost_status, "unknown");
        assertEquals(generation.cost_usd, null);
      }
      const toolPhases = rows.filter((row) => row.action_type === "dynamic_tool_call").map((row) =>
        (JSON.parse(row.payload) as { phase?: string; tool: string }).phase ?? "execution"
      );
      assert(toolPhases.includes("planning"), toolPhases.join(","));
      assert(toolPhases.length >= 2, toolPhases.join(","));
      assert(rows.some((row) => row.action_type === "execution.completed"));
      assertEquals(rows.some((row) => row.action_type.endsWith(".failed")), false);
    } finally {
      await fixture.shutdown();
      await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
      await Deno.remove(outputDir, { recursive: true }).catch(() => {});
    }
  },
});

async function runFailureScenario(
  fixtureRejects: boolean,
  extraEnv: Record<string, string | null>,
): Promise<
  { observed: IObservedRequest[]; rows: IActivityRow[]; workspaceRoot: string; passed: boolean; failedSteps: string }
> {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "phase155-failure-ws-" });
  const outputDir = await Deno.makeTempDir({ prefix: "phase155-failure-out-" });
  const observed: IObservedRequest[] = [];
  const fixture = startFixture(observed, fixtureRejects);
  const port = (fixture.addr as Deno.NetAddr).port;
  try {
    let passed = false;
    let failedSteps = "";
    await withEnv({ EXA_COMPAT_TEST_API_KEY: FIXTURE_KEY, ...extraEnv }, async () => {
      const run = await runSyntheticScenario({
        frameworkHome: FRAMEWORK_HOME,
        scenarioPath: FAILURE_SCENARIO_PATH,
        workspaceRoot,
        outputDir,
        mode: ScenarioExecutionMode.AUTO,
        env: { EXA_COMPAT_FIXTURE_PORT: String(port) },
      });
      passed = run.manifest.outcome === "success";
      failedSteps = JSON.stringify(
        run.manifest.steps.filter((step: { executionStatus: string }) => step.executionStatus !== "passed"),
      );
    });
    const rows = await readActivity(join(workspaceRoot, "exa.config.toml"));
    return { observed, rows, workspaceRoot, passed, failedSteps };
  } finally {
    await fixture.shutdown();
    await Deno.remove(outputDir, { recursive: true }).catch(() => {});
  }
}

function terminalFailure(rows: IActivityRow[]): IActivityRow {
  const failures = rows.filter((row) => row.action_type === "request.failed");
  assertEquals(failures.length, 1, JSON.stringify(rows.map((row) => row.action_type)));
  return failures[0];
}

Deno.test({
  name:
    "[phase155] capture-enabled run fails closed at daemon start before any compatible call and writes no capture files",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const captureDir = await Deno.makeTempDir({ prefix: "phase155-capture-" });
    let workspaceRoot: string | undefined;
    try {
      const result = await runFailureScenario(false, { [CAPTURE_ENV]: captureDir });
      workspaceRoot = result.workspaceRoot;
      assertEquals(result.passed, false);
      const firstFailure = JSON.parse(result.failedSteps)[0] as { stepId: string; executionStatus: string };
      assertEquals(firstFailure.stepId, "start-daemon");
      assertEquals(firstFailure.executionStatus, "execution-failed");
      assertEquals(result.observed.length, 0);
      assertEquals([...Deno.readDirSync(captureDir)].length, 0);
      const sandboxCapture = join(workspaceRoot, "fixtures", "mock_recordings");
      const sandboxFiles = await Deno.stat(sandboxCapture).then(
        () => [...Deno.readDirSync(sandboxCapture)].length,
        () => 0,
      );
      assertEquals(sandboxFiles, 0);
    } finally {
      await Deno.remove(captureDir, { recursive: true }).catch(() => {});
      if (workspaceRoot) await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[phase155] capture-unset HTTP failure terminates with a redacted, correlated diagnostic",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    let workspaceRoot: string | undefined;
    try {
      const result = await runFailureScenario(true, { [CAPTURE_ENV]: null });
      workspaceRoot = result.workspaceRoot;
      assert(result.passed, `${result.failedSteps} ${JSON.stringify(result.rows.map((row) => row.action_type))}`);
      assert(result.observed.length >= 1, "the fixture must have received the rejected chat call");
      const terminal = terminalFailure(result.rows);
      assertEquals((JSON.parse(terminal.payload) as { error?: string }).error, "HTTP 400");
      const llmFailure = result.rows.find((row) => row.action_type === "llm.call.failed");
      assert(llmFailure, "the provider failure must be journaled");
      assertEquals(llmFailure.trace_id, terminal.trace_id);
      const journal = JSON.stringify(result.rows);
      assertEquals(journal.includes(SENSITIVE_SENTINEL), false);
      assertEquals(journal.includes(FIXTURE_KEY), false);
      assertEquals(result.rows.some((row) => row.action_type === "execution.completed"), false);
      const captureFiles = join(workspaceRoot, "fixtures", "mock_recordings");
      assertEquals(await Deno.stat(captureFiles).then(() => true, () => false), false);
    } finally {
      if (workspaceRoot) await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "[phase155] dynamic flow scenario runs two serial native rounds with one immutable prompt",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const workspaceRoot = await Deno.makeTempDir({ prefix: "phase155-dynamic-ws-" });
    const outputDir = await Deno.makeTempDir({ prefix: "phase155-dynamic-out-" });
    const observed: IObservedRequest[] = [];
    const fixture = startFixture(observed, false, true);
    const port = (fixture.addr as Deno.NetAddr).port;
    try {
      let failedSteps = "";
      await withEnv({ EXA_COMPAT_TEST_API_KEY: FIXTURE_KEY }, async () => {
        const run = await runSyntheticScenario({
          frameworkHome: FRAMEWORK_HOME,
          scenarioPath: DYNAMIC_SCENARIO_PATH,
          workspaceRoot,
          outputDir,
          mode: ScenarioExecutionMode.AUTO,
          env: { EXA_COMPAT_FIXTURE_PORT: String(port) },
        });
        assert(run.manifest.steps.length > 0);
        failedSteps = JSON.stringify(
          run.manifest.steps.filter((step: { executionStatus: string }) => step.executionStatus !== "passed"),
        );
      });
      await assertScenarioPassed(failedSteps, workspaceRoot, observed);
      const chatCalls = observed.filter((entry) => entry.body.messages?.length && !entry.body.response_format);
      assertEquals(chatCalls.length, 3, JSON.stringify(chatCalls.map((entry) => entry.body.tool_choice)));
      assertEquals(chatCalls.every((entry) => entry.authorization === `Bearer ${FIXTURE_KEY}`), true);
      assertEquals(chatCalls.map((entry) => entry.body.tool_choice), ["auto", "auto", "auto"]);
      const firstPrompt = chatCalls[0].body.messages?.[0]?.content;
      assert(firstPrompt && firstPrompt.length > 0);
      assertEquals(chatCalls.every((entry) => entry.body.messages?.[0]?.content === firstPrompt), true);
      const lastToolIds = (chatCalls[2].body.messages ?? []).filter((m) => m.role === "tool").map((m) =>
        m.tool_call_id
      );
      assertEquals(lastToolIds, DYNAMIC_CALL_IDS);
      const rows = await readActivity(join(workspaceRoot, "exa.config.toml"));
      const toolCalls = rows.filter((row) => row.action_type === "dynamic_tool_call");
      assertEquals(toolCalls.length, 2);
      const generations = rows.filter((row) => row.action_type === "llm.call.completed");
      assertEquals(generations.length, 3);
      for (const generation of generations) {
        assertEquals(generation.cost_usd, null);
        assertEquals((JSON.parse(generation.payload) as { cost_status?: string }).cost_status, "unknown");
      }
      assertEquals(rows.some((row) => row.action_type === "flow.failed"), false);
    } finally {
      await fixture.shutdown();
      await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
      await Deno.remove(outputDir, { recursive: true }).catch(() => {});
    }
  },
});
