// deno-lint-ignore-file no-explicit-any
/**
 * @module AgentRunnerPreviewPromptTest
 * @path packages/execution/tests/agent_runner_preview_prompt_test.ts
 * @description Phase 196 Step 8 — proves AgentRunner.previewPrompt() shares the same
 *   segment-assembly logic as constructPrompt (no forked duplicate logic), reports
 *   compactionTriggered/dropped segments correctly under a tight budget, and matches
 *   the real skill-matching result via matchedSkillIds.
 * @architectural-layer Test
 * @related-files [packages/execution/src/agent_runner.ts, packages/schemas/src/prompt_budget.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { MockProvider } from "@exaix/ai/providers.ts";
import {
  AgentRunner,
  ContextBudgetManager,
  type IBlueprint,
  type IContextBudgetManager,
  type IContextBudgetManagerInput,
  type IContextBudgetManagerOutput,
  type IContextSegment,
  type IParsedRequest,
} from "@exaix/execution";
import { PromptBudgetAllocator } from "@exaix/core";

const WELL_FORMED_RESPONSE = "<thought>ok</thought><content>done</content>";

Deno.test("[AgentRunner.previewPrompt] returns a per-segment breakdown matching constructPrompt's own assembly (no forked logic)", async () => {
  // Record the exact stages prepare() receives on the constructPrompt path, so the
  // preview's segment set can be compared field-by-field against it (no forked logic).
  const capturedPrepare = new Map<string, IContextSegment[]>();
  const capturingManager: IContextBudgetManager = {
    prepare(input: IContextBudgetManagerInput): Promise<IContextBudgetManagerOutput> {
      capturedPrepare.set(input.stepId, input.segments);
      return Promise.resolve({
        segments: input.segments,
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

  const runner = new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
    contextBudgetManager: capturingManager,
  });

  const blueprint: IBlueprint = { systemPrompt: "SYSTEM_PROMPT_TEXT" };
  const request: IParsedRequest = { userPrompt: "USER_TASK_TEXT", context: {} };

  // Drive the constructPrompt path via run(): it calls assemblePromptSegments → prepare().
  await runner.run(blueprint, request, undefined);

  const preview = await runner.previewPrompt(blueprint, request);

  const constructSegments = capturedPrepare.get("agent-runner");
  assert(constructSegments, "run() must have reached prepare() with the 'agent-runner' segments");

  // Same segment count, and every segment matches by kind/priority/tokenEstimate —
  // the preview is a faithful view of the very segments constructPrompt assembled.
  assertEquals(preview.segments.length, constructSegments.length);
  const previewByKind = new Map(preview.segments.map((s) => [s.kind, s]));
  for (const seg of constructSegments) {
    const previewSeg = previewByKind.get(seg.kind);
    assert(previewSeg, `segment kind "${seg.kind}" from constructPrompt must appear in the preview`);
    assertEquals(previewSeg.priority, seg.priority);
    assertEquals(previewSeg.tokenEstimate, seg.tokenEstimate);
    assertEquals(previewSeg.nonCompactable, seg.metadata.nonCompactable ?? false);
  }

  const systemSeg = preview.segments.find((s) => s.kind === "system");
  assert(systemSeg, "a system segment must be present in the preview");
  assertEquals(systemSeg!.included, true);
  assertEquals(preview.compactionTriggered, false);
  assertEquals(preview.totalTokenEstimate, preview.segments.reduce((sum, s) => sum + s.tokenEstimate, 0));
});

Deno.test("[AgentRunner.previewPrompt] reports compactionTriggered: true and the correct dropped segment under a tight cost ceiling", async () => {
  const contextBudgetManager = new ContextBudgetManager();
  const promptBudgetAllocator = new PromptBudgetAllocator({ costTargetTokens: 10_000 });
  const runner = new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
    contextBudgetManager,
    promptBudgetAllocator,
  });

  const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
  const request: IParsedRequest = {
    userPrompt: "Do the thing.",
    context: { portal_knowledge: "x".repeat(50_000) },
  };

  const preview = await runner.previewPrompt(blueprint, request);

  assertEquals(preview.compactionTriggered, true);
  const portalSeg = preview.segments.find((s) => s.kind === "portal_knowledge");
  assert(portalSeg, "the portal_knowledge segment must be present in the full breakdown even when trimmed");
  assert(portalSeg.originalTokenEstimate > portalSeg.resultingTokenEstimate);
  assertEquals(
    preview.totalTokenEstimate,
    preview.segments.reduce((sum, segment) => sum + segment.resultingTokenEstimate, 0),
  );
});

Deno.test("[AgentRunner.previewPrompt] dropped segments contribute zero final tokens and bytes", async () => {
  const droppingManager: IContextBudgetManager = {
    prepare(input) {
      return Promise.resolve({
        segments: input.segments.filter((segment) => segment.kind !== "system"),
        snapshot: {
          traceId: input.traceId,
          stepId: input.stepId,
          model: input.model,
          maxContextTokens: input.promptBudget.totalBudgetTokens,
          usedInputTokens: 0,
          decisions: [],
          overflowRecovered: false,
        },
      });
    },
  };
  const runner = new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
    contextBudgetManager: droppingManager,
  });

  const preview = await runner.previewPrompt(
    { systemPrompt: "system content" },
    { userPrompt: "task", context: {} },
  );
  const system = preview.segments.find((segment) => segment.kind === "system");

  assert(system);
  assert(system.originalTokenEstimate > 0);
  assertEquals(system.resultingTokenEstimate, 0);
  assertEquals(system.resultingByteLength, 0);
  assertEquals(system.included, false);
});

Deno.test("[AgentRunner.previewPrompt] selected model pricing produces a prompt-only estimate", async () => {
  const runner = new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
    selectedModel: { provider: "openai", model: "gpt-4o-mini" },
  });

  const preview = await runner.previewPrompt(
    { systemPrompt: "system content" },
    { userPrompt: "task", context: {} },
  );

  assert(preview.estimatedCostUsd !== undefined);
  assert(preview.estimatedCostUsd > 0);
});

Deno.test("[AgentRunner.previewPrompt] compactionTriggered is false and all segments included when the budget is not tight", async () => {
  const contextBudgetManager = new ContextBudgetManager();
  const promptBudgetAllocator = new PromptBudgetAllocator();
  const runner = new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
    contextBudgetManager,
    promptBudgetAllocator,
  });

  const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
  const request: IParsedRequest = { userPrompt: "Do the thing.", context: {} };

  const preview = await runner.previewPrompt(blueprint, request);

  assertEquals(preview.compactionTriggered, false);
  assert(preview.segments.every((s) => s.included));
});

Deno.test("[AgentRunner.previewPrompt] matchedSkillIds reflects the real skill-matching result for a fixture", async () => {
  const skillsSvc = {
    recordSkillUsage: () => Promise.resolve(),
    matchSkills: () =>
      Promise.resolve({
        matches: [{ skillId: "matched-skill-id", confidence: 1.0, matchedTriggers: {} }],
        totalAvailable: 1,
      }),
    buildSkillContext: (_ids: string[]) => Promise.resolve("context"),
    getSkill: (id: string) =>
      Promise.resolve({
        id,
        name: id,
        description: "A test skill.",
        instructions: "Do the thing.",
        triggers: {},
        critical: false,
      } as any),
    initialize: () => Promise.resolve(),
  };

  const runner = new AgentRunner(new MockProvider(WELL_FORMED_RESPONSE), {
    skillsService: skillsSvc as any,
    disableSkills: false,
  });

  const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
  const request: IParsedRequest = { userPrompt: "Do the thing.", context: {}, skills: ["matched-skill-id"] };

  const preview = await runner.previewPrompt(blueprint, request);

  assertEquals(preview.matchedSkillIds, ["matched-skill-id"]);
});

Deno.test("[AgentRunner.previewPrompt] does not construct a real LLM call (no mutation, no generate() invocation)", async () => {
  let generateCalled = false;
  const provider = new MockProvider(WELL_FORMED_RESPONSE);
  const origGenerate = provider.generate.bind(provider);
  provider.generate = (...args: Parameters<typeof origGenerate>) => {
    generateCalled = true;
    return origGenerate(...args);
  };

  const runner = new AgentRunner(provider, { contextBudgetManager: new ContextBudgetManager() });
  const blueprint: IBlueprint = { systemPrompt: "You are a test agent." };
  const request: IParsedRequest = { userPrompt: "Do the thing.", context: {} };

  await runner.previewPrompt(blueprint, request);

  assertEquals(generateCalled, false, "previewPrompt must never invoke the LLM provider");
});
