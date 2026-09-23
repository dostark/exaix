/**
 * @module AgentRunnerPlanningToolsTest
 * @path packages/execution/tests/agent_runner_planning_tools_test.ts
 * @description Phase 199 Step 3 — AgentRunner.run reads `planning.*` live and, when
 *   enabled and every gate passes (native-tools provider, a configured+readable request
 *   portal, a registry factory), creates a per-run portal-rooted registry and drives
 *   PlanningToolLoop instead of a single executeWithRetry call. A gate failure while the
 *   flag is on is journaled as `planning.tools.skipped`; flag off/absent stays byte-
 *   identical to the pre-Phase-199 single-call path.
 * @architectural-layer Test
 * @related-files [
 *   "packages/execution/src/agent_runner.ts",
 *   "packages/execution/src/planning_tool_loop.ts",
 *   "packages/core/src/types/enums.ts"
 * ]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AgentRunner } from "@exaix/execution";
import type { IAgentRunnerConfig, IBlueprint, IParsedRequest } from "@exaix/execution";
import type { IApplicationContext, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import type { IModelOptions, IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import { makeGenerateResult } from "@exaix/testing";
import { DomainEventType } from "@exaix/core/events";
import {
  PLANNING_TOOL_CALL_OVERHEAD_TOKENS,
  PlanningToolsSkipReason,
  PricingTier,
  ProviderCostTier,
} from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type { LogMetadata } from "@exaix/core/types";

const NATIVE_PROVIDER_ID = "phase199-agent-runner-native-test";
const NON_NATIVE_PROVIDER_ID = "phase199-agent-runner-nonnative-test";

const blueprint: IBlueprint = { systemPrompt: "You are a test agent.", agentRole: "senior-coder" };

const stubTokenizer = {
  countTokens: (text: string) => Promise.resolve(Math.ceil(text.length / 4)),
  countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((t) => Math.ceil(t.length / 4))),
};

class ScriptedProvider implements IModelProvider {
  public readonly id: string;
  public calls: Array<{ prompt: string; options?: IModelOptions }> = [];
  private index = 0;
  constructor(id: string, private readonly responses: IGenerateResult[]) {
    this.id = id;
  }
  generate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    this.calls.push({ prompt, options });
    const response = this.responses[Math.min(this.index, this.responses.length - 1)];
    this.index++;
    return Promise.resolve(response);
  }
}

class StubToolRegistry implements IToolRegistry {
  public calls: Array<{ name: string; params: Record<string, JSONValue> }> = [];
  constructor(private readonly baseDir: string) {}
  getTools() {
    return [{ name: "read_file", description: "read a file", parameters: { type: "object" as const, properties: {} } }];
  }
  execute(name: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    this.calls.push({ name, params });
    return Promise.resolve({ success: true, data: { content: "marker-content" } });
  }
  getBaseDir(): string {
    return this.baseDir;
  }
}

interface ICapturedEvent {
  action: string;
  target: string | null;
  payload?: LogMetadata;
}

function createCapturingLogger(captured: ICapturedEvent[]): IEventLogger {
  const record = (action: string, target: string | null, payload?: LogMetadata): Promise<void> => {
    captured.push({ action, target, payload });
    return Promise.resolve();
  };
  const logger: IEventLogger = {
    log: (event) => record(event.action ?? "", event.target ?? null, event.payload),
    info: record,
    warn: record,
    error: record,
    fatal: record,
    debug: record,
    child: () => logger,
  };
  return logger;
}

function makePortalFixture(): { root: string; cleanup: () => void } {
  const root = Deno.makeTempDirSync({ prefix: "agent-runner-planning-tools-" });
  Deno.mkdirSync(join(root, "src"), { recursive: true });
  Deno.writeTextFileSync(join(root, "src", "a.ts"), "export const a = 1;");
  return { root, cleanup: () => Deno.removeSync(root, { recursive: true }) };
}

interface ITestPlanningConfig {
  tools_enabled: boolean;
  max_tool_rounds: number;
  max_tool_result_tokens: number;
}

interface ITestPortalConfig {
  alias: string;
  target_path: string;
  agents_allowed?: string[];
  operations?: string[];
}

function makeContext(
  state: { planning?: ITestPlanningConfig; portals?: ITestPortalConfig[] },
): IApplicationContext {
  return {
    config: {
      get: () => ({ planning: state.planning, portals: state.portals ?? [] }),
      getAll: () => ({ planning: state.planning, portals: state.portals ?? [] }),
    },
  } as never;
}

function registerProviders(): void {
  ProviderRegistry.registerWithMetadata(NATIVE_PROVIDER_ID, new MockProviderFactory(), {
    name: NATIVE_PROVIDER_ID,
    description: "Phase 199 AgentRunner planning-tools fixture provider (native tools)",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: true,
  });
  ProviderRegistry.registerWithMetadata(NON_NATIVE_PROVIDER_ID, new MockProviderFactory(), {
    name: NON_NATIVE_PROVIDER_ID,
    description: "Phase 199 AgentRunner planning-tools fixture provider (non-native)",
    capabilities: ["chat"],
    costTier: ProviderCostTier.PAID,
    pricingTier: PricingTier.MEDIUM,
    strengths: [],
    supportsNativeTools: false,
  });
}

const TWO_ROUND_PLANNING = { tools_enabled: true, max_tool_rounds: 2, max_tool_result_tokens: 2000 };

function twoRoundResponses(): IGenerateResult[] {
  return [
    makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "src/a.ts" } }] }),
    makeGenerateResult("<thought>t</thought><content>plan uses marker-content</content>"),
  ];
}

Deno.test("[AgentRunner planning tools] tools_enabled + native provider + readable portal + factory drives PlanningToolLoop and returns the final round's parsed content", async () => {
  registerProviders();
  const fixture = makePortalFixture();
  try {
    const provider = new ScriptedProvider(NATIVE_PROVIDER_ID, twoRoundResponses());
    const registry = new StubToolRegistry(fixture.root);
    const request: IParsedRequest = { userPrompt: "do it", context: {}, portal: "myportal", traceId: "trace-1" };
    const context = makeContext({
      planning: TWO_ROUND_PLANNING,
      portals: [{ alias: "myportal", target_path: fixture.root, agents_allowed: ["*"], operations: ["read"] }],
    });
    const runner = new AgentRunner(
      provider,
      {
        context,
        selectedModel: { provider: NATIVE_PROVIDER_ID, model: "test-model" },
        tokenizer: stubTokenizer,
        plannerToolRegistryFactory: { createToolRegistry: () => registry },
      } satisfies IAgentRunnerConfig,
    );

    const result = await runner.run(blueprint, request, undefined);

    assertEquals(result.content, "plan uses marker-content");
    assertEquals(provider.calls.length, 2);
    assertEquals(registry.calls.length, 1);
    assertEquals(registry.calls[0].name, "read_file");
  } finally {
    fixture.cleanup();
  }
});

Deno.test("[AgentRunner planning tools] the planner registry is created with the request portal's target_path and the request traceId", async () => {
  registerProviders();
  const fixture = makePortalFixture();
  try {
    const provider = new ScriptedProvider(NATIVE_PROVIDER_ID, twoRoundResponses());
    const registry = new StubToolRegistry(fixture.root);
    let capturedTraceId = "";
    let capturedBaseDir = "";
    const request: IParsedRequest = { userPrompt: "do it", context: {}, portal: "myportal", traceId: "trace-42" };
    const context = makeContext({
      planning: TWO_ROUND_PLANNING,
      portals: [{ alias: "myportal", target_path: fixture.root, agents_allowed: ["*"], operations: ["read"] }],
    });
    const runner = new AgentRunner(
      provider,
      {
        context,
        selectedModel: { provider: NATIVE_PROVIDER_ID, model: "test-model" },
        tokenizer: stubTokenizer,
        plannerToolRegistryFactory: {
          createToolRegistry: (traceId: string, baseDir: string) => {
            capturedTraceId = traceId;
            capturedBaseDir = baseDir;
            return registry;
          },
        },
      } satisfies IAgentRunnerConfig,
    );

    await runner.run(blueprint, request, undefined);

    assertEquals(capturedTraceId, "trace-42");
    assertEquals(capturedBaseDir, fixture.root);
  } finally {
    fixture.cleanup();
  }
});

Deno.test("[AgentRunner planning tools][regression] planning absent/tools_enabled=false produces the exact single-call request (byte-identical)", async () => {
  const request: IParsedRequest = { userPrompt: "do it", context: {} };

  const providerAbsent = new ScriptedProvider(NATIVE_PROVIDER_ID, [
    makeGenerateResult("<thought>t</thought><content>c</content>"),
  ]);
  const runnerAbsent = new AgentRunner(providerAbsent, {});
  await runnerAbsent.run(blueprint, request, undefined);

  const providerOff = new ScriptedProvider(NATIVE_PROVIDER_ID, [
    makeGenerateResult("<thought>t</thought><content>c</content>"),
  ]);
  const runnerOff = new AgentRunner(providerOff, {
    context: makeContext({
      planning: { tools_enabled: false, max_tool_rounds: 2, max_tool_result_tokens: 2000 },
      portals: [],
    }),
  });
  await runnerOff.run(blueprint, request, undefined);

  assertEquals(providerAbsent.calls.length, 1);
  assertEquals(providerOff.calls.length, 1);
  assertEquals(providerAbsent.calls[0].prompt, providerOff.calls[0].prompt);
  assertEquals(providerAbsent.calls[0].options, providerOff.calls[0].options);
});

Deno.test("[AgentRunner planning tools] flag on + non-native provider: single call + planning.tools.skipped{reason:provider_unsupported}", async () => {
  registerProviders();
  const provider = new ScriptedProvider(NON_NATIVE_PROVIDER_ID, [
    makeGenerateResult("<thought>t</thought><content>c</content>"),
  ]);
  const captured: ICapturedEvent[] = [];
  const request: IParsedRequest = { userPrompt: "do it", context: {}, portal: "myportal" };
  const context = makeContext({
    planning: TWO_ROUND_PLANNING,
    portals: [{ alias: "myportal", target_path: "/tmp/does-not-matter", agents_allowed: ["*"], operations: ["read"] }],
  });
  const runner = new AgentRunner(
    provider,
    {
      context,
      selectedModel: { provider: NON_NATIVE_PROVIDER_ID, model: "test-model" },
      tokenizer: stubTokenizer,
      logger: createCapturingLogger(captured),
      plannerToolRegistryFactory: { createToolRegistry: () => new StubToolRegistry("/tmp") },
    } satisfies IAgentRunnerConfig,
  );

  await runner.run(blueprint, request, undefined);

  assertEquals(provider.calls.length, 1);
  assert(provider.calls[0].options?.tools === undefined);
  const skipped = captured.find((e) => e.action === DomainEventType.PlanningToolsSkipped);
  assert(skipped);
  assertEquals(skipped!.payload?.reason, PlanningToolsSkipReason.PROVIDER_UNSUPPORTED);
});

Deno.test("[AgentRunner planning tools] flag on + request without portal: single call + planning.tools.skipped{reason:no_portal}", async () => {
  registerProviders();
  const provider = new ScriptedProvider(NATIVE_PROVIDER_ID, [
    makeGenerateResult("<thought>t</thought><content>c</content>"),
  ]);
  const captured: ICapturedEvent[] = [];
  const request: IParsedRequest = { userPrompt: "do it", context: {} };
  const context = makeContext({ planning: TWO_ROUND_PLANNING, portals: [] });
  const runner = new AgentRunner(
    provider,
    {
      context,
      selectedModel: { provider: NATIVE_PROVIDER_ID, model: "test-model" },
      tokenizer: stubTokenizer,
      logger: createCapturingLogger(captured),
      plannerToolRegistryFactory: { createToolRegistry: () => new StubToolRegistry("/tmp") },
    } satisfies IAgentRunnerConfig,
  );

  await runner.run(blueprint, request, undefined);

  assertEquals(provider.calls.length, 1);
  const skipped = captured.find((e) => e.action === DomainEventType.PlanningToolsSkipped);
  assert(skipped);
  assertEquals(skipped!.payload?.reason, PlanningToolsSkipReason.NO_PORTAL);
});

Deno.test("[AgentRunner planning tools][security] portal operations omit read: no tools offered + planning.tools.skipped{reason:portal_read_denied}", async () => {
  registerProviders();
  const provider = new ScriptedProvider(NATIVE_PROVIDER_ID, [
    makeGenerateResult("<thought>t</thought><content>c</content>"),
  ]);
  const captured: ICapturedEvent[] = [];
  const request: IParsedRequest = { userPrompt: "do it", context: {}, portal: "myportal" };
  const context = makeContext({
    planning: TWO_ROUND_PLANNING,
    portals: [{ alias: "myportal", target_path: "/tmp/does-not-matter", agents_allowed: ["*"], operations: ["write"] }],
  });
  const runner = new AgentRunner(
    provider,
    {
      context,
      selectedModel: { provider: NATIVE_PROVIDER_ID, model: "test-model" },
      tokenizer: stubTokenizer,
      logger: createCapturingLogger(captured),
      plannerToolRegistryFactory: { createToolRegistry: () => new StubToolRegistry("/tmp") },
    } satisfies IAgentRunnerConfig,
  );

  await runner.run(blueprint, request, undefined);

  assertEquals(provider.calls.length, 1);
  assert(provider.calls[0].options?.tools === undefined);
  const skipped = captured.find((e) => e.action === DomainEventType.PlanningToolsSkipped);
  assert(skipped);
  assertEquals(skipped!.payload?.reason, PlanningToolsSkipReason.PORTAL_READ_DENIED);
});

Deno.test("[AgentRunner planning tools] flipping planning.tools_enabled live between two run() calls on one AgentRunner switches paths", async () => {
  registerProviders();
  const fixture = makePortalFixture();
  try {
    const provider = new ScriptedProvider(NATIVE_PROVIDER_ID, [
      makeGenerateResult("<thought>t</thought><content>off</content>"),
      ...twoRoundResponses(),
    ]);
    const registry = new StubToolRegistry(fixture.root);
    const request: IParsedRequest = { userPrompt: "do it", context: {}, portal: "myportal" };
    const planningState: ITestPlanningConfig = {
      tools_enabled: false,
      max_tool_rounds: 2,
      max_tool_result_tokens: 2000,
    };
    const context = makeContext({
      planning: planningState,
      portals: [{ alias: "myportal", target_path: fixture.root, agents_allowed: ["*"], operations: ["read"] }],
    });
    const runner = new AgentRunner(
      provider,
      {
        context,
        selectedModel: { provider: NATIVE_PROVIDER_ID, model: "test-model" },
        tokenizer: stubTokenizer,
        plannerToolRegistryFactory: { createToolRegistry: () => registry },
      } satisfies IAgentRunnerConfig,
    );

    await runner.run(blueprint, request, undefined);
    assertEquals(provider.calls.length, 1);
    assert(provider.calls[0].options?.tools === undefined);

    planningState.tools_enabled = true;
    await runner.run(blueprint, request, undefined);
    assertEquals(provider.calls.length, 3);
    assert(provider.calls[1].options?.tools !== undefined);
  } finally {
    fixture.cleanup();
  }
});

Deno.test("[AgentRunner planning tools] enabling planning tools reserves loopHistory headroom in the allocation hints (GAP-11)", async () => {
  registerProviders();
  const fixture = makePortalFixture();
  try {
    const capturedHintsOn: Array<{ loopHistoryUsedTokens?: number }> = [];
    const stubAllocatorOn = {
      allocate: (_modelId: string, hints: { loopHistoryUsedTokens?: number }) => {
        capturedHintsOn.push(hints);
        return Promise.resolve({
          model: "x",
          totalBudgetTokens: 1_000_000,
          safetyBufferTokens: 0,
          sections: { system: 1000, plan: 1000, portalKnowledge: 1000, memory: 1000, skills: 1000, loopHistory: 1000 },
        });
      },
    } as never;

    const providerOn = new ScriptedProvider(NATIVE_PROVIDER_ID, twoRoundResponses());
    const registry = new StubToolRegistry(fixture.root);
    const requestOn: IParsedRequest = { userPrompt: "do it", context: {}, portal: "myportal" };
    const contextOn = makeContext({
      planning: TWO_ROUND_PLANNING,
      portals: [{ alias: "myportal", target_path: fixture.root, agents_allowed: ["*"], operations: ["read"] }],
    });
    const runnerOn = new AgentRunner(
      providerOn,
      {
        context: contextOn,
        selectedModel: { provider: NATIVE_PROVIDER_ID, model: "test-model" },
        tokenizer: stubTokenizer,
        promptBudgetAllocator: stubAllocatorOn,
        plannerToolRegistryFactory: { createToolRegistry: () => registry },
      } satisfies IAgentRunnerConfig,
    );
    await runnerOn.run(blueprint, requestOn, undefined);

    const capturedHintsOff: Array<{ loopHistoryUsedTokens?: number }> = [];
    const stubAllocatorOff = {
      allocate: (_modelId: string, hints: { loopHistoryUsedTokens?: number }) => {
        capturedHintsOff.push(hints);
        return Promise.resolve({
          model: "x",
          totalBudgetTokens: 1_000_000,
          safetyBufferTokens: 0,
          sections: { system: 1000, plan: 1000, portalKnowledge: 1000, memory: 1000, skills: 1000, loopHistory: 1000 },
        });
      },
    } as never;
    const providerOff = new ScriptedProvider(NATIVE_PROVIDER_ID, [
      makeGenerateResult("<thought>t</thought><content>c</content>"),
    ]);
    const requestOff: IParsedRequest = { userPrompt: "do it", context: {} };
    const runnerOff = new AgentRunner(
      providerOff,
      {
        context: makeContext({
          planning: { tools_enabled: false, max_tool_rounds: 2, max_tool_result_tokens: 2000 },
          portals: [],
        }),
        tokenizer: stubTokenizer,
        promptBudgetAllocator: stubAllocatorOff,
      } satisfies IAgentRunnerConfig,
    );
    await runnerOff.run(blueprint, requestOff, undefined);

    const onHints = capturedHintsOn[0];
    const offHints = capturedHintsOff[0];
    const expectedReserved = (TWO_ROUND_PLANNING.max_tool_rounds - 1) *
      (TWO_ROUND_PLANNING.max_tool_result_tokens + PLANNING_TOOL_CALL_OVERHEAD_TOKENS);
    assertEquals((onHints.loopHistoryUsedTokens ?? 0) - (offHints.loopHistoryUsedTokens ?? 0), expectedReserved);
  } finally {
    fixture.cleanup();
  }
});
