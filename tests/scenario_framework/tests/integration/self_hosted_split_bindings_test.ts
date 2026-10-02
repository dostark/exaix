/**
 * @module SelfHostedSplitBindingsTest
 * @path tests/scenario_framework/tests/integration/self_hosted_split_bindings_test.ts
 * @description Phase 203 Step 9 — the non-deferrable cutover. One real daemon run through the
 *   real scenario runner exercises a catalog preset, per-step bindings, an operator overlay, a
 *   bound judge, a pinned refusal and the `self-hosted` profile. The loopback fixture is an
 *   adversarial server that refuses `tool_choice` with HTTP 400, stricter than a real Ollama, and
 *   it records whether an `Authorization` header arrived.
 *
 *   Four runs: as authored, with an operator overlay at the scenario's own selector, with a
 *   `--bind` aimed at the pinned field, and with a `--bind` broader than the pin. A separate
 *   dynamic run proves that a bound self-hosted step sends its tools without `tool_choice`.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/agent_flows/self-hosted-split-bindings.yaml, tests/scenario_framework/runner/binding_layers.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { BindingIncompatibleError } from "@exaix/ai";
import { REACT_STATUS_COMPLETE, REACT_SUMMARY_PREFIX } from "@exaix/core";
import { withEnv } from "@exaix/testing";
import { readLockEntryEvidence } from "../../runner/provider_live_evidence.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";
import {
  type IFixtureRequestBody,
  type IObservedRequest,
  readRunActivity,
  resolvedServiceByTrace,
  startToolChoiceRefusingFixture,
} from "./synthetic_test_helpers.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const SCENARIO_PATH = "scenarios/agent_flows/self-hosted-split-bindings.yaml";
const OPERATOR_OVERLAY = join(FRAMEWORK_HOME, "fixtures", "phase203", "operator-explore-to-mock.json");
const FLOW_ID = "self-hosted-split";
const FIXTURE_SERVICE = "self-hosted-fixture";
const FIXTURE_MODEL = "fixture/compat-fixture-v1";
const MOCK_SERVICE = "mock";
const SELF_HOSTED_KEY_ENV = "EXA_COMPAT_SELF_HOSTED_API_KEY";
const COMPOSE_SELECTOR = `flow:${FLOW_ID}/step:compose`;
const EXPLORE_SELECTOR = `flow:${FLOW_ID}/step:explore-*`;
const COMPOSE_PIN_REASON = "capability-gate";
const FIXTURE_REPLY = `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}exploration complete`;

/** The daemon's binding lock for the run, read back as the evidence reader returns it. The
 *  run's trace comes from its own binding.resolved rows, one per flow step. */
async function lockEntries(workspaceRoot: string) {
  const rows = await readRunActivity(workspaceRoot);
  const traceId = rows.find((row) => row.action_type === "binding.resolved")?.trace_id;
  assert(traceId, "the run must journal binding.resolved");
  const lockPath = join(workspaceRoot, ".exa", "bindings", `${traceId}.lock.json`);
  const exists = await Deno.stat(lockPath).then(() => true).catch(() => false);
  assert(exists, `the daemon must write a binding lock at ${lockPath}`);
  return readLockEntryEvidence(lockPath, traceId);
}

/** One scenario run against the fixture. The self-hosted key stays unset, so no header is sent. */
async function runScenario(input: { port: number; operatorOverlays?: string[]; operatorBinds?: string[] }) {
  const workspaceRoot = await Deno.makeTempDir({ prefix: "phase203-self-hosted-ws-" });
  const outputDir = await Deno.makeTempDir({ prefix: "phase203-self-hosted-out-" });
  try {
    let run: Awaited<ReturnType<typeof runSyntheticScenario>> | undefined;
    await withEnv({ [SELF_HOSTED_KEY_ENV]: null }, async () => {
      run = await runSyntheticScenario({
        frameworkHome: FRAMEWORK_HOME,
        scenarioPath: SCENARIO_PATH,
        workspaceRoot,
        outputDir,
        mode: ScenarioExecutionMode.AUTO,
        env: { EXA_COMPAT_FIXTURE_PORT: String(input.port) },
        ...(input.operatorOverlays ? { operatorOverlays: input.operatorOverlays } : {}),
        ...(input.operatorBinds ? { operatorBinds: input.operatorBinds } : {}),
      });
    });
    assert(run, "runSyntheticScenario returned no result");
    return { run, workspaceRoot, outputDir };
  } catch (error) {
    await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
    await Deno.remove(outputDir, { recursive: true }).catch(() => {});
    throw error;
  }
}

Deno.test({
  name: "[phase203] self-hosted-split-bindings runs the cutover through a real daemon and a contract-enforcing fixture",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const observed: IObservedRequest[] = [];
    const fixture = startToolChoiceRefusingFixture(observed, FIXTURE_MODEL, FIXTURE_REPLY);
    const port = (fixture.addr as Deno.NetAddr).port;
    const workspaces: string[] = [];
    try {
      // Run 1: as authored. The preset's catalog supplies the fixture service.
      // The scenario layer routes the explore steps to it.
      // The pinned composer stays on the mock provider.
      const authored = await runScenario({ port });
      workspaces.push(authored.workspaceRoot);
      assertEquals(authored.run.manifest.outcome, "success", JSON.stringify(authored.run.manifest.steps));
      const authoredServices = [...(await resolvedServiceByTrace(authored.workspaceRoot)).values()][0];
      assertEquals(
        authoredServices,
        new Map([
          ["compose", MOCK_SERVICE],
          ["explore-one", FIXTURE_SERVICE],
          ["explore-two", FIXTURE_SERVICE],
          ["finalize", MOCK_SERVICE],
        ]),
      );
      assert(observed.length > 0, "the explore steps must reach the fixture");
      // The fixture refuses any request that carries tool_choice. A declared flow step makes one
      // generate call, so the branch stays unfired here. The strategy-level proof of the gate
      // itself is tests/integration/self_hosted_native_tool_choice_test.ts.
      assertEquals(observed.every((entry) => entry.body.tool_choice === undefined), true, "no tool_choice");
      assertEquals(observed.every((entry) => entry.authorization === null), true, "no credential is configured");

      // The run's evidence lists its overlays, the daemon's lock entries and the bound judge.
      const overlayRoles = (authored.run.bindingOverlays ?? []).map((overlay) => overlay.role).sort();
      assertEquals(overlayRoles, ["cell", "scenario"]);
      const entries = await lockEntries(authored.workspaceRoot);
      assertEquals(entries.find((entry) => entry.stepId === "compose")?.service, MOCK_SERVICE);
      assertEquals(entries.find((entry) => entry.stepId === "explore-one")?.service, FIXTURE_SERVICE);
      const judge = authored.run.judges?.[0];
      assertEquals(judge?.stepId, "grade-flow-plan");
      assertEquals(judge?.service, "claude-cli");
      assertEquals(judge?.sources.service?.selector, "judge");

      // Run 2: an operator overlay at the scenario's own selector moves the explore steps to the
      // mock provider. The later layer wins, no selector becomes ambiguous, and the fixture rests.
      const beforeOverride = observed.length;
      const overridden = await runScenario({ port, operatorOverlays: [OPERATOR_OVERLAY] });
      workspaces.push(overridden.workspaceRoot);
      assertEquals(overridden.run.manifest.outcome, "success");
      const overriddenServices = [...(await resolvedServiceByTrace(overridden.workspaceRoot)).values()][0];
      assertEquals(
        overriddenServices,
        new Map([
          ["compose", MOCK_SERVICE],
          ["explore-one", MOCK_SERVICE],
          ["explore-two", MOCK_SERVICE],
          ["finalize", MOCK_SERVICE],
        ]),
      );
      assertEquals(observed.length, beforeOverride, "an all-mock run must not call the fixture");
      assertEquals(
        (overridden.run.bindingOverlays ?? []).filter((overlay) => overlay.role === "operator").length,
        1,
      );

      // Run 3: a --bind aimed at the pinned field is refused before any step runs.
      const refusal = await assertRejects(
        () => runScenario({ port, operatorBinds: [`${COMPOSE_SELECTOR}=service=${FIXTURE_SERVICE}`] }),
        BindingIncompatibleError,
      );
      const issue = refusal.issues[0];
      assertEquals(issue.code, "pinned");
      assert(issue.detail.includes(COMPOSE_PIN_REASON), issue.detail);
      assert(issue.detail.includes(COMPOSE_SELECTOR), issue.detail);

      // Run 4: a --bind broader than the pin loses the pinned field.
      // The daemon keeps the pinned value, and the evidence records what the pin held.
      const broad = await runScenario({ port, operatorBinds: [`default=service=${FIXTURE_SERVICE}`] });
      workspaces.push(broad.workspaceRoot);
      assertEquals(broad.run.manifest.outcome, "success");
      const broadServices = [...(await resolvedServiceByTrace(broad.workspaceRoot)).values()][0];
      assertEquals(broadServices.get("compose"), MOCK_SERVICE, "the pin keeps compose on the mock provider");
      assertEquals(broad.run.pins?.map((pin) => [pin.field, pin.value, pin.skippedSelector]), [
        ["service", MOCK_SERVICE, "default"],
      ]);
      const broadEntries = await lockEntries(broad.workspaceRoot);
      assertEquals(broadEntries.find((entry) => entry.stepId === "compose")?.service, MOCK_SERVICE);
    } finally {
      await fixture.shutdown();
      for (const workspace of workspaces) {
        await Deno.remove(workspace, { recursive: true }).catch(() => {});
      }
    }
  },
});

Deno.test({
  name: "[phase203] the self-hosted fixture service declares no tool-choice support and no key",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const catalog = await Deno.readTextFile(join(FRAMEWORK_HOME, "..", "..", "configs", "eval-cells.toml"));
    assert(catalog.includes("supports_tool_choice = false"), "the fixture must declare no tool-choice support");
    assert(
      catalog.includes('requires_optin = "EXA_COMPAT_FIXTURE_PORT"'),
      "the fixture preset must only run when the fixture port exists",
    );
    // The selector the operator overlay targets and the pin protects must stay in step.
    const overlay = JSON.parse(await Deno.readTextFile(OPERATOR_OVERLAY)) as {
      bindings?: Record<string, { service?: string }>;
    };
    assertEquals(overlay.bindings?.[EXPLORE_SELECTOR]?.service, MOCK_SERVICE);
  },
});

const DYNAMIC_SCENARIO_PATH = "scenarios/agent_flows/self-hosted-native-dynamic.yaml";
const DYNAMIC_READ_PATHS = ["src/utils.ts", "src/models.ts"];

interface IDynamicRequestBody extends IFixtureRequestBody {
  messages?: Array<{ role: string }>;
}

/** An adversarial server that refuses tool_choice. A round with tools gets one read_file call.
 *  The dynamic step therefore completes only when no round carries tool_choice. */
function startDynamicFixture(observed: Array<{ body: IDynamicRequestBody }>): Deno.HttpServer {
  return Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request) => {
    const body = await request.json().catch(() => ({})) as IDynamicRequestBody;
    observed.push({ body });
    if (body.tool_choice !== undefined) {
      return Response.json(
        { error: { type: "invalid_request_error", message: "tool_choice is not supported" } },
        { status: 400 },
      );
    }
    const rounds = (body.messages ?? []).filter((message) => message.role === "tool").length;
    const message = body.tools?.length && rounds < DYNAMIC_READ_PATHS.length
      ? {
        content: null,
        tool_calls: [{
          id: `self-hosted-read-${rounds + 1}`,
          type: "function",
          function: {
            name: "read_file",
            arguments: JSON.stringify({ portal: "todo-app", path: DYNAMIC_READ_PATHS[rounds] }),
          },
        }],
      }
      : { content: "Both modules were read." };
    return Response.json({
      model: FIXTURE_MODEL.split("/")[1],
      choices: [{ message: { role: "assistant", ...message }, finish_reason: message.content ? "stop" : "tool_calls" }],
      usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
    });
  });
}

Deno.test({
  name: "[phase203.cutover] a real daemon self-hosted bound step sends non-empty tools without tool_choice",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const observed: Array<{ body: IDynamicRequestBody }> = [];
    const fixture = startDynamicFixture(observed);
    const port = (fixture.addr as Deno.NetAddr).port;
    const workspaceRoot = await Deno.makeTempDir({ prefix: "phase203-self-hosted-dyn-ws-" });
    const outputDir = await Deno.makeTempDir({ prefix: "phase203-self-hosted-dyn-out-" });
    try {
      let run: Awaited<ReturnType<typeof runSyntheticScenario>> | undefined;
      await withEnv({ [SELF_HOSTED_KEY_ENV]: null }, async () => {
        run = await runSyntheticScenario({
          frameworkHome: FRAMEWORK_HOME,
          scenarioPath: DYNAMIC_SCENARIO_PATH,
          workspaceRoot,
          outputDir,
          mode: ScenarioExecutionMode.AUTO,
          env: { EXA_COMPAT_FIXTURE_PORT: String(port) },
        });
      });
      assert(run);
      const failed = run.manifest.steps.filter((step: { executionStatus: string }) =>
        step.executionStatus !== "passed"
      );
      assertEquals(failed.length, 0, JSON.stringify(failed));

      const toolRounds = observed.filter((entry) => (entry.body.tools?.length ?? 0) > 0);
      assert(toolRounds.length >= DYNAMIC_READ_PATHS.length, `fixture saw ${toolRounds.length} tool-bearing rounds`);
      assert(
        toolRounds.every((entry) => entry.body.tools?.some((tool) => tool.function?.name === "read_file")),
        "every tool-bearing round must offer read_file",
      );
      assertEquals(observed.filter((entry) => entry.body.tool_choice !== undefined).length, 0);

      // The daemon bound the dynamic step to the self-hosted service, not to the config's provider.
      const services = [...(await resolvedServiceByTrace(workspaceRoot)).values()][0];
      assertEquals(services.get("explore"), FIXTURE_SERVICE);
    } finally {
      await fixture.shutdown();
      await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
      await Deno.remove(outputDir, { recursive: true }).catch(() => {});
    }
  },
});
