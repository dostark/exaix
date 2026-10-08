/**
 * @module AdvancedFlowsCutoverTest
 * @path tests/scenario_framework/tests/integration/advanced_flows_cutover_test.ts
 * @description Verifies compiled-edition blueprint regression and mixed-model retry evidence on real daemons.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/helpers/advanced_flow_case.ts]
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withEnv } from "@exaix/testing";
import { runAdvancedFlowCase } from "../helpers/advanced_flow_case.ts";
import { runLegacyFlowCase } from "../helpers/legacy_flow_case.ts";
import { sha256 } from "../helpers/advanced_flow_evidence.ts";

const FRAMEWORK_HOME = new URL("../../", import.meta.url).pathname;
const OUTPUT_DIR = join(FRAMEWORK_HOME, "output", "phase205", "step9", "mixed-model");
const FIXTURE_KEY = "phase205-fixture-key";
const FIXTURE_MODEL = "compat-fixture-v1";
const JUDGE_TOKENS = 20;
const JUDGE_COMPLETION_TOKENS = 4;

interface IFixtureInput {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

Deno.test({
  name: "[phase205 cutover] compiled Solo retry loop uses an immutable gate overlay and mock body",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const overlayDir = await Deno.makeTempDir({ prefix: "phase205-overlay-" });
    const overlayPath = join(overlayDir, "gate.json");
    const overlay = {
      schema: 1 as const,
      bindings: {
        "flow:self-correcting-implementation/step:quality-gate": {
          service: "compat-fixture",
          model: "openai/compat-fixture-v1",
        },
      },
    };
    const overlayBytes = new TextEncoder().encode(JSON.stringify(overlay));
    await Deno.writeFile(overlayPath, overlayBytes);
    const inputs: IFixtureInput[] = [];
    const responses: string[] = [];
    for (const attempt of [0, 1]) {
      const recording = JSON.parse(
        await Deno.readTextFile(join(
          FRAMEWORK_HOME,
          "fixtures/mock_recordings/phase205/self_correcting",
          `self-correcting-implementation__submit__quality-gate--judge__${attempt}.json`,
        )),
      );
      responses.push(recording.response);
    }
    const fixture = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request) => {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") {
        return new Response("Invalid fixture route", { status: 404 });
      }
      if (request.headers.get("authorization") !== `Bearer ${FIXTURE_KEY}`) {
        return new Response("Invalid fixture key", { status: 401 });
      }
      const body = await request.json() as IFixtureInput;
      if (body.model !== FIXTURE_MODEL || !Array.isArray(body.messages) || inputs.length >= responses.length) {
        return new Response("Unexpected fixture call", { status: 400 });
      }
      inputs.push(body);
      return Response.json({
        model: FIXTURE_MODEL,
        choices: [{ message: { role: "assistant", content: responses[inputs.length - 1] }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: JUDGE_TOKENS,
          completion_tokens: JUDGE_COMPLETION_TOKENS,
          total_tokens: JUDGE_TOKENS + JUDGE_COMPLETION_TOKENS,
        },
      });
    });
    try {
      const port = (fixture.addr as Deno.NetAddr).port;
      assertEquals((await fetch(`http://127.0.0.1:${port}/invalid`)).status, 404);
      assertEquals((await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST" })).status, 401);
      let evidence: Awaited<ReturnType<typeof runAdvancedFlowCase>> | undefined;
      await withEnv({ EXA_COMPAT_TEST_API_KEY: FIXTURE_KEY }, async () => {
        evidence = await runAdvancedFlowCase({
          file: "self_correcting_implementation",
          scenarioId: "self-correcting-implementation",
          action: "passed",
          status: "planned",
          phaseStep: 5,
          evaluations: 2,
          iterations: 1,
          edition: "solo",
        }, {
          outputDir: OUTPUT_DIR,
          requestArgs: ["--overlay", overlayPath],
          mutateOverlay: overlayPath,
          judgeTokens: JUDGE_TOKENS,
          catalogToml: `
[catalog.models."mock/phase205-fixture"]
model_provider = "mock"
[catalog.services.mock]
adapter = "mock"
transport = "local"
interface = "api"
serves = { "mock/phase205-fixture" = "phase205-fixture" }
[catalog.models."openai/compat-fixture-v1"]
model_provider = "openai"
[catalog.services.compat-fixture]
adapter = "openai-chat"
profile = "local-test"
endpoint = "http://127.0.0.1:${port}/v1/chat/completions"
allow_insecure_loopback = true
transport = "local"
interface = "api"
key_env = "EXA_COMPAT_TEST_API_KEY"
serves = { "openai/compat-fixture-v1" = "compat-fixture-v1" }
[bindings]
default = { service = "mock", model = "mock/phase205-fixture" }
`,
        });
      });
      assert(evidence);
      assertEquals(inputs.length, 2);
      const firstPrompt = inputs[0].messages.map((message) => message.content).join("\n");
      const acceptedPrompt = inputs[1].messages.map((message) => message.content).join("\n");
      for (const value of ["IMPLEMENTATION V1", "TESTS V1"]) assertStringIncludes(firstPrompt, value);
      for (const value of ["IMPLEMENTATION V2", "TESTS V2"]) assertStringIncludes(acceptedPrompt, value);
      assert(!acceptedPrompt.includes("IMPLEMENTATION V1"));
      assert(!acceptedPrompt.includes("TESTS V1"));
      const resolved = evidence.activities.filter((row) => row.action_type === "binding.resolved").map((row) =>
        JSON.parse(row.payload)
      );
      assertEquals(resolved.map((entry) => entry.step_id).sort(), [
        "implement",
        "implement",
        "plan",
        "quality-gate",
        "quality-gate",
        "report",
        "write-tests",
        "write-tests",
      ]);
      assertEquals(
        resolved.filter((entry) => entry.step_id !== "quality-gate").map((entry) => entry.service),
        Array(6).fill("mock"),
      );
      const gateBinding = resolved.find((entry) => entry.step_id === "quality-gate");
      assertEquals(gateBinding.service, "compat-fixture");
      assertEquals(gateBinding.sources.service.layer, "run");
      assertEquals(evidence.locks.length, 1);
      assertEquals(evidence.locks[0].overlay_sha256, [await sha256(overlayBytes)]);
      assertEquals(evidence.locks[0].run_overlays, 1);
      assertEquals(evidence.runBindings.length, 1);
      assertEquals(evidence.runBindings[0].overlays, [{
        source_path: overlayPath,
        sha256: await sha256(overlayBytes),
        overlay,
      }]);
      assertEquals(JSON.parse(await Deno.readTextFile(overlayPath)), { schema: 1, bindings: {} });
      const generations = evidence.activities.filter((row) => row.action_type === "llm.call.completed");
      assertEquals(generations.length, 9);
      assertEquals(generations.filter((row) => row.prompt_tokens === JUDGE_TOKENS).length, 2);
      assertEquals(generations.filter((row) => row.prompt_tokens === 100).length, 7);
      const reportPrompts = evidence.activities.filter((row) => row.action_type === "agent.prompt_debug_dump").map((
        row,
      ) => JSON.parse(row.payload).full_prompt as string);
      assert(
        reportPrompts.some((prompt) => prompt.includes("IMPLEMENTATION V2") && prompt.includes("TESTS V2")),
        "report consumes the accepted retry outputs",
      );
      await Deno.writeTextFile(join(OUTPUT_DIR, "fixture-http-inputs.json"), JSON.stringify(inputs, null, 2));
      await Deno.writeTextFile(join(OUTPUT_DIR, "submitted-overlay.json"), new TextDecoder().decode(overlayBytes));
    } finally {
      await fixture.shutdown();
      await Deno.remove(overlayDir, { recursive: true });
    }
  },
});

for (
  const [scenarioId, edition, calls] of [
    ["migration_planning", "solo", 9],
    ["security_audit", "solo", 8],
    ["analyze-codebase", "team", 2],
    ["api_design", "solo", 8],
    ["feature_development", "solo", 0],
    ["dogfood_context", "solo", 1],
    ["pr_review", "solo", 8],
    ["dogfood_loop", "solo", 0],
    ["test_generation", "solo", 8],
    ["onboarding_docs", "solo", 8],
    ["bug_investigation", "solo", 7],
    ["refactoring", "solo", 0],
    ["api_documentation", "solo", 6],
  ] as const
) {
  Deno.test({
    name: `[phase205 cutover regression] ${scenarioId} compiled ${edition}`,
    ignore: Deno.env.get("CI") === "true",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      await runLegacyFlowCase(scenarioId, edition, calls);
    },
  });
}
