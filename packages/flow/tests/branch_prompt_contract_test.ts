/**
 * @module BranchPromptContractTest
 * @path packages/flow/tests/branch_prompt_contract_test.ts
 * @description Traces branch JSON instructions through runner, adapter, and provider assembly.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { AgentRunner } from "@exaix/execution";
import { AgentComposerAdapter, FlowRunner } from "@exaix/flow";
import type { IRunner } from "@exaix/flow/agent_composer_adapter.ts";
import { MockProvider } from "@exaix/ai/providers.ts";
import { BRANCH_OUTPUT, BranchTestAgent, branchTestFlow } from "./helpers/branch_controls.ts";
import { GateTestLogger } from "./helpers/gate_controls.ts";
import { ModelBindingService, ProviderRegistry } from "@exaix/ai";
import type { IModelOptions } from "@exaix/ai/types.ts";
import { createMockConfig, createMockEventLogger, initTestDbService } from "@exaix/testing";
import { getDefaultModels, ZBranchDecision } from "@exaix/schemas";
import type { IBranchDecision } from "@exaix/flow";

Deno.test("[prompt] branch instruction replaces the flow Plan envelope and retains route metadata", async () => {
  const agent = new BranchTestAgent();
  await new FlowRunner({ agentExecutor: agent, eventLogger: new GateTestLogger() }).execute(branchTestFlow(), {
    userPrompt: "Classify",
  });
  const branch = agent.requests[0];
  assertEquals(branch.flowOutputKind, "branch-json");
  assertStringIncludes(branch.userPrompt, "Classify issue");
  assertStringIncludes(branch.userPrompt, "results.classify.data.category");
  assertStringIncludes(branch.userPrompt, '"default":"other"');
  assertEquals(branch.userPrompt.includes('"subject": "Flow Step Output"'), false);
  assertStringIncludes(agent.requests[1].userPrompt, '"subject": "Flow Step Output"');
});
Deno.test("[prompt] adapter carries branch-json into AgentRunner and preserves ordinary Plan instructions", async () => {
  const prompts: string[] = [];
  const provider = new MockProvider(`<thought>classified</thought><content>${BRANCH_OUTPUT}</content>`);
  const generate = provider.generate.bind(provider);
  provider.generate = (prompt, options) => {
    prompts.push(prompt);
    return generate(prompt, options);
  };
  const runner = new AgentRunner({ getSchemaInstructions: () => "PLAN_SCHEMA_SENTINEL" }, provider, {
    disableRetry: true,
  });
  const received: Array<Parameters<IRunner["run"]>[1]> = [];
  const run = runner.run.bind(runner);
  runner.run = (blueprint, request, skills) => {
    received.push(request);
    return run(blueprint, request, skills);
  };
  const adapter = new AgentComposerAdapter(runner, new URL("../../../Blueprints/Agents", import.meta.url).pathname);
  assertEquals(
    (await adapter.run("code-analyst", {
      userPrompt: "Classify",
      context: {},
      flowStepId: "classify",
      flowOutputKind: "branch-json",
    })).content,
    BRANCH_OUTPUT,
  );
  assertEquals(received[0].flowOutputKind, "branch-json");
  assertEquals(prompts[0].includes("PLAN_SCHEMA_SENTINEL"), false);
  assertStringIncludes(prompts[0], "classification JSON");
  await adapter.run("code-analyst", { userPrompt: "Ordinary task", context: {} });
  assertStringIncludes(prompts[1], "PLAN_SCHEMA_SENTINEL");
});

Deno.test("[prompt] companion binding preserves branch identity and forwards effort and thinking to its provider", async () => {
  const env = await initTestDbService();
  const previous = ProviderRegistry.getFactory("mock");
  const boundCalls: Array<{ model: string; prompt: string; options: IModelOptions }> = [];
  ProviderRegistry.register("mock", {
    create: (options) =>
      Promise.resolve({
        id: `mock-${options.model}`,
        callCapabilities: { profile: "mock", supportedEffortTiers: ["low", "medium", "high"], supportsThinking: true },
        generate: (prompt, callOptions) => {
          boundCalls.push({ model: options.model, prompt, options: callOptions ?? {} });
          return Promise.resolve({
            content: `<thought>classified</thought><content>${BRANCH_OUTPUT}</content>`,
            model: options.model,
            provider: "mock",
            cost_usd: 0,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          });
        },
      }),
  });
  try {
    const model = `mock/${getDefaultModels().mock}`;
    const config = createMockConfig(env.tempDir, {
      ai: { provider: "mock", model: "boot" },
      catalog: {
        models: {},
        services: {
          classification: { adapter: "mock", transport: "local", interface: "api", serves: { [model]: "classifier" } },
        },
      },
      bindings: {
        "flow:branch-routing/step:classify": { service: "classification", model, effort: "high", thinking: true },
      },
    });
    const bindingLog = createMockEventLogger();
    const service = new ModelBindingService({
      configSource: { get: () => config },
      db: env.db,
      logger: bindingLog,
      probe: { hasKey: () => true, hasOptIn: () => true },
    });
    const refs: Array<Parameters<ModelBindingService["providerFor"]>[1]> = [];
    const providerFor = service.providerFor.bind(service);
    service.providerFor = (snapshot, ref) => {
      refs.push(ref);
      return providerFor(snapshot, ref);
    };
    const runner = new AgentRunner(new MockProvider("<thought>ordinary</thought><content>Ordinary output</content>"), {
      disableRetry: true,
    });
    const adapter = new AgentComposerAdapter(
      runner,
      new URL("../../../Blueprints/Agents", import.meta.url).pathname,
      undefined,
      service,
    );
    const logger = new GateTestLogger();
    await new FlowRunner({ agentExecutor: adapter, bindingService: service, eventLogger: logger }).execute(
      branchTestFlow(),
      { userPrompt: "Classify", traceId: "branch-bound" },
    );
    assertEquals(refs.find((ref) => ref.stepId === "classify"), {
      flowId: "branch-routing",
      stepId: "classify",
      agentRole: "code-analyst",
      kind: "agent",
      nativeTools: false,
    });
    const classifierCalls = boundCalls.filter((call) => call.model === "classifier");
    assertEquals(classifierCalls.length, 1);
    assertEquals([classifierCalls[0].options.effort, classifierCalls[0].options.thinking], ["high", true]);
    assertStringIncludes(classifierCalls[0].prompt, "classification JSON");
    assertEquals(logger.events.find((entry) => entry.event === "flow.branch.decided")?.payload.chosen, "bug");
    const event = logger.events.find((entry) => entry.event === "flow.branch.decided")!.payload;
    const decision: IBranchDecision = ZBranchDecision.parse({ ...event, branchId: event.stepId });
    assertEquals(decision, {
      branchId: "classify",
      chosen: "bug",
      notTaken: ["feature", "other"],
      data: { category: "bug", items: [1, 2] },
    });
  } finally {
    if (previous) ProviderRegistry.register("mock", previous);
    await env.cleanup();
  }
});
