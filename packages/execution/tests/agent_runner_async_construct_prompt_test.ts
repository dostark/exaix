/**
 * @module AgentRunnerAsyncConstructPromptTest
 * @path packages/execution/tests/agent_runner_async_construct_prompt_test.ts
 * @description Tests for Step 7: IAgentRunner.constructPrompt() budget integration.
 * Verifies that prepare() is called when contextBudgetManager is configured, that
 * segment kinds are assigned correctly by source (not by index), and that the
 * prompt is returned unchanged when no manager is configured.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/agent_runner.ts",
 *   "packages/execution/src/context/context_budget_manager.ts"
 * ]
 */

import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AgentRunner, type IBlueprint, type IContextBudgetManagerInput, type IParsedRequest } from "@exaix/execution";
import { MEMORY_CONTEXT_KEY, PORTAL_KNOWLEDGE_KEY, PromptBudgetAllocator } from "@exaix/core";
import { PlanAdapter } from "@exaix/core/planning";
import type { ITokenizer } from "@exaix/core/func";
import type { IContextBudgetManager, IContextBudgetManagerOutput } from "@exaix/execution";

// Helpers

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";

function makeBlueprint(systemPrompt = "You are a test agent."): IBlueprint {
  return { systemPrompt };
}

function makeRequest(overrides: Partial<IParsedRequest> = {}): IParsedRequest {
  return { userPrompt: "User question here.", context: {}, ...overrides };
}

function makeCapturingManager(): { manager: IContextBudgetManager; captured: IContextBudgetManagerInput[] } {
  const captured: IContextBudgetManagerInput[] = [];
  const manager: IContextBudgetManager = {
    prepare(input: IContextBudgetManagerInput): Promise<IContextBudgetManagerOutput> {
      captured.push(input);
      return Promise.resolve({
        segments: input.segments,
        snapshot: {
          stepId: input.stepId,
          traceId: input.traceId,
          model: input.model,
          decisions: input.segments.map((s) => ({
            segmentId: s.segmentId,
            kind: s.kind,
            action: "keep" as const,
            originalTokens: s.tokenEstimate,
            resultingTokens: s.tokenEstimate,
            reason: "pass-through",
            createdAt: new Date().toISOString(),
          })),
          usedInputTokens: input.segments.reduce((sum, s) => sum + s.tokenEstimate, 0),
          usedOutputTokens: 0,
          maxContextTokens: 0,
          overflowRecovered: false,
          createdAt: new Date().toISOString(),
        },
      });
    },
  };
  return { manager, captured };
}

/** A tokenizer stub returning a fixed value no chars/4 heuristic on any real
 *  segment content would ever produce — proves tokenEstimate came from the
 *  injected tokenizer, not the fallback estimator. */
function makeStubTokenizer(): ITokenizer {
  const DISTINCTIVE_TOKEN_COUNT = 999;
  return {
    countTokens: (_text: string, _model: string) => Promise.resolve(DISTINCTIVE_TOKEN_COUNT),
    countTokensBatch: (texts: string[], _model: string) => Promise.resolve(texts.map(() => DISTINCTIVE_TOKEN_COUNT)),
  };
}

function makeDropFirstManager(): IContextBudgetManager {
  return {
    prepare(input: IContextBudgetManagerInput): Promise<IContextBudgetManagerOutput> {
      const [_dropped, ...rest] = input.segments;
      return Promise.resolve({
        segments: rest,
        snapshot: {
          stepId: input.stepId,
          traceId: input.traceId,
          model: input.model,
          decisions: [],
          usedInputTokens: 0,
          usedOutputTokens: 0,
          maxContextTokens: 0,
          overflowRecovered: false,
          createdAt: new Date().toISOString(),
        },
      });
    },
  };
}

// Tests

Deno.test("[IAgentRunner] constructPrompt calls contextBudgetManager.prepare() when configured", async () => {
  const { manager, captured } = makeCapturingManager();

  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  await runner.run(makeBlueprint(), makeRequest(), undefined);

  assertEquals(captured.length, 1);
  assertEquals(captured[0].stepId, "agent-runner");
});

Deno.test("[IAgentRunner] constructPrompt does NOT call prepare() when no manager configured", async () => {
  const { manager, captured } = makeCapturingManager();

  // Pass manager-less config
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    {}, // no contextBudgetManager
  );

  await runner.run(makeBlueprint(), makeRequest(), undefined);

  assertEquals(captured.length, 0);
  // Suppress unused variable — manager only used to check it was never called
  assertEquals(typeof manager.prepare, "function");
});

Deno.test("[IAgentRunner] system prompt segment gets kind=system", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  await runner.run(makeBlueprint("SYSTEM_TEXT"), makeRequest(), undefined);

  const systemSeg = captured[0].segments.find((s) => s.content === "SYSTEM_TEXT");
  assertEquals(systemSeg?.kind, "system");
});

Deno.test("[IAgentRunner] user prompt segment gets kind=request with priority 75", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  await runner.run(makeBlueprint(), makeRequest({ userPrompt: "USER_PROMPT_TEXT" }), undefined);

  // The segment wraps the raw userPrompt with a "### YOUR TASK" heading (agent_runner.ts) so a
  // real model can't mistake it for trailing skill/example content — assert containment, not
  // exact equality, since the segment content is no longer the bare userPrompt string.
  const userSeg = captured[0].segments.find((s) => s.content.includes("USER_PROMPT_TEXT"));
  assertEquals(userSeg?.kind, "request");
  assertEquals(userSeg?.priority, 75);
});

Deno.test("[IAgentRunner] portal knowledge segment gets kind=portal_knowledge", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  await runner.run(
    makeBlueprint(),
    makeRequest({ context: { [PORTAL_KNOWLEDGE_KEY]: "PORTAL_KNOWLEDGE_TEXT" } }),
    undefined,
  );

  const pkSeg = captured[0].segments.find((s) => s.content === "PORTAL_KNOWLEDGE_TEXT");
  assertEquals(pkSeg?.kind, "portal_knowledge");
});

Deno.test("[IAgentRunner] memory context segment gets kind=reflection", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  await runner.run(
    makeBlueprint(),
    makeRequest({ context: { [MEMORY_CONTEXT_KEY]: "MEMORY_TEXT" } }),
    undefined,
  );

  const memSeg = captured[0].segments.find((s) => s.content === "MEMORY_TEXT");
  assertEquals(memSeg?.kind, "reflection");
});

Deno.test("[IAgentRunner] system prompt kind=system even when it is not at index 0 (empty system prompt)", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  // Blueprint with empty systemPrompt — it should NOT be pushed; no segment should get kind=system
  await runner.run(makeBlueprint(""), makeRequest(), undefined);

  const systemSegs = captured[0].segments.filter((s) => s.kind === "system");
  assertEquals(systemSegs.length, 0, "No system segment when systemPrompt is empty");
});

Deno.test("[IAgentRunner] filtered segments produce shorter prompt when manager drops a segment", async () => {
  // Manager drops the first segment (system prompt)
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: makeDropFirstManager() },
  );

  let capturedPrompt = "";
  const origGenerate = runner["modelProvider"].generate.bind(runner["modelProvider"]);
  runner["modelProvider"].generate = (prompt: string) => {
    capturedPrompt = prompt;
    return origGenerate(prompt);
  };

  const blueprint = makeBlueprint("SYSTEM_SECTION");
  await runner.run(blueprint, makeRequest({ userPrompt: "USER_SECTION" }), undefined);

  // System prompt was dropped by the manager — should not appear in the generated prompt
  assertEquals(capturedPrompt.includes("SYSTEM_SECTION"), false);
  // User prompt was kept — should appear
  assertStringIncludes(capturedPrompt, "USER_SECTION");
});

// Real PromptBudgetAllocator/ITokenizer wiring, replacing the hand-built
// Number.MAX_SAFE_INTEGER budget and the chars/4 tokenEstimate heuristic.

Deno.test("[IAgentRunner] constructPrompt uses a real allocator-produced budget when promptBudgetAllocator is injected", async () => {
  const { manager, captured } = makeCapturingManager();
  const allocator = new PromptBudgetAllocator();

  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager, promptBudgetAllocator: allocator },
  );

  await runner.run(makeBlueprint(), makeRequest(), undefined);

  // A real allocator's budget is derived from a model's finite context window —
  // never the hand-built Number.MAX_SAFE_INTEGER placeholder.
  assertNotEquals(captured[0].promptBudget.totalBudgetTokens, Number.MAX_SAFE_INTEGER);
});

Deno.test("[IAgentRunner] constructPrompt falls back to the hand-built infinite budget when promptBudgetAllocator is absent", async () => {
  const { manager, captured } = makeCapturingManager();

  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager }, // no promptBudgetAllocator
  );

  await runner.run(makeBlueprint(), makeRequest(), undefined);

  assertEquals(captured[0].promptBudget.totalBudgetTokens, Number.MAX_SAFE_INTEGER);
  assertEquals(captured[0].promptBudget.sections.system, Number.MAX_SAFE_INTEGER);
});

Deno.test("[IAgentRunner] segment tokenEstimate comes from the injected tokenizer, not content.length / 4", async () => {
  const { manager, captured } = makeCapturingManager();

  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager, tokenizer: makeStubTokenizer() },
  );

  await runner.run(makeBlueprint("SYSTEM_TEXT"), makeRequest(), undefined);

  const systemSeg = captured[0].segments.find((s) => s.content === "SYSTEM_TEXT");
  assertEquals(systemSeg?.tokenEstimate, 999);
});

Deno.test("[IAgentRunner] segment tokenEstimate falls back to TOKEN_ESTIMATION_CHARS_PER_TOKEN-based estimation when no tokenizer is injected", async () => {
  const { manager, captured } = makeCapturingManager();

  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager }, // no tokenizer
  );

  await runner.run(makeBlueprint("SYSTEM_TEXT"), makeRequest(), undefined);

  const systemSeg = captured[0].segments.find((s) => s.content === "SYSTEM_TEXT");
  // "SYSTEM_TEXT" is 11 chars; chars/4 estimation ceils to 3.
  assertEquals(systemSeg?.tokenEstimate, Math.ceil("SYSTEM_TEXT".length / 4));
});

Deno.test("[IAgentRunner] the 2-arg provider form leaves schema instructions empty (the gap this fix closes)", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager }, // 2-arg form: real PlanAdapter never wired
  );
  await runner.run(makeBlueprint(), makeRequest(), undefined);
  const schemaSeg = captured[0].segments.find((s) => s.kind === "acceptance_criteria");
  assert(schemaSeg, "schema-instructions segment must exist in the planning call");
  assertEquals(schemaSeg.content.length, 0, "noop adapter leaves schema instructions empty");
});

Deno.test("[IAgentRunner] the 3-arg form with a real PlanAdapter injects the planning schema instructions into the prompt", async () => {
  const { manager, captured } = makeCapturingManager();
  const planAdapter = new PlanAdapter();
  const runner = new AgentRunner(
    planAdapter, // 3-arg form: real adapter is wired through
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );
  await runner.run(makeBlueprint(), makeRequest(), undefined);
  const schemaSeg = captured[0].segments.find((s) => s.kind === "acceptance_criteria");
  assert(schemaSeg, "schema-instructions segment must exist in the planning call");
  assertEquals(schemaSeg.content.length > 0, true, "a real PlanAdapter must inject its schema instructions");
  assertStringIncludes(schemaSeg.content, "PLANNING phase", "instructions must describe the planning phase");
});
