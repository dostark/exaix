/**
 * @module PlanningToolLoopTest
 * @path packages/execution/tests/planning_tool_loop_test.ts
 * @description Tests for PlanningToolLoop (Phase 199 Step 2): the round protocol (auto
 *   exploration rounds, tool-less toolChoice:none final round), multi-round result carrying
 *   via priorTurn + transcript blocks, truncation, per-round retry/callSite addressing, tool
 *   refusal/error handling, and journaled dynamic_tool_call/planning.tools.completed events.
 *   Security/confinement/guardrail tests live in planning_tool_loop_security_test.ts.
 * @architectural-layer Test
 * @related-files [packages/execution/src/planning_tool_loop.ts, packages/execution/src/native_tool_turns.ts]
 */

import { assert, assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { PlanningToolLoop } from "../src/planning_tool_loop.ts";
import type { IPlanningToolLoopDeps, IPlanningToolLoopOptions } from "../src/planning_tool_loop.ts";
import type { ICallSite, IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { type INativeInputMeasurement, ProviderRegistry } from "@exaix/ai";
import { MockProviderFactory } from "@exaix/ai/factories/mock_factory.ts";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import {
  AGENT_EVENT_RESPONSE_REFUSED,
  PlanningToolLoopStopReason,
  PricingTier,
  ProviderCostTier,
  ToolsRoundMode,
} from "@exaix/core";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { initTestDbService } from "@exaix/testing";
import { makeGenerateResult } from "@exaix/testing";
import {
  PLANNING_TOOL_CALL_OVERHEAD_TOKENS,
  PLANNING_TOOLS_CONTINUE_ROUND_INSTRUCTION,
  PLANNING_TOOLS_FINAL_ROUND_INSTRUCTION,
  PLANNING_TOOLS_UNTRUSTED_DATA_NOTICE,
} from "@exaix/core";
import { createCoreToolSchemas, readOnlyEditorTools } from "@exaix/tool-runtime";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import { ContextBudgetExceededError } from "@exaix/core/errors";

// Test doubles

/** Records every execute() call and dispatches to a per-tool handler (or a default). */
class StubToolRegistry implements IToolRegistry {
  public calls: Array<{ name: string; params: Record<string, JSONValue> }> = [];
  constructor(
    private readonly tools: ITool[] = [],
    private readonly handlers: Record<
      string,
      (params: Record<string, JSONValue>) => IToolResult | Promise<IToolResult>
    > = {},
    private readonly defaultResult: IToolResult = { success: true, data: {} },
  ) {}
  getTools(): ITool[] {
    return this.tools;
  }
  async execute(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    this.calls.push({ name: toolName, params });
    const handler = this.handlers[toolName];
    return handler ? await handler(params) : this.defaultResult;
  }
  getBaseDir(): string {
    return "/tmp/stub-tool-registry";
  }
}

function fixtureTool(name: string): ITool {
  return { name, description: `${name} description`, parameters: { type: "object", properties: {} } };
}

/** Simple, deterministic, network-free tokenizer for tests that don't need the real
 *  ai-token-estimator catalog — one token per 4 chars, matching TOKEN_ESTIMATION_CHARS_PER_TOKEN. */
const stubTokenizer = {
  countTokens: (text: string) => Promise.resolve(Math.ceil(text.length / 4)),
  countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((t) => Math.ceil(t.length / 4))),
};

/** Replays scripted IGenerateResult responses in order and records every (prompt, options) pair. */
class ScriptedGenerate {
  public calls: Array<{ prompt: string; options: IModelOptions }> = [];
  private index = 0;
  constructor(private readonly responses: IGenerateResult[]) {}
  generate = (prompt: string, options: IModelOptions): Promise<IGenerateResult> => {
    this.calls.push({ prompt, options });
    const response = this.responses[this.index];
    this.index++;
    if (!response) throw new Error(`ScriptedGenerate: no scripted response for call #${this.index}`);
    return Promise.resolve(response);
  };
}

function makeDeps(overrides: Partial<IPlanningToolLoopDeps> = {}): IPlanningToolLoopDeps {
  return {
    toolRegistry: new StubToolRegistry(),
    tokenizer: stubTokenizer,
    modelId: "gpt-4",
    generate: () => {
      throw new Error("generate() not stubbed for this test");
    },
    ...overrides,
  };
}

function nextCallSiteFrom(scenarioId: string, stepId: string): () => ICallSite {
  let callIndex = 0;
  return () => ({ scenarioId, stepId, callIndex: callIndex++ });
}

/** Real, existing directory so PathSecurity.resolveWithinRoots (the confinement guard)
 *  succeeds for a bare portal-relative tool path in tests that aren't exercising
 *  confinement itself — see planning_tool_loop_security_test.ts for that. */
const FIXTURE_PORTAL_ROOT = Deno.makeTempDirSync({ prefix: "planning-tool-loop-fixture-" });

function makeOptions(overrides: Partial<IPlanningToolLoopOptions> = {}): IPlanningToolLoopOptions {
  return {
    prompt: "Plan the change.",
    baseOptions: {},
    nextCallSite: nextCallSiteFrom("scenario-1", "step-1"),
    portalAlias: "myportal",
    portalRoot: FIXTURE_PORTAL_ROOT,
    allowedTools: new Set(["read_file"]),
    maxRounds: 2,
    maxToolResultTokens: 2000,
    maxToolCallsPerRound: 10,
    traceId: "trace-1",
    ...overrides,
  };
}

// Round protocol

Deno.test("[naming][planning_tool_loop] native renames preserve the read-only catalog boundary", async () => {
  const allowedTools = new Set(readOnlyEditorTools().map((tool) => tool.name));
  for (const name of ["find_dependents", "run_deno_task", "who_depends_on", "deno_task", "dependents"]) {
    const registry = new StubToolRegistry(createCoreToolSchemas());
    const generate = new ScriptedGenerate([
      makeGenerateResult("", { toolCalls: [{ id: "native-name", name, input: { path: "." } }] }),
      makeGenerateResult("plan"),
    ]);
    await new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate })).run(
      makeOptions({ allowedTools }),
    );
    assertEquals(registry.calls, name === "find_dependents" ? [{ name, params: { path: "@myportal/." } }] : []);
    assertEquals(generate.calls[1].options.priorTurn?.toolResultIsError, name !== "find_dependents");
  }
});

Deno.test("[planning-allowlist-alias] alias and canonical allowlists expose and execute search_text", async () => {
  for (const allowed of ["grep_search", "search_text"]) {
    const registry = new StubToolRegistry([fixtureTool("search_text")]);
    const generate = new ScriptedGenerate([
      makeGenerateResult("", { toolCalls: [{ id: "search-1", name: "grep_search", input: {} }] }),
      makeGenerateResult("done"),
    ]);
    const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

    await loop.run(makeOptions({ allowedTools: new Set([allowed]) }));

    assertEquals(generate.calls[0].options.tools?.map((tool) => tool.name), ["search_text"]);
    assertEquals(registry.calls, [{ name: "search_text", params: {} }]);
  }
});

Deno.test("[scope-boundaries] native names in a planning allowlist do not introduce a catalog alias", async () => {
  const registry = new StubToolRegistry(readOnlyEditorTools());
  const generate = new ScriptedGenerate([
    makeGenerateResult("", { toolCalls: [{ id: "native-alias", name: "who_depends_on", input: { path: "." } }] }),
    makeGenerateResult("done"),
  ]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  await loop.run(makeOptions({ allowedTools: new Set(["who_depends_on"]) }));

  assertEquals(generate.calls[0].options.tools?.some((tool) => tool.name === "who_depends_on"), false);
  assertEquals(registry.calls, []);
  assertEquals(
    String(generate.calls[1].options.priorTurn?.toolResultContent).includes("not in the planning catalog"),
    true,
  );
});

Deno.test("[planning_tool_loop] round 1 with no toolCalls returns the raw response untouched, stopReason no_tool_calls", async () => {
  const response = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([response]);
  const loop = new PlanningToolLoop(makeDeps({ generate: generate.generate }));

  const result = await loop.run(makeOptions({ maxRounds: 3 }));

  assertEquals(result.final, response);
  assertEquals(result.stopReason, PlanningToolLoopStopReason.NO_TOOL_CALLS);
  assertEquals(result.rounds, 1);
  assertEquals(result.toolCalls, 0);
  assertEquals(generate.calls.length, 1);
});

Deno.test("[planning_tool_loop] a tool-call round executes through the registry and feeds the result back as priorTurn on round 2", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: true, data: { content: "file contents" } }),
  });
  const round1 = makeGenerateResult("", {
    toolCalls: [{ id: "toolu_1", name: "read_file", input: { path: "a.ts" } }],
  });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  const result = await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]) }));

  assertEquals(result.final, round2);
  assertEquals(registry.calls.length, 1);
  assertEquals(registry.calls[0].name, "read_file");
  assertExists(generate.calls[1].options.priorTurn);
  assertEquals(generate.calls[1].options.priorTurn?.toolUseId, "toolu_1");
  assert(
    String(generate.calls[1].options.priorTurn?.toolResultContent).includes("file contents"),
    "round 2's priorTurn must carry round 1's tool result",
  );
});

Deno.test("[planning_tool_loop] the final round is sent with toolChoice none and tools still defined, returning text even after every exploration round returned toolCalls", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: true, data: {} }),
  });
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
  // The final round still returns a toolCalls block (pathological/misbehaving provider) AND text.
  const round2 = makeGenerateResult("<thought>t</thought><content>final plan</content>", {
    toolCalls: [{ id: "t2", name: "read_file", input: { path: "b.ts" } }],
  });
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  const result = await loop.run(makeOptions({ maxRounds: 2 }));

  assertEquals(result.final.content, "<thought>t</thought><content>final plan</content>");
  assertEquals(result.stopReason, PlanningToolLoopStopReason.ROUND_CAP);
  // Never execute tools on the final round: only round 1's call was executed.
  assertEquals(registry.calls.length, 1);
  const finalRoundOptions = generate.calls[1].options;
  assertEquals(finalRoundOptions.toolChoice?.type, "none");
  assertExists(finalRoundOptions.tools, "the final round must still define tools (a priorTurn requires it)");
});

// Native conversation snapshot (compatible providers)

const NATIVE_PROVIDER_ID = "openai-chat-native-fixture";

function registerNativeConversationProvider(): void {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata(NATIVE_PROVIDER_ID, new MockProviderFactory(), {
    name: NATIVE_PROVIDER_ID,
    description: "Native-conversation fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsNativeConversation: true,
    chatFormat: "openai",
  });
}

Deno.test("[planning_tool_loop][native] round 1 carries no priorTurn/transcript — an empty turns snapshot and no roundInstruction", async () => {
  registerNativeConversationProvider();
  try {
    const response = makeGenerateResult("<thought>t</thought><content>plan</content>");
    const generate = new ScriptedGenerate([response]);
    const loop = new PlanningToolLoop(makeDeps({ generate: generate.generate, providerId: NATIVE_PROVIDER_ID }));

    await loop.run(makeOptions({ maxRounds: 3 }));

    const roundOptions = generate.calls[0].options;
    assertEquals(roundOptions.nativeConversation?.turns, []);
    assertEquals(roundOptions.nativeConversation?.roundInstruction, undefined);
    assertEquals(roundOptions.priorTurn, undefined);
    assert(roundOptions.nativeConversation?.initialPrompt.includes(PLANNING_TOOLS_UNTRUSTED_DATA_NOTICE));
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][native] a tool call is appended to the snapshot's turns (not priorTurn/transcript), and round 2's prompt is byte-identical to round 1's", async () => {
  registerNativeConversationProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: () => ({ success: true, data: { content: "file contents" } }),
    });
    const round1 = makeGenerateResult("", {
      toolCalls: [{ id: "toolu_1", name: "read_file", input: { path: "a.ts" } }],
    });
    const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
    const generate = new ScriptedGenerate([round1, round2]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: NATIVE_PROVIDER_ID }),
    );

    await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]) }));

    assertEquals(
      generate.calls[1].prompt,
      generate.calls[0].prompt,
      "the native prompt must stay frozen across rounds",
    );
    assertEquals(generate.calls[1].options.priorTurn, undefined);
    const turns = generate.calls[1].options.nativeConversation?.turns;
    assertEquals(turns?.length, 1);
    assertEquals(turns?.[0].toolUseId, "toolu_1");
    assert(String(turns?.[0].toolResultContent).includes("file contents"));
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][native] the final round drops tools entirely and sets the final roundInstruction", async () => {
  registerNativeConversationProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: () => ({ success: true, data: {} }),
    });
    const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
    const round2 = makeGenerateResult("<thought>t</thought><content>final plan</content>");
    const generate = new ScriptedGenerate([round1, round2]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: NATIVE_PROVIDER_ID }),
    );

    const result = await loop.run(makeOptions({ maxRounds: 2 }));

    assertEquals(result.final.content, "<thought>t</thought><content>final plan</content>");
    const finalOptions = generate.calls[1].options;
    assertEquals(finalOptions.tools, undefined, "the final native round must not define tools");
    assertEquals(finalOptions.nativeConversation?.roundInstruction, PLANNING_TOOLS_FINAL_ROUND_INSTRUCTION);
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][native] a denied (confinement) result is appended to the snapshot's turns with its call id, matching the ordinary path", async () => {
  registerNativeConversationProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")]);
    const round1 = makeGenerateResult("", {
      toolCalls: [{ id: "escape-1", name: "read_file", input: { path: "/etc/passwd" } }],
    });
    const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
    const generate = new ScriptedGenerate([round1, round2]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: NATIVE_PROVIDER_ID }),
    );

    await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]) }));

    assertEquals(registry.calls, [], "a confinement-denied call must never reach the registry");
    const turns = generate.calls[1].options.nativeConversation?.turns;
    assertEquals(turns?.length, 1);
    assertEquals(turns?.[0].toolUseId, "escape-1");
    assertEquals(turns?.[0].toolResultIsError, true);
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][native] an intermediate round with prior turns sets the continue roundInstruction", async () => {
  registerNativeConversationProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: () => ({ success: true, data: {} }),
    });
    const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
    const round2 = makeGenerateResult("", { toolCalls: [{ id: "t2", name: "read_file", input: { path: "b.ts" } }] });
    const round3 = makeGenerateResult("<thought>t</thought><content>plan</content>");
    const generate = new ScriptedGenerate([round1, round2, round3]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: NATIVE_PROVIDER_ID }),
    );

    await loop.run(makeOptions({ maxRounds: 3, allowedTools: new Set(["read_file"]) }));

    assertEquals(
      generate.calls[1].options.nativeConversation?.roundInstruction,
      PLANNING_TOOLS_CONTINUE_ROUND_INSTRUCTION,
    );
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][native] a round exceeding the caller's prompt budget aborts before that generate call, never issuing an over-budget request", async () => {
  registerNativeConversationProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: () => ({ success: true, data: {} }),
    });
    const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
    const generate = new ScriptedGenerate([round1]);
    const budget: IPromptBudget = {
      model: "gpt-4",
      totalBudgetTokens: 100,
      safetyBufferTokens: 0,
      sections: { system: 100, plan: 100, portalKnowledge: 100, memory: 100, skills: 100, loopHistory: 100 },
    };
    const overflowMeasurement: INativeInputMeasurement = {
      totalTokens: 500,
      sections: { system: 10, plan: 10, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 480 },
      tokenSource: "tokenizer_estimate",
    };
    const loop = new PlanningToolLoop(makeDeps({
      toolRegistry: registry,
      generate: generate.generate,
      providerId: NATIVE_PROVIDER_ID,
      measureInputTokens: () => Promise.resolve(overflowMeasurement),
    }));

    await assertRejects(
      () => loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]), promptBudget: budget })),
      ContextBudgetExceededError,
    );
    assertEquals(generate.calls.length, 0, "the over-budget round must never reach generate()");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop] off exploration rounds use toolChoice auto with parallel disabled, never any/tool", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: true, data: {} }),
  });
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const off = {
    mode: ToolsRoundMode.OFF,
    executionCap: 1,
    concurrency: 1,
    maxResponseCalls: 64,
    maxArgumentBytes: 65536,
    maxReplayBytes: 1048576,
    resultTokenCap: 2000,
  };
  const loop = new PlanningToolLoop(
    makeDeps({ toolRegistry: registry, generate: generate.generate, toolsRoundPolicy: () => off }),
  );

  await loop.run(makeOptions({ maxRounds: 2 }));

  const round1Options = generate.calls[0].options;
  assertEquals(round1Options.toolChoice?.type, "auto");
  assert(round1Options.toolChoice?.type === "auto");
  assertEquals(round1Options.toolChoice.disable_parallel_tool_use, true);
});

Deno.test("[planning_tool_loop] maxRounds=1 sends no tools/toolChoice at all (byte-identical to today's single call)", async () => {
  const response = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([response]);
  const loop = new PlanningToolLoop(makeDeps({ generate: generate.generate }));
  const basePrompt = "Plan the change.";
  const baseOptions: IModelOptions = { conversationId: "conv-1" };

  const result = await loop.run(makeOptions({ maxRounds: 1, prompt: basePrompt, baseOptions }));

  assertEquals(result.final, response);
  assertEquals(generate.calls.length, 1);
  assertEquals(generate.calls[0].prompt, basePrompt, "the prompt must be unmodified for maxRounds=1");
  assertEquals(generate.calls[0].options.tools, undefined);
  assertEquals(generate.calls[0].options.toolChoice, undefined);
  assertEquals(generate.calls[0].options.conversationId, "conv-1", "baseOptions fields must still pass through");
});

// Result carrying

Deno.test("[planning_tool_loop] round 3's prompt contains round 1's tool result inside a planning_tool_result block", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: (p) => ({ success: true, data: { content: `contents of ${p.path}` } }),
  });
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
  const round2 = makeGenerateResult("", { toolCalls: [{ id: "t2", name: "read_file", input: { path: "b.ts" } }] });
  const round3 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2, round3]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  await loop.run(makeOptions({ maxRounds: 3 }));

  const round3Prompt = generate.calls[2].prompt;
  assert(round3Prompt.includes('<planning_tool_result tool="read_file" round="1">'));
  assert(round3Prompt.includes("contents of @myportal/a.ts"), "round 1's result must survive into round 3's prompt");
});

Deno.test("[planning_tool_loop] parallel toolCalls in one round are all executed and all results reach the next round", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: (p) => ({ success: true, data: { content: `contents of ${p.path}` } }),
  });
  const round1 = makeGenerateResult("", {
    toolCalls: [
      { id: "t1", name: "read_file", input: { path: "a.ts" } },
      { id: "t2", name: "read_file", input: { path: "b.ts" } },
    ],
  });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  const result = await loop.run(makeOptions({ maxRounds: 2 }));

  assertEquals(registry.calls.length, 2, "both parallel calls must be executed");
  assertEquals(result.toolCalls, 2);
  // The last call (b.ts) becomes priorTurn; the earlier one (a.ts) is folded into the transcript.
  assert(String(generate.calls[1].options.priorTurn?.toolResultContent).includes("contents of @myportal/b.ts"));
  assert(
    generate.calls[1].prompt.includes("contents of @myportal/a.ts"),
    "the earlier parallel call's result must not be lost",
  );
});

Deno.test("[planning_tool_loop] in a parallel round the signed call (Gemini thoughtSignature on the first call only) becomes priorTurn and the rest join the transcript", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: (p) => ({ success: true, data: { content: `contents of ${p.path}` } }),
  });
  const round1 = makeGenerateResult("", {
    toolCalls: [
      { id: "t1", name: "read_file", input: { path: "a.ts" }, thoughtSignature: "sig-first" },
      { id: "t2", name: "read_file", input: { path: "b.ts" } },
      { id: "t3", name: "read_file", input: { path: "c.ts" } },
    ],
  });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  await loop.run(makeOptions({ maxRounds: 2 }));

  const priorTurn = generate.calls[1].options.priorTurn;
  assertEquals(priorTurn?.thoughtSignature, "sig-first");
  assert(String(priorTurn?.toolResultContent).includes("contents of @myportal/a.ts"));
  assert(generate.calls[1].prompt.includes("contents of @myportal/b.ts"));
  assert(generate.calls[1].prompt.includes("contents of @myportal/c.ts"));
});

Deno.test("[planning_tool_loop] calls beyond maxToolCallsPerRound are answered with an error result and never executed", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: (p) => ({ success: true, data: { content: `contents of ${p.path}` } }),
  });
  const round1 = makeGenerateResult("", {
    toolCalls: [
      { id: "t1", name: "read_file", input: { path: "a.ts" } },
      { id: "t2", name: "read_file", input: { path: "b.ts" } },
      { id: "t3", name: "read_file", input: { path: "c.ts" } },
    ],
  });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  const result = await loop.run(makeOptions({ maxRounds: 2, maxToolCallsPerRound: 2 }));

  assertEquals(registry.calls.map((c) => c.params.path), ["@myportal/a.ts", "@myportal/b.ts"]);
  assertEquals(result.toolCalls, 2);
  const priorTurn = generate.calls[1].options.priorTurn;
  assertEquals(priorTurn?.toolResultIsError, true);
  assert(String(priorTurn?.toolResultContent).includes("tool call limit"));
});

Deno.test("[planning_tool_loop] final-round prompt growth stays within the per-call headroom (cap x (result tokens + overhead))", async () => {
  const bigResult = "x".repeat(40_000);
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: true, data: { content: bigResult } }),
  });
  const calls = ["a", "b", "c", "d"].map((id) => ({ id, name: "read_file", input: { path: `${id}.ts` } }));
  const generate = new ScriptedGenerate([
    makeGenerateResult("", { toolCalls: calls }),
    makeGenerateResult("<thought>t</thought><content>plan</content>"),
  ]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));
  const maxToolResultTokens = 256;
  const maxToolCallsPerRound = 2;

  await loop.run(makeOptions({ maxRounds: 2, maxToolResultTokens, maxToolCallsPerRound }));

  const [firstRound, finalRound] = generate.calls;
  const transcriptTokens = await stubTokenizer.countTokens(finalRound.prompt) -
    await stubTokenizer.countTokens(firstRound.prompt) -
    await stubTokenizer.countTokens(`\n\n${PLANNING_TOOLS_FINAL_ROUND_INSTRUCTION}`);
  const priorTurnTokens = await stubTokenizer.countTokens(String(finalRound.options.priorTurn?.toolResultContent));
  const headroom = maxToolCallsPerRound * (maxToolResultTokens + PLANNING_TOOL_CALL_OVERHEAD_TOKENS);
  assert(
    transcriptTokens + priorTurnTokens <= headroom,
    `grew ${transcriptTokens + priorTurnTokens} tokens, headroom ${headroom}`,
  );
});

Deno.test("[planning_tool_loop] a final round with no text (provider ignored toolChoice none) ends with the empty_final stop reason", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")]);
  const toolCall = { id: "t1", name: "read_file", input: { path: "a.ts" } };
  const round1 = makeGenerateResult("", { toolCalls: [toolCall] });
  const round2 = makeGenerateResult("", { toolCalls: [{ ...toolCall, id: "t2" }] });
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  const result = await loop.run(makeOptions({ maxRounds: 2 }));

  assertEquals(result.stopReason, PlanningToolLoopStopReason.EMPTY_FINAL);
  assertEquals(registry.calls.length, 1, "the final round's tool calls are never executed");
});

// Truncation

Deno.test("[planning_tool_loop] a tool result exceeding maxToolResultTokens is truncated (not dropped) by a real tokenizer count", async () => {
  const longContent = "x".repeat(20_000);
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: true, data: { content: longContent } }),
  });
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const realTokenizer = new AiTokenEstimatorTokenizer();
  const loop = new PlanningToolLoop(
    makeDeps({ toolRegistry: registry, generate: generate.generate, tokenizer: realTokenizer, modelId: "gpt-4" }),
  );

  await loop.run(makeOptions({ maxRounds: 2, maxToolResultTokens: 50 }));

  const carried = String(generate.calls[1].options.priorTurn?.toolResultContent);
  assert(carried.length > 0, "truncated content must not be dropped entirely");
  assert(carried.length < longContent.length, "content must actually be shortened");
  assert(carried.endsWith("[truncated]"), "a truncation marker must be appended");
  const tokenCount = await realTokenizer.countTokens(carried.replace(" [truncated]", ""), "gpt-4");
  assert(tokenCount <= 50, `expected <=50 tokens, got ${tokenCount}`);
});

// Retry / call-site addressing

Deno.test("[planning_tool_loop] a transient failure in round 2's injected generate retries only round 2, never re-executing round 1's tools", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: true, data: {} }),
  });
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
  const round2Final = makeGenerateResult("<thought>t</thought><content>plan</content>");

  let generateCallCount = 0;
  const generateWithRetry = (_prompt: string, _options: IModelOptions): Promise<IGenerateResult> => {
    generateCallCount++;
    if (generateCallCount === 1) return Promise.resolve(round1);
    if (generateCallCount === 2) return Promise.reject(new Error("transient network error"));
    return Promise.resolve(round2Final);
  };
  // The loop itself does not retry (retry is AgentRunner's job per round); this test proves
  // the loop never re-executes round 1's tool call when the CALLER retries round 2's generate.
  const outerRetryingGenerate = async (prompt: string, options: IModelOptions): Promise<IGenerateResult> => {
    try {
      return await generateWithRetry(prompt, options);
    } catch {
      return await generateWithRetry(prompt, options);
    }
  };
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: outerRetryingGenerate }));

  const result = await loop.run(makeOptions({ maxRounds: 2 }));

  assertEquals(result.final, round2Final);
  assertEquals(registry.calls.length, 1, "round 1's tool call must be executed exactly once despite round 2's retry");
});

Deno.test("[planning_tool_loop] nextCallSite is invoked once per round, and each round's callSite.callIndex is distinct", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: true, data: {} }),
  });
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const nextCallSite = nextCallSiteFrom("scenario-x", "step-y");
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  await loop.run(makeOptions({ maxRounds: 2, nextCallSite }));

  assertEquals(generate.calls[0].options.callSite?.callIndex, 0);
  assertEquals(generate.calls[1].options.callSite?.callIndex, 1);
});

// Tool refusal / error handling

Deno.test("[planning_tool_loop] a tool name outside the catalog is refused with an error tool_result and never executed", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")]);
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "write_file", input: { path: "a.ts" } }] });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]) }));

  assertEquals(registry.calls.length, 0, "an unlisted tool must never reach ToolRegistry.execute");
  assertEquals(generate.calls[1].options.priorTurn?.toolResultIsError, true);
  assert(String(generate.calls[1].options.priorTurn?.toolResultContent).includes("not in the planning catalog"));
});

Deno.test("[planning_tool_loop] a tool returning success:false is fed back with toolResultIsError=true", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: false, error: "file not found" }),
  });
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  await loop.run(makeOptions({ maxRounds: 2 }));

  assertEquals(generate.calls[1].options.priorTurn?.toolResultIsError, true);
});

Deno.test("[planning_tool_loop] a tool that throws is caught and fed back as an error result; the loop continues", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => {
      throw new Error("disk exploded");
    },
  });
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  const result = await loop.run(makeOptions({ maxRounds: 2 }));

  assertEquals(result.final, round2);
  assertEquals(generate.calls[1].options.priorTurn?.toolResultIsError, true);
  assert(String(generate.calls[1].options.priorTurn?.toolResultContent).includes("disk exploded"));
});

Deno.test('[planning_tool_loop] an empty tool result is fed back as "{}"', async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: true }),
  });
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

  await loop.run(makeOptions({ maxRounds: 2 }));

  assertEquals(generate.calls[1].options.priorTurn?.toolResultContent, "{}");
});

// Integration — real EventLogger + real db

Deno.test("[planning_tool_loop][integration] a real EventLogger journals dynamic_tool_call rows with phase:planning and one planning.tools.completed row with summed tokens", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: () => ({ success: true, data: { content: "hi" } }),
    });
    const round1WithUsage: IGenerateResult = {
      ...makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
    const round2WithUsage: IGenerateResult = {
      ...makeGenerateResult("<thought>t</thought><content>plan</content>"),
      usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 },
    };
    const generate = new ScriptedGenerate([round1WithUsage, round2WithUsage]);
    const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate, logger }));
    const traceId = crypto.randomUUID();

    await loop.run(makeOptions({ maxRounds: 2, traceId }));
    await db.waitForFlush();

    const rows = db.getActivitiesByTrace(traceId);
    const toolCallRows = rows.filter((r) => r.action_type === DomainEventType.AgentDynamicToolCall);
    assertEquals(toolCallRows.length, 1);
    assertEquals(toolCallRows[0].target, "planning");
    const toolCallPayload = JSON.parse(toolCallRows[0].payload) as { phase: string; tool: string };
    assertEquals(toolCallPayload.phase, "planning");
    assertEquals(toolCallPayload.tool, "read_file");

    const completedRows = rows.filter((r) => r.action_type === DomainEventType.PlanningToolLoopCompleted);
    assertEquals(completedRows.length, 1);
    const completedPayload = JSON.parse(completedRows[0].payload) as {
      rounds: number;
      toolCalls: number;
      promptTokens: number;
      completionTokens: number;
    };
    assertEquals(completedPayload.rounds, 2);
    assertEquals(completedPayload.toolCalls, 1);
    assertEquals(completedPayload.promptTokens, 30);
    assertEquals(completedPayload.completionTokens, 13);
  } finally {
    await cleanup();
  }
});

Deno.test("[planning_tool_loop][integration] with a per-round cap of one, the refused second call is journaled with the limit message and never counted as executed", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: (p) => ({ success: true, data: { content: `contents of ${p.path}` } }),
    });
    const round1 = makeGenerateResult("", {
      toolCalls: [
        { id: "t1", name: "read_file", input: { path: "a.ts" } },
        { id: "t2", name: "read_file", input: { path: "b.ts" } },
      ],
    });
    const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
    const generate = new ScriptedGenerate([round1, round2]);
    const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate, logger }));
    const traceId = crypto.randomUUID();

    const result = await loop.run(makeOptions({ maxRounds: 2, maxToolCallsPerRound: 1, traceId }));
    await db.waitForFlush();

    assertEquals(registry.calls.map((c) => c.params.path), ["@myportal/a.ts"]);
    assertEquals(result.toolCalls, 1);

    const toolCallRows = db.getActivitiesByTrace(traceId)
      .filter((r) => r.action_type === DomainEventType.AgentDynamicToolCall);
    const summaries = toolCallRows.map((r) => (JSON.parse(r.payload) as { resultSummary: string }).resultSummary);
    assertEquals(toolCallRows.length, 2);
    assertEquals(summaries.filter((s) => s.includes("tool call limit")).length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("[planning_tool_loop][integration] a round that throws journals one planning.tools.aborted row with the partial totals and trace id, then rethrows", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const registry = new StubToolRegistry([fixtureTool("read_file")]);
    const round1: IGenerateResult = {
      ...makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
    let calls = 0;
    const generate = (): Promise<IGenerateResult> => {
      calls++;
      return calls === 1 ? Promise.resolve(round1) : Promise.reject(new Error("provider exploded"));
    };
    const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate, logger }));
    const traceId = crypto.randomUUID();

    await assertRejects(() => loop.run(makeOptions({ maxRounds: 2, traceId })), Error, "provider exploded");
    await db.waitForFlush();

    const rows = db.getActivitiesByTrace(traceId);
    const abortedRows = rows.filter((r) => r.action_type === DomainEventType.PlanningToolLoopAborted);
    assertEquals(abortedRows.length, 1);
    const payload = JSON.parse(abortedRows[0].payload) as {
      rounds: number;
      toolCalls: number;
      promptTokens: number;
      error: string;
    };
    assertEquals(payload.rounds, 2);
    assertEquals(payload.toolCalls, 1);
    assertEquals(payload.promptTokens, 10);
    assertEquals(payload.error, "provider exploded");
    assertEquals(rows.filter((r) => r.action_type === DomainEventType.PlanningToolLoopCompleted).length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("[security] an alias of a write tool is refused when its canonical tool is outside the planning allowlist", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file"), fixtureTool("write_file")]);
  const generate = new ScriptedGenerate([
    makeGenerateResult("", {
      toolCalls: [{ id: "write-1", name: "write", input: { path: "a.ts", content: "changed" } }],
    }),
    makeGenerateResult("done"),
  ]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));
  await loop.run(makeOptions({ allowedTools: new Set(["read_file"]), maxRounds: 2 }));
  assertEquals(registry.calls.length, 0);
  assertEquals(
    String(generate.calls[1].options.priorTurn?.toolResultContent).includes("not in the planning catalog"),
    true,
  );
});

Deno.test("[security] a fetch_url alias is not offered or executed in the planning catalog", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file"), fixtureTool("fetch_url")]);
  const generate = new ScriptedGenerate([
    makeGenerateResult("", { toolCalls: [{ id: "fetch-1", name: "webfetch", input: { url: "https://example.com" } }] }),
    makeGenerateResult("done"),
  ]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));
  await loop.run(makeOptions({ allowedTools: new Set(["read_file"]), maxRounds: 2 }));
  assertEquals(registry.calls.length, 0);
  assertEquals(generate.calls[0].options.tools?.some((tool) => tool.name === "fetch_url"), false);
});

Deno.test("[planning_tool_loop] a provider-native Read call with a thoughtSignature executes as read_file and replays its original id, name, input and signature", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: true, data: { content: "file" } }),
  });
  const call = {
    id: "signed-read",
    name: "Read",
    input: { file_path: "a.ts" },
    thoughtSignature: "signed-by-provider",
  };
  const generate = new ScriptedGenerate([
    makeGenerateResult("", { toolCalls: [call] }),
    makeGenerateResult("done"),
  ]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));
  await loop.run(makeOptions({ allowedTools: new Set(["read_file"]), maxRounds: 2 }));
  assertEquals(registry.calls, [{ name: "read_file", params: { file_path: "a.ts" } }]);
  assertEquals(generate.calls[1].options.priorTurn?.toolUseId, call.id);
  assertEquals(generate.calls[1].options.priorTurn?.toolName, call.name);
  assertEquals(generate.calls[1].options.priorTurn?.toolInput, call.input);
  assertEquals(generate.calls[1].options.priorTurn?.thoughtSignature, call.thoughtSignature);
});

Deno.test("[planning_tool_loop] a rejected Exaix-specific alias also replays verbatim", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")]);
  const call = {
    id: "signed-list",
    name: "list_symbols",
    input: {},
    thoughtSignature: "signed-by-provider",
  };
  const generate = new ScriptedGenerate([
    makeGenerateResult("", { toolCalls: [call] }),
    makeGenerateResult("done"),
  ]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));
  await loop.run(makeOptions({ allowedTools: new Set(["read_file"]), maxRounds: 2 }));
  assertEquals(registry.calls.length, 0);
  assertEquals(generate.calls[1].options.priorTurn?.toolUseId, call.id);
  assertEquals(generate.calls[1].options.priorTurn?.toolName, call.name);
  assertEquals(generate.calls[1].options.priorTurn?.toolInput, call.input);
  assertEquals(generate.calls[1].options.priorTurn?.thoughtSignature, call.thoughtSignature);
});

Deno.test("[planning_tool_loop][integration] an alias rewrite journals the canonical dynamic tool and planning entry point", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const registry = new StubToolRegistry([{
      ...fixtureTool("read_file"),
      parameters: { type: "object", properties: { path: { type: "string" } } },
    }], {
      read_file: () => ({ success: true, data: { content: "file" } }),
    });
    const traceId = "planning-alias-trace";
    const generate = new ScriptedGenerate([
      makeGenerateResult("", {
        provider: "alias-test-provider",
        model: "alias-test-model",
        toolCalls: [{ id: "read-1", name: "read_file", input: { file_path: "a.ts" } }],
      }),
      makeGenerateResult("done"),
    ]);
    const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate, logger }));
    await loop.run(makeOptions({ traceId, allowedTools: new Set(["read_file"]), maxRounds: 2 }));
    await db.waitForFlush();
    const rows = db.getActivitiesByTrace(traceId);
    const dynamic = rows.find((row) => row.action_type === DomainEventType.AgentDynamicToolCall);
    assertExists(dynamic);
    assertEquals(JSON.parse(dynamic.payload).tool, "read_file");
    const alias = rows.filter((row) => row.action_type === DomainEventType.ToolAliasRewritten);
    assertEquals(alias.length, 1);
    assertEquals(JSON.parse(alias[0].payload).entryPoint, "planning_loop");
    assertEquals(JSON.parse(alias[0].payload).provider, "alias-test-provider");
    assertEquals(JSON.parse(alias[0].payload).model, "alias-test-model");
    assertEquals(JSON.parse(alias[0].payload).modelCallId, "read-1");
  } finally {
    await cleanup();
  }
});

// Grouped replay: a parallel-replay provider receives the whole latest round.

const PARALLEL_REPLAY_PROVIDER_ID = "google-parallel-replay-fixture";

function registerParallelReplayProvider(): void {
  ProviderRegistry.clear();
  ProviderRegistry.registerWithMetadata(PARALLEL_REPLAY_PROVIDER_ID, new MockProviderFactory(), {
    name: PARALLEL_REPLAY_PROVIDER_ID,
    description: "Parallel grouped-replay fixture",
    capabilities: ["chat", "tools"],
    costTier: ProviderCostTier.LOCAL,
    pricingTier: PricingTier.LOCAL,
    strengths: [],
    supportsNativeTools: true,
    supportsParallelToolReplay: true,
    chatFormat: "openai",
  });
}

/** A two-call Gemini-shaped response whose assistant parts mirror its calls. */
function twoCallParallelResponse(ids: [string, string]): IGenerateResult {
  return makeGenerateResult("", {
    toolCalls: [
      { id: ids[0], name: "read_file", input: { path: "a.ts" }, thoughtSignature: "sig-a" },
      { id: ids[1], name: "read_file", input: { path: "b.ts" } },
    ],
    nativeAssistantReplay: {
      provider: "google",
      parts: [
        { functionCall: { name: "read_file", args: { path: "a.ts" } }, thoughtSignature: "sig-a" },
        { functionCall: { name: "read_file", args: { path: "b.ts" } } },
      ],
    },
  });
}

Deno.test("[planning_tool_loop][parallel-replay] the next request replays the whole latest round as priorRound, one result per call in order", async () => {
  registerParallelReplayProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: (params) => ({ success: true, data: { content: `CONTENT-${params.path}` } }),
    });
    const generate = new ScriptedGenerate([
      twoCallParallelResponse(["call-1", "call-2"]),
      makeGenerateResult("<thought>t</thought><content>plan</content>"),
    ]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: PARALLEL_REPLAY_PROVIDER_ID }),
    );

    await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]) }));

    const nextOptions = generate.calls[1].options;
    assertEquals(nextOptions.priorTurn, undefined, "a grouped round must not fall back to priorTurn");
    assertEquals(nextOptions.priorRound?.assistant, {
      provider: "google",
      parts: [
        { functionCall: { name: "read_file", args: { path: "a.ts" } }, thoughtSignature: "sig-a" },
        { functionCall: { name: "read_file", args: { path: "b.ts" } } },
      ],
    });
    assertEquals(nextOptions.priorRound?.calls.map((entry) => entry.toolUseId), ["call-1", "call-2"]);
    assertEquals(nextOptions.priorRound?.calls.map((entry) => entry.index), [0, 1]);
    assertEquals(nextOptions.priorRound?.calls.map((entry) => entry.toolResultContent), [
      '{"content":"CONTENT-@myportal/a.ts"}',
      '{"content":"CONTENT-@myportal/b.ts"}',
    ]);
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][parallel-replay] an unrepresentable round aborts before any tool effect", async () => {
  registerParallelReplayProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")]);
    const invalid = twoCallParallelResponse(["call-1", "   "]);
    const generate = new ScriptedGenerate([invalid, makeGenerateResult("unused")]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: PARALLEL_REPLAY_PROVIDER_ID }),
    );

    await assertRejects(() => loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]) })));
    assertEquals(registry.calls.length, 0, "no call in an unrepresentable round may reach the registry");
    assertEquals(generate.calls.length, 1, "the loop must not issue a follow-up request");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][parallel-replay] an unknown tool call keeps its ordered error result in the grouped round", async () => {
  registerParallelReplayProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: () => ({ success: true, data: { content: "ok" } }),
    });
    const generate = new ScriptedGenerate([
      makeGenerateResult("", {
        toolCalls: [
          { id: "call-1", name: "read_file", input: { path: "a.ts" } },
          { id: "call-2", name: "no_such_tool", input: {} },
        ],
        nativeAssistantReplay: {
          provider: "google",
          parts: [
            { functionCall: { name: "read_file", args: { path: "a.ts" } } },
            { functionCall: { name: "no_such_tool", args: {} } },
          ],
        },
      }),
      makeGenerateResult("<thought>t</thought><content>plan</content>"),
    ]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: PARALLEL_REPLAY_PROVIDER_ID }),
    );

    await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]) }));

    const entries = generate.calls[1].options.priorRound?.calls ?? [];
    assertEquals(entries.map((entry) => entry.toolUseId), ["call-1", "call-2"]);
    assertEquals(entries[1].toolName, "no_such_tool");
    assertEquals(entries[1].toolResultIsError, true, "an unknown tool still answers with one error result");
    assert(!registry.calls.some((call) => call.name === "no_such_tool"), "an unknown tool must not reach the registry");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][parallel-replay] a call refused by the per-round cap keeps its ordered error result in the grouped round", async () => {
  registerParallelReplayProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: () => ({ success: true, data: { content: "ok" } }),
    });
    const generate = new ScriptedGenerate([
      twoCallParallelResponse(["call-1", "call-2"]),
      makeGenerateResult("<thought>t</thought><content>plan</content>"),
    ]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: PARALLEL_REPLAY_PROVIDER_ID }),
    );

    await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]), maxToolCallsPerRound: 1 }));

    const entries = generate.calls[1].options.priorRound?.calls ?? [];
    assertEquals(entries.map((entry) => entry.toolUseId), ["call-1", "call-2"]);
    assertEquals(entries[0].toolResultIsError, false);
    assertEquals(entries[1].toolResultIsError, true, "the refused call still answers with one error result");
    assertEquals(registry.calls.length, 1, "only the call within the cap reaches the registry");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][parallel-replay] a native alias call executes as its catalog tool but replays its original name and id", async () => {
  registerParallelReplayProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: () => ({ success: true, data: { content: "ok" } }),
    });
    const generate = new ScriptedGenerate([
      makeGenerateResult("", {
        toolCalls: [{ id: "toolu_alias", name: "Read", input: { file_path: "a.ts" } }],
        nativeAssistantReplay: {
          provider: "google",
          parts: [{ functionCall: { name: "Read", args: { file_path: "a.ts" } } }],
        },
      }),
      makeGenerateResult("<thought>t</thought><content>plan</content>"),
    ]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: PARALLEL_REPLAY_PROVIDER_ID }),
    );

    await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]) }));

    assertEquals(registry.calls.map((call) => call.name), ["read_file"]);
    const entry = generate.calls[1].options.priorRound?.calls[0];
    assertEquals(entry?.toolUseId, "toolu_alias");
    assertEquals(entry?.toolName, "Read");
  } finally {
    ProviderRegistry.clear();
  }
});

// Replayed OpenAI-family rounds: the carrier is the round's source, so every call is accounted for.

const OPENAI_MALFORMED_CARRIER = {
  provider: "openai" as const,
  assistantContent: null,
  toolCalls: [
    { id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
    { id: "call-bad", type: "function", function: { name: "read_file", arguments: "{not json" } },
  ],
};

Deno.test("[planning_tool_loop][openai-round] a malformed argument string gets its own error result while its sibling executes", async () => {
  registerParallelReplayProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: (params) => ({ success: true, data: { content: `CONTENT-${params.path}` } }),
    });
    const generate = new ScriptedGenerate([
      makeGenerateResult("", {
        toolCalls: [{ id: "call-1", name: "read_file", input: { path: "a.ts" } }],
        nativeAssistantReplay: OPENAI_MALFORMED_CARRIER,
      }),
      makeGenerateResult("<thought>t</thought><content>plan</content>"),
    ]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: PARALLEL_REPLAY_PROVIDER_ID }),
    );

    await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]) }));

    assertEquals(registry.calls.length, 1, "only the readable call may execute");
    const entries = generate.calls[1].options.priorRound?.calls ?? [];
    assertEquals(entries.map((entry) => entry.toolUseId), ["call-1", "call-bad"]);
    assertEquals(entries[1].toolResultIsError, true);
    assertStringIncludes(String(entries[1].toolResultContent), "not a valid JSON object");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][openai-round] a round whose only call is malformed is replayed, not treated as a final answer", async () => {
  registerParallelReplayProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")]);
    const generate = new ScriptedGenerate([
      makeGenerateResult("", {
        toolCalls: undefined,
        nativeAssistantReplay: {
          provider: "openai",
          assistantContent: null,
          toolCalls: [OPENAI_MALFORMED_CARRIER.toolCalls[1]],
        },
      }),
      makeGenerateResult("<thought>t</thought><content>plan</content>"),
    ]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: registry, generate: generate.generate, providerId: PARALLEL_REPLAY_PROVIDER_ID }),
    );

    await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]) }));

    assertEquals(generate.calls.length, 2, "the refused call must reach the model as a result");
    assertEquals(registry.calls.length, 0);
    assertEquals(generate.calls[1].options.priorRound?.calls.map((entry) => entry.toolUseId), ["call-bad"]);
  } finally {
    ProviderRegistry.clear();
  }
});

/** A three-call Gemini-shaped round, the budgeted round size the planned checkpoint names. */
function threeCallParallelResponse(): IGenerateResult {
  return makeGenerateResult("", {
    toolCalls: [
      { id: "call-1", name: "read_file", input: { path: "a.ts" } },
      { id: "call-2", name: "read_file", input: { path: "b.ts" } },
      { id: "call-3", name: "read_file", input: { path: "c.ts" } },
    ],
    nativeAssistantReplay: {
      provider: "google",
      parts: [
        { functionCall: { name: "read_file", args: { path: "a.ts" } } },
        { functionCall: { name: "read_file", args: { path: "b.ts" } } },
        { functionCall: { name: "read_file", args: { path: "c.ts" } } },
      ],
    },
  });
}

/** A replayed-round budget of 100 tokens with no safety buffer. */
const REPLAY_BUDGET: IPromptBudget = {
  model: "gpt-4",
  totalBudgetTokens: 100,
  safetyBufferTokens: 0,
  sections: { system: 100, plan: 100, portalKnowledge: 100, memory: 100, skills: 100, loopHistory: 100 },
};

/** Measures only a replayed round, so the first request stays unmeasured as in production. */
function measureReplayedRound(
  totalTokens: number,
): (prompt: string, options: IModelOptions) => Promise<INativeInputMeasurement> {
  return (_prompt, options) =>
    Promise.resolve(
      options.priorRound === undefined
        ? {
          totalTokens: 0,
          sections: { system: 0, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: 0 },
          tokenSource: "tokenizer_estimate",
        }
        : {
          totalTokens,
          sections: { system: 0, plan: 0, portalKnowledge: 0, memory: 0, skills: 0, loopHistory: totalTokens },
          tokenSource: "tokenizer_estimate",
        },
    );
}

Deno.test("[planning_tool_loop][parallel-replay] a three-call replayed round one token over budget is refused before the next generate", async () => {
  registerParallelReplayProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: () => ({ success: true, data: {} }),
    });
    const generate = new ScriptedGenerate([
      twoCallParallelResponse(["call-1", "call-2"]),
      makeGenerateResult("unused"),
    ]);
    const loop = new PlanningToolLoop(makeDeps({
      toolRegistry: registry,
      generate: generate.generate,
      providerId: PARALLEL_REPLAY_PROVIDER_ID,
      measureInputTokens: measureReplayedRound(101),
    }));

    await assertRejects(
      () => loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]), promptBudget: REPLAY_BUDGET })),
      ContextBudgetExceededError,
    );
    assertEquals(generate.calls.length, 1, "the over-budget replayed round must not reach generate()");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop][parallel-replay] a three-call replayed round exactly at the budget is sent", async () => {
  registerParallelReplayProvider();
  try {
    const registry = new StubToolRegistry([fixtureTool("read_file")], {
      read_file: () => ({ success: true, data: {} }),
    });
    const generate = new ScriptedGenerate([threeCallParallelResponse(), makeGenerateResult("plan")]);
    const loop = new PlanningToolLoop(makeDeps({
      toolRegistry: registry,
      generate: generate.generate,
      providerId: PARALLEL_REPLAY_PROVIDER_ID,
      measureInputTokens: measureReplayedRound(100),
    }));

    await loop.run(makeOptions({ maxRounds: 2, allowedTools: new Set(["read_file"]), promptBudget: REPLAY_BUDGET }));

    assertEquals(generate.calls.length, 2, "a round at the limit is within budget");
  } finally {
    ProviderRegistry.clear();
  }
});

Deno.test("[planning_tool_loop] a refused round journals agent.response_refused with its stop reason", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const logger = new EventLogger({ db });
    const refused: IGenerateResult = { ...makeGenerateResult(""), stop_reason: "refusal" };
    const generate = new ScriptedGenerate([refused]);
    const loop = new PlanningToolLoop(
      makeDeps({ toolRegistry: new StubToolRegistry(), generate: generate.generate, logger }),
    );
    const traceId = crypto.randomUUID();

    await loop.run(makeOptions({ maxRounds: 1, traceId }));
    await db.waitForFlush();

    const refusals = db.getActivitiesByTrace(traceId).filter((r) => r.action_type === AGENT_EVENT_RESPONSE_REFUSED);
    assertEquals(refusals.length, 1, "a refused round must leave one refusal row, so the empty plan is attributable");
    assertStringIncludes(refusals[0].payload, "refusal");
  } finally {
    await cleanup();
  }
});
