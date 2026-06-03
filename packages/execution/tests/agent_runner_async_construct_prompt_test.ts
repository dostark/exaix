/**
 * @module AgentRunnerAsyncConstructPromptTest
 * @path packages/execution/tests/agent_runner_async_construct_prompt_test.ts
 * @description Tests for Step 7: AgentRunner.constructPrompt() budget integration.
 * Verifies that prepare() is called when contextBudgetManager is configured, that
 * segment kinds are assigned correctly by source (not by index), and that the
 * prompt is returned unchanged when no manager is configured.
 * @architectural-layer Tests
 * @related-files [
 *   "packages/execution/src/agent_runner.ts",
 *   "packages/execution/src/context/context_budget_manager.ts"
 * ]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import { AgentRunner, type IBlueprint, type IContextBudgetManagerInput, type IParsedRequest } from "@exaix/execution";
import { MEMORY_CONTEXT_KEY, PORTAL_KNOWLEDGE_KEY } from "@exaix/core";
import type { IContextBudgetManager, IContextBudgetManagerOutput } from "@exaix/execution";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────────

Deno.test("[AgentRunner] constructPrompt calls contextBudgetManager.prepare() when configured", async () => {
  const { manager, captured } = makeCapturingManager();

  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  await runner.run(makeBlueprint(), makeRequest());

  assertEquals(captured.length, 1);
  assertEquals(captured[0].stepId, "agent-runner");
});

Deno.test("[AgentRunner] constructPrompt does NOT call prepare() when no manager configured", async () => {
  const { manager, captured } = makeCapturingManager();

  // Pass manager-less config
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    {}, // no contextBudgetManager
  );

  await runner.run(makeBlueprint(), makeRequest());

  assertEquals(captured.length, 0);
  // Suppress unused variable — manager only used to check it was never called
  assertEquals(typeof manager.prepare, "function");
});

Deno.test("[AgentRunner] system prompt segment gets kind=system", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  await runner.run(makeBlueprint("SYSTEM_TEXT"), makeRequest());

  const systemSeg = captured[0].segments.find((s) => s.content === "SYSTEM_TEXT");
  assertEquals(systemSeg?.kind, "system");
});

Deno.test("[AgentRunner] user prompt segment gets kind=request with priority 75", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  await runner.run(makeBlueprint(), makeRequest({ userPrompt: "USER_PROMPT_TEXT" }));

  const userSeg = captured[0].segments.find((s) => s.content === "USER_PROMPT_TEXT");
  assertEquals(userSeg?.kind, "request");
  assertEquals(userSeg?.priority, 75);
});

Deno.test("[AgentRunner] portal knowledge segment gets kind=portal_knowledge", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  await runner.run(
    makeBlueprint(),
    makeRequest({ context: { [PORTAL_KNOWLEDGE_KEY]: "PORTAL_KNOWLEDGE_TEXT" } }),
  );

  const pkSeg = captured[0].segments.find((s) => s.content === "PORTAL_KNOWLEDGE_TEXT");
  assertEquals(pkSeg?.kind, "portal_knowledge");
});

Deno.test("[AgentRunner] memory context segment gets kind=reflection", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  await runner.run(
    makeBlueprint(),
    makeRequest({ context: { [MEMORY_CONTEXT_KEY]: "MEMORY_TEXT" } }),
  );

  const memSeg = captured[0].segments.find((s) => s.content === "MEMORY_TEXT");
  assertEquals(memSeg?.kind, "reflection");
});

Deno.test("[AgentRunner] system prompt kind=system even when it is not at index 0 (empty system prompt)", async () => {
  const { manager, captured } = makeCapturingManager();
  const runner = new AgentRunner(
    new MockProvider(WELL_FORMED_RESPONSE),
    { contextBudgetManager: manager },
  );

  // Blueprint with empty systemPrompt — it should NOT be pushed; no segment should get kind=system
  await runner.run(makeBlueprint(""), makeRequest());

  const systemSegs = captured[0].segments.filter((s) => s.kind === "system");
  assertEquals(systemSegs.length, 0, "No system segment when systemPrompt is empty");
});

Deno.test("[AgentRunner] filtered segments produce shorter prompt when manager drops a segment", async () => {
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
  await runner.run(blueprint, makeRequest({ userPrompt: "USER_SECTION" }));

  // System prompt was dropped by the manager — should not appear in the generated prompt
  assertEquals(capturedPrompt.includes("SYSTEM_SECTION"), false);
  // User prompt was kept — should appear
  assertStringIncludes(capturedPrompt, "USER_SECTION");
});
