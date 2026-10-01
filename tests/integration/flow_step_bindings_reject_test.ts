/**
 * @module FlowStepBindingsRejectTest
 * @path tests/integration/flow_step_bindings_reject_test.ts
 * @description Step-6 coverage: a flow with two incompatible step bindings fails before the
 *   first LLM call with ALL issues reported at once, emits one binding.rejected event with
 *   the run trace, returns a failed IFlowResult, and makes zero provider generate calls.
 * @architectural-layer Services
 * @related-files [packages/ai/src/bindings/binding_validation.ts, packages/ai/src/bindings/model_binding_service.ts, packages/flow/src/flow_runner.ts]
 */

import { assertEquals } from "@std/assert";
import { FlowOutputFormat } from "@exaix/core";
import { type Config, ConfigSchema, FlowSchema } from "@exaix/schemas";
import { initTestDbService } from "@exaix/testing";
import { createBindingHarness } from "./helpers/flow_binding_harness.ts";

function configFor(root: string): Config {
  return ConfigSchema.parse({
    system: { root },
    paths: {},
    ai: { provider: "mock", model: "boot" },
    catalog: {
      models: {
        "mock/alpha": { model_provider: "mock" },
        "mock/beta": { model_provider: "mock" },
      },
      services: {
        // Both resolve fine, but each fails a validation-only endpoint rule.
        // No network probe happens. Alpha is plain HTTP and beta carries URL userinfo.
        alpha: {
          adapter: "mock",
          transport: "cloud",
          interface: "api",
          serves: { "mock/alpha": "alpha" },
          endpoint: "http://public.example.com/v1",
        },
        beta: {
          adapter: "mock",
          transport: "cloud",
          interface: "api",
          serves: { "mock/beta": "beta" },
          endpoint: "https://user:pass@public.example.com/v1",
        },
      },
    },
    bindings: {
      "flow:research/step:compose": { service: "alpha", model: "mock/alpha" },
      "flow:research/step:explore": { service: "beta", model: "mock/beta" },
    },
  });
}

const rejectFlow = FlowSchema.parse({
  id: "research",
  name: "Research",
  description: "Reject flow",
  version: "1.0.0",
  steps: [
    { id: "compose", name: "Compose", agent_role: "composer", dependsOn: [], input: { source: "request" } },
    { id: "explore", name: "Explore", agent_role: "explorer", dependsOn: ["compose"], input: { source: "request" } },
  ],
  output: { from: "explore", format: FlowOutputFormat.MARKDOWN },
  settings: { maxParallelism: 1, failFast: true, includeRequestCriteria: false },
});

Deno.test("a flow with two incompatible steps fails with all issues, one binding.rejected, and zero generates", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();
  try {
    const config = configFor(tempDir);
    const { factory, logger, runner } = await createBindingHarness({
      tempDir,
      db,
      configSource: { get: () => config },
    });
    const traceId = crypto.randomUUID();
    const result = await runner.execute(rejectFlow, { userPrompt: "Research", traceId });
    assertEquals(result.success, false);

    // Zero flow provider generate calls happened — validation rejected before any call.
    assertEquals(factory.calls, []);
    // Exactly one aggregated binding.rejected with the run trace and both issues.
    const rejected = logger.events.filter((event) => event.action === "binding.rejected");
    assertEquals(rejected.length, 1);
    assertEquals(rejected[0].traceId, traceId);
    const payload = rejected[0].payload as { issues?: Array<{ code: string; step_id?: string }> };
    assertEquals(payload.issues?.length, 2);
    const coded = new Map((payload.issues ?? []).map((entry) => [entry.step_id, entry.code]));
    assertEquals(coded.get("compose"), "endpoint_invalid");
    assertEquals(coded.get("explore"), "endpoint_invalid");
  } finally {
    await cleanup();
  }
});
