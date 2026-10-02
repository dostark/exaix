/**
 * @module FlowStepModelBindingsTest
 * @path tests/scenario_framework/tests/integration/flow_step_model_bindings_test.ts
 * @description Exercises per-step model bindings through one real daemon and loopback fixture.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scenarios/agent_flows/flow-step-model-bindings.yaml]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { encodeHex } from "@std/encoding/hex";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import { BindingLockSchema } from "@exaix/schemas";
import { withEnv } from "@exaix/testing";
import { monotonicNowMs } from "../../runner/clock.ts";
import { runSyntheticScenario } from "../../runner/synthetic_runner.ts";
import { ScenarioExecutionMode } from "../../schema/step_schema.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const SCENARIO_PATH = "scenarios/agent_flows/flow-step-model-bindings.yaml";
const FIXTURE_MODEL = "compat-fixture-v1";

interface IFixtureCall {
  at: number;
  body: { messages?: Array<{ content?: string }> };
}

interface IActivityRow {
  action_type: string;
  trace_id: string;
  payload: string;
}

async function readActivity(workspaceRoot: string): Promise<IActivityRow[]> {
  const db = new DatabaseService(new ConfigService(join(workspaceRoot, "exa.config.toml")).getAll());
  try {
    return await db.preparedAll<IActivityRow>(
      "SELECT action_type, trace_id, payload FROM activity ORDER BY rowid ASC",
      [],
    );
  } finally {
    await db.close();
  }
}

function callCountInWindow(
  calls: IFixtureCall[],
  run: Awaited<ReturnType<typeof runSyntheticScenario>>,
  submitId: string,
  awaitId: string,
): number {
  const start = run.stepOutcomes.find((step) => step.stepId === submitId)?.executionResult?.startedAt;
  const end = run.stepOutcomes.find((step) => step.stepId === awaitId)?.executionResult?.completedAt;
  assert(start && end, `missing scenario window ${submitId}..${awaitId}`);
  return calls.filter((call) => call.at >= Date.parse(start) && call.at <= Date.parse(end)).length;
}

function startFixture(calls: IFixtureCall[]): Deno.HttpServer {
  return Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request: Request) => {
    const body = await request.json() as IFixtureCall["body"];
    calls.push({ at: monotonicNowMs(), body });
    return Response.json({
      model: FIXTURE_MODEL,
      choices: [{ message: { role: "assistant", content: "Exploration complete." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
    });
  });
}

Deno.test({
  name: "[phase204] flow-step-model-bindings runs seven requests on one daemon",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const workspaceRoot = await Deno.makeTempDir({ prefix: "phase204-bindings-ws-" });
    const outputDir = await Deno.makeTempDir({ prefix: "phase204-bindings-out-" });
    const calls: IFixtureCall[] = [];
    const fixture = startFixture(calls);
    try {
      let run: Awaited<ReturnType<typeof runSyntheticScenario>> | undefined;
      await withEnv({ EXA_COMPAT_TEST_API_KEY: "phase204-fixture-key" }, async () => {
        run = await runSyntheticScenario({
          frameworkHome: FRAMEWORK_HOME,
          scenarioPath: SCENARIO_PATH,
          workspaceRoot,
          outputDir,
          mode: ScenarioExecutionMode.AUTO,
          env: { EXA_COMPAT_FIXTURE_PORT: String((fixture.addr as Deno.NetAddr).port) },
        });
      });
      assert(run);
      assertEquals(run.manifest.outcome, "success", JSON.stringify(run.manifest.steps));

      assert(callCountInWindow(calls, run, "request-config-fixture", "await-config-fixture") >= 2);
      assertEquals(callCountInWindow(calls, run, "request-config-mock", "await-config-mock"), 0);
      assert(callCountInWindow(calls, run, "request-broad-overlay", "await-broad-overlay") >= 3);
      assertEquals(callCountInWindow(calls, run, "request-pinned-refusal", "await-pinned-refusal"), 0);
      assertEquals(callCountInWindow(calls, run, "request-daemon-overlay", "await-daemon-overlay"), 0);
      assertEquals(callCountInWindow(calls, run, "request-locked-replay", "await-locked-replay"), 0);
      assertEquals(callCountInWindow(calls, run, "request-drifted-replay", "await-drifted-replay"), 0);

      const rows = await readActivity(workspaceRoot);
      const starts = rows.filter((row) => row.action_type === "daemon.started");
      const stops = rows.filter((row) => row.action_type === "daemon.stopped");
      assertEquals(starts.length, 1);
      assertEquals(stops.length, 1);
      const startedPid = (JSON.parse(starts[0].payload) as { pid?: number }).pid;
      const stoppedPid = (JSON.parse(stops[0].payload) as { pid?: number }).pid;
      assert(startedPid && stoppedPid);
      assertEquals(stoppedPid, startedPid);
      const created = rows.filter((row) =>
        row.action_type === "request.created" &&
        (JSON.parse(row.payload) as { via?: string }).via === "cli"
      );
      const traceIds = created.map((row) => row.trace_id);
      assertEquals(traceIds.length, 7, JSON.stringify(created));
      assertEquals(new Set(traceIds).size, 7);
      const successful = [0, 1, 2, 4, 5];
      const lockedEntries: Array<ReturnType<typeof BindingLockSchema.parse>["entries"]> = [];
      for (const index of successful) {
        const traceId = traceIds[index];
        const snapshots = rows.filter((row) =>
          row.trace_id === traceId && row.action_type === "binding.snapshot.created"
        );
        assertEquals(snapshots.length, 1, `trace ${traceId} has one lock`);
        const payload = JSON.parse(snapshots[0].payload) as {
          lock_path: string;
          lock_sha256: string;
          hosts: string[];
          env_ignored: boolean;
        };
        const fixtureHost = `127.0.0.1:${(fixture.addr as Deno.NetAddr).port}`;
        assertEquals(
          payload.hosts.includes(fixtureHost),
          index === 0 || index === 2,
          `run ${index} hosts ${JSON.stringify(payload.hosts)}`,
        );
        assertEquals(payload.env_ignored, true, "the daemon sets EXA_LLM_PROVIDER while an operator layer exists");
        const bytes = await Deno.readFile(payload.lock_path);
        const actualSha = encodeHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
        assertEquals(actualSha, payload.lock_sha256);
        const lock = BindingLockSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
        assertEquals(lock.trace_id, traceId);
        lockedEntries.push(lock.entries);
      }
      assertEquals(lockedEntries[3], lockedEntries[4], "--locked replay preserves the fifth run's resolution");
      const expectedExploreService = ["compat-fixture", "mock", "compat-fixture", "mock", "mock"];
      for (const [position, index] of successful.entries()) {
        const resolved = rows.filter((row) =>
          row.trace_id === traceIds[index] && row.action_type === "binding.resolved"
        )
          .map((row) =>
            JSON.parse(row.payload) as {
              step_id: string;
              service: string;
              sources: { service?: { layer: string; pin_kept?: { skipped_layer: string } } };
            }
          );
        assertEquals(
          new Set(resolved.map((entry) => entry.step_id)),
          new Set(["compose", "explore-one", "explore-two", "gate"]),
        );
        assertEquals(resolved.find((entry) => entry.step_id === "compose")?.service, "mock");
        assertEquals(
          resolved.find((entry) => entry.step_id === "explore-one")?.service,
          expectedExploreService[position],
        );
        assertEquals(
          resolved.find((entry) => entry.step_id === "explore-two")?.service,
          expectedExploreService[position],
        );
        assertEquals(
          resolved.find((entry) => entry.step_id === "gate")?.service,
          index === 2 ? "compat-fixture" : "mock",
        );
        if (index === 2) {
          assertEquals(
            resolved.find((entry) => entry.step_id === "compose")?.sources.service?.pin_kept?.skipped_layer,
            "run",
          );
        }
        if (index === 4) {
          assertEquals(resolved.find((entry) => entry.step_id === "explore-one")?.sources.service?.layer, "overlay");
        }
      }
      const driftTrace = traceIds[6];
      const driftRejection = rows.filter((row) =>
        row.trace_id === driftTrace && row.action_type === "binding.rejected"
      );
      assertEquals(driftRejection.length, 1);
      assertEquals(
        (JSON.parse(driftRejection[0].payload) as { issues: Array<{ code: string }> }).issues[0]?.code,
        "lock_mismatch",
      );
      assertEquals(
        rows.filter((row) => row.trace_id === driftTrace && row.action_type === "flow.step.started").length,
        0,
      );
      const rejectedTrace = traceIds[3];
      const rejection = rows.filter((row) => row.trace_id === rejectedTrace && row.action_type === "binding.rejected");
      assertEquals(rejection.length, 1);
      assertEquals((JSON.parse(rejection[0].payload) as { issues: Array<{ code: string }> }).issues[0]?.code, "pinned");
      assertEquals(
        rows.filter((row) => row.trace_id === rejectedTrace && row.action_type === "flow.step.started").length,
        0,
      );
      assertEquals(
        rows.filter((row) => row.trace_id === rejectedTrace && row.action_type === "binding.resolved").length,
        0,
      );
      assertEquals(
        rows.filter((row) => row.trace_id === rejectedTrace && row.action_type === "binding.snapshot.created").length,
        0,
      );
    } finally {
      await fixture.shutdown();
      await Deno.remove(workspaceRoot, { recursive: true }).catch(() => {});
      await Deno.remove(outputDir, { recursive: true }).catch(() => {});
    }
  },
});
