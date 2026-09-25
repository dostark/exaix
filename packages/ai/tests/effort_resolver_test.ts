/**
 * @module EffortResolverTest
 * @path packages/ai/tests/effort_resolver_test.ts
 * @description Verifies EffortResolver turns declaration-time effort/thinking values
 *   (including "auto") into a concrete provider-facing resolution, per step 1 of
 *   phase-197: concrete declarations pass through unchanged, thinking auto defers to
 *   native-adaptive on Anthropic's adaptive models, effort auto always resolves through
 *   the TaskComplexity heuristic, and modelSize S caps tiny-model effort.
 * @architectural-layer AI
 * @related-files [packages/ai/src/effort_resolver.ts, packages/schemas/src/model_intent.ts]
 */

import { assertEquals } from "@std/assert";
import { ProviderType, TaskComplexity } from "@exaix/core";
import { EffortResolver } from "@exaix/ai";
import type { IEffortDeclarationPair, IEffortResolutionSignals } from "@exaix/ai";
import type { EffortTier } from "@exaix/schemas";

const resolver = new EffortResolver();

function baseSignals(overrides: Partial<IEffortResolutionSignals> = {}): IEffortResolutionSignals {
  return {
    taskComplexity: TaskComplexity.MEDIUM,
    complexitySource: "analysis",
    providerType: ProviderType.ANTHROPIC,
    model: "claude-sonnet-5",
    providerSupportsThinking: true,
    skillFloors: [],
    ...overrides,
  };
}

function resolve(
  declared: IEffortDeclarationPair,
  overrides: Partial<IEffortResolutionSignals> = {},
) {
  return resolver.resolve({ role: declared }, baseSignals(overrides));
}

Deno.test("EffortResolver: a concrete effort declaration passes through unchanged with basis declared", () => {
  const result = resolve({ effort: "high" });
  assertEquals(result.effort, "high" as EffortTier);
  assertEquals(result.effortBasis, "declared");
  assertEquals(result.concreteDeclaration, true);
});

Deno.test("EffortResolver: a concrete thinking declaration passes through unchanged", () => {
  const result = resolve({ thinking: false });
  assertEquals(result.thinking, false);
  assertEquals(result.thinkingBasis, "declared");
});

Deno.test("EffortResolver: thinking auto + ANTHROPIC + claude-sonnet-5 resolves native-adaptive (field omitted)", () => {
  const result = resolve({ thinking: "auto" });
  assertEquals(result.thinking, undefined);
  assertEquals(result.thinkingBasis, "native-adaptive");
});

Deno.test("EffortResolver: thinking auto + claude-haiku-4-5-20251001 falls back to the heuristic", () => {
  const result = resolve({ thinking: "auto" }, { model: "claude-haiku-4-5-20251001" });
  assertEquals(result.thinkingBasis, "heuristic");
  assertEquals(result.thinking, undefined); // MEDIUM heuristic entry is false, never an explicit disable
});

Deno.test("EffortResolver: thinking auto + anthropicThinkingDefault false falls back to the heuristic", () => {
  const result = resolve({ thinking: "auto" }, { anthropicThinkingDefault: false });
  assertEquals(result.thinkingBasis, "heuristic");
  assertEquals(result.thinking, undefined);
});

Deno.test("EffortResolver: effort auto resolves through the heuristic for all four TaskComplexity values on ANTHROPIC", () => {
  const cases: Array<[TaskComplexity, EffortTier]> = [
    [TaskComplexity.SIMPLE, "low"],
    [TaskComplexity.MEDIUM, "medium"],
    [TaskComplexity.COMPLEX, "high"],
    [TaskComplexity.EPIC, "high"],
  ];
  for (const [complexity, expected] of cases) {
    const result = resolve({ effort: "auto" }, { taskComplexity: complexity });
    assertEquals(result.effort, expected, `complexity ${complexity} must resolve to ${expected}`);
    assertEquals(result.effortBasis, "heuristic");
    assertEquals(result.heuristicInputs?.taskComplexity, complexity);
    assertEquals(result.concreteDeclaration, false);
  }
});

Deno.test("EffortResolver: effort auto resolves through the heuristic on CLAUDE_CLI too", () => {
  const result = resolve({ effort: "auto" }, { providerType: ProviderType.CLAUDE_CLI, model: "sonnet" });
  assertEquals(result.effort, "medium");
  assertEquals(result.effortBasis, "heuristic");
});

Deno.test("EffortResolver: modelSize S caps auto-resolved effort at medium for COMPLEX", () => {
  const result = resolve({ effort: "auto" }, { taskComplexity: TaskComplexity.COMPLEX, modelSize: "S" });
  assertEquals(result.effort, "medium" as EffortTier);
  assertEquals(result.heuristicInputs?.modelSize, "S");
});

Deno.test("EffortResolver: thinking auto + COMPLEX on a provider without thinking support resolves undefined, never false", () => {
  const result = resolve({ thinking: "auto" }, {
    taskComplexity: TaskComplexity.COMPLEX,
    providerType: ProviderType.CLAUDE_CLI,
    model: "sonnet",
    providerSupportsThinking: false,
  });
  assertEquals(result.thinking, undefined);
});

Deno.test("EffortResolver: no declaration anywhere resolves unset (field omitted)", () => {
  const result = resolve({});
  assertEquals(result.effort, undefined);
  assertEquals(result.thinking, undefined);
  assertEquals(result.effortBasis, "unset");
  assertEquals(result.thinkingBasis, "unset");
  assertEquals(result.declarationSource, "none");
});

Deno.test("EffortResolver: a concrete role effort with thinking empty resolves effort declared and thinking unset", () => {
  const result = resolve({ effort: "low" });
  assertEquals(result.effort, "low" as EffortTier);
  assertEquals(result.effortBasis, "declared");
  assertEquals(result.thinking, undefined);
  assertEquals(result.thinkingBasis, "unset");
});

Deno.test("EffortResolver: a skill effort floor raises a low heuristic result to medium", () => {
  const signals = baseSignals({ taskComplexity: TaskComplexity.SIMPLE });
  const result = resolver.resolve(
    { role: { effort: "auto" } },
    { ...signals, skillFloors: [{ skillId: "sc", effort: "medium" }] },
  );
  assertEquals(result.effort, "medium" as EffortTier);
  assertEquals(result.effortBasis, "skill-floor");
  assertEquals(result.floorsApplied, ["sc"]);
});

Deno.test("EffortResolver: a skill effort floor raises unset to medium", () => {
  const result = resolver.resolve(
    { role: {} },
    { ...baseSignals(), skillFloors: [{ skillId: "sc", effort: "medium" }] },
  );
  assertEquals(result.effort, "medium" as EffortTier);
  assertEquals(result.effortBasis, "skill-floor");
});

Deno.test("EffortResolver: a skill effort floor never lowers high", () => {
  const result = resolver.resolve(
    { role: { effort: "high" } },
    { ...baseSignals(), skillFloors: [{ skillId: "sc", effort: "medium" }] },
  );
  assertEquals(result.effort, "high" as EffortTier);
  assertEquals(result.effortBasis, "declared");
  assertEquals(result.floorsApplied, []);
});

Deno.test("EffortResolver: thinking floors OR together across skills", () => {
  const result = resolver.resolve(
    { role: {} },
    {
      ...baseSignals(),
      providerType: ProviderType.CLAUDE_CLI,
      model: "sonnet",
      skillFloors: [
        { skillId: "a", thinking: false },
        { skillId: "b", thinking: true },
      ],
    },
  );
  assertEquals(result.thinking, true);
  assertEquals(result.thinkingBasis, "skill-floor");
});

Deno.test("EffortResolver: an explicit request-level low is NOT raised by a skill floor", () => {
  const result = resolver.resolve(
    { request: { effort: "low" }, role: { effort: "high" } },
    { ...baseSignals(), skillFloors: [{ skillId: "sc", effort: "medium" }] },
  );
  assertEquals(result.effort, "low" as EffortTier);
  assertEquals(result.effortBasis, "declared");
  assertEquals(result.declarationSource, "request");
  assertEquals(result.floorsApplied, []);
});
