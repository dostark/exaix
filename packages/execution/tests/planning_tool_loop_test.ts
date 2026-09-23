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

import { assert, assertEquals, assertExists } from "@std/assert";
import { PlanningToolLoop } from "../src/planning_tool_loop.ts";
import type { IPlanningToolLoopDeps, IPlanningToolLoopOptions } from "../src/planning_tool_loop.ts";
import type { ICallSite, IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import { PlanningToolLoopStopReason } from "@exaix/core";
import { AiTokenEstimatorTokenizer } from "@exaix/core/func";
import { DomainEventType } from "@exaix/core/events";
import { EventLogger } from "@exaix/core/logger";
import { initTestDbService } from "@exaix/testing";
import { makeGenerateResult } from "@exaix/testing";

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
    traceId: "trace-1",
    ...overrides,
  };
}

// Round protocol

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

Deno.test("[planning_tool_loop] exploration rounds use toolChoice auto with parallel disabled, never any/tool", async () => {
  const registry = new StubToolRegistry([fixtureTool("read_file")], {
    read_file: () => ({ success: true, data: {} }),
  });
  const round1 = makeGenerateResult("", { toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.ts" } }] });
  const round2 = makeGenerateResult("<thought>t</thought><content>plan</content>");
  const generate = new ScriptedGenerate([round1, round2]);
  const loop = new PlanningToolLoop(makeDeps({ toolRegistry: registry, generate: generate.generate }));

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
