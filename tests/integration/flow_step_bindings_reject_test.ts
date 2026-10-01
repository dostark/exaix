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
import { join } from "@std/path";
import { type IModelProvider, ModelBindingService, ProviderRegistry } from "@exaix/ai";
import type { IProviderFactory, IResolvedProviderOptions } from "@exaix/ai";
import type { IGenerateResult } from "@exaix/ai/providers";
import { FlowOutputFormat, PricingTier, ProviderCostTier } from "@exaix/core";
import { AgentRunner } from "@exaix/execution";
import { AgentComposerAdapter, FlowRunner, type IFlowEventLogger } from "@exaix/flow";
import { type Config, ConfigSchema, FlowSchema } from "@exaix/schemas";
import { createMockEventLogger, initTestDbService } from "@exaix/testing";
import type { JSONValue } from "@exaix/core";

/** Records every generate call. The reject test asserts none happened. */
class RecordingFactory implements IProviderFactory {
  readonly calls: string[] = [];
  create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const model = options.model;
    return Promise.resolve({
      id: `p-${model}`,
      callCapabilities: { profile: "mock", supportedEffortTiers: [], supportsThinking: true },
      generate: (): Promise<IGenerateResult> => {
        this.calls.push(model);
        return Promise.resolve({
          content: `<thought>ok</thought><content>${model}</content>`,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model,
          provider: "mock",
          cost_usd: 0,
        });
      },
    });
  }
}

class FlowLog implements IFlowEventLogger {
  log(_action: string, _payload: Record<string, JSONValue | undefined>): void {}
}

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
  const factory = new RecordingFactory();
  ProviderRegistry.registerWithMetadata("mock", factory, {
    name: "mock",
    description: "recording mock",
    capabilities: ["chat"],
    costTier: ProviderCostTier.FREE,
    pricingTier: PricingTier.FREE,
    strengths: [],
  });
  try {
    const blueprints = join(tempDir, "Blueprints", "Agents");
    await Deno.mkdir(blueprints, { recursive: true });
    for (const role of ["composer", "explorer"]) {
      await Deno.writeTextFile(join(blueprints, `${role}.md`), `---\nagent_role: ${role}\n---\nYou are ${role}.`);
    }
    const logger = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => configFor(tempDir) },
      logger,
      db,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const boot: IModelProvider = {
      id: "boot",
      callCapabilities: { profile: "mock", supportedEffortTiers: [], supportsThinking: true },
      generate: (): Promise<IGenerateResult> =>
        Promise.resolve({
          content: "<thought>ok</thought><content>boot</content>",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: "boot",
          provider: "mock",
          cost_usd: 0,
        }),
    };
    const adapter = new AgentComposerAdapter(new AgentRunner(boot), blueprints, undefined, service);
    const runner = new FlowRunner({ agentExecutor: adapter, eventLogger: new FlowLog(), bindingService: service });

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
