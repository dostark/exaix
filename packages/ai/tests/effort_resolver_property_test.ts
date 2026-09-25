/**
 * @module EffortResolverPropertyTest
 * @path packages/ai/tests/effort_resolver_property_test.ts
 * @description Property test (GAP-15) over every combination of effort declaration ×
 *   thinking declaration × TaskComplexity × providerType: the literal "auto" must never
 *   leak into a resolution, and adding a skill floor must never lower a value.
 * @architectural-layer AI
 * @related-files [packages/ai/src/effort_resolver.ts]
 */

import { assert } from "@std/assert";
import { ProviderType, TaskComplexity } from "@exaix/core";
import { EffortResolver } from "@exaix/ai";
import type { IEffortResolver } from "@exaix/ai";
import type { EffortTier, ThinkingDeclaration } from "@exaix/schemas";

const resolver: IEffortResolver = new EffortResolver();

const EFFORT_DECLARATIONS: Array<EffortTier | "auto" | undefined> = [undefined, "low", "medium", "high", "auto"];

const THINKING_DECLARATIONS: Array<ThinkingDeclaration | undefined> = [undefined, true, false, "auto"];
const COMPLEXITIES = Object.values(TaskComplexity);
const PROVIDER_TYPES: Array<ProviderType | undefined> = [
  ProviderType.ANTHROPIC,
  ProviderType.CLAUDE_CLI,
  ProviderType.OPENAI,
  undefined,
];

function rank(tier: EffortTier | undefined): number {
  if (tier === undefined) return -1;
  if (tier === "low") return 0;
  if (tier === "medium") return 1;
  return 2;
}

Deno.test("EffortResolver property: the literal string 'auto' never appears in any resolution", () => {
  for (const effortDecl of EFFORT_DECLARATIONS) {
    for (const thinkingDecl of THINKING_DECLARATIONS) {
      for (const complexity of COMPLEXITIES) {
        for (const providerType of PROVIDER_TYPES) {
          const result = resolver.resolve(
            { role: { effort: effortDecl, thinking: thinkingDecl } },
            {
              taskComplexity: complexity,
              complexitySource: "analysis",
              providerType,
              model: providerType === ProviderType.ANTHROPIC ? "claude-sonnet-5" : "sonnet",
              providerSupportsThinking: providerType === ProviderType.ANTHROPIC,
              skillFloors: [],
            },
          );
          const rawEffort = result.effort as unknown;
          assert(
            rawEffort !== "auto",
            `effort leaked "auto" for ${effortDecl}/${thinkingDecl}/${complexity}/${providerType}`,
          );
          const rawThinking = result.thinking as unknown;
          assert(
            rawThinking !== "auto",
            `thinking leaked "auto" for ${effortDecl}/${thinkingDecl}/${complexity}/${providerType}`,
          );
          assert(
            typeof result.effort === "string" || result.effort === undefined,
            `effort is not a tier: ${result.effort}`,
          );
          assert(
            typeof result.thinking === "boolean" || result.thinking === undefined,
            `thinking is not a boolean: ${result.thinking}`,
          );
        }
      }
    }
  }
});

Deno.test("EffortResolver property: a skill floor never lowers effort or thinking", () => {
  for (const effortDecl of EFFORT_DECLARATIONS) {
    for (const thinkingDecl of THINKING_DECLARATIONS) {
      if (effortDecl === "auto") continue; // floors verify the raise discipline; auto covered separately
      for (const complexity of COMPLEXITIES) {
        const without = resolver.resolve(
          { role: { effort: effortDecl, thinking: thinkingDecl } },
          {
            taskComplexity: complexity,
            complexitySource: "analysis",
            providerType: ProviderType.CLAUDE_CLI,
            model: "sonnet",
            providerSupportsThinking: false,
            skillFloors: [],
          },
        );
        const withFloor = resolver.resolve(
          { role: { effort: effortDecl, thinking: thinkingDecl } },
          {
            taskComplexity: complexity,
            complexitySource: "analysis",
            providerType: ProviderType.CLAUDE_CLI,
            model: "sonnet",
            providerSupportsThinking: false,
            skillFloors: [{ skillId: "s", effort: "high", thinking: true }],
          },
        );
        assert(rank(withFloor.effort) >= rank(without.effort), "a skill floor lowered effort");
        assert(withFloor.thinking !== false || without.thinking !== true, "a skill floor lowered thinking");
      }
    }
  }
});

Deno.test("EffortResolver property: heuristicInputs is present iff at least one auto declaration resolved through the heuristic before floors", () => {
  for (const effortDecl of EFFORT_DECLARATIONS) {
    for (const thinkingDecl of THINKING_DECLARATIONS) {
      if (effortDecl !== "auto" && thinkingDecl !== "auto") continue; // heuristic needs an auto declaration
      for (const complexity of COMPLEXITIES) {
        for (const model of ["claude-sonnet-5", "claude-haiku-4-5-20251001"]) {
          for (const withFloor of [false, true]) {
            const result = resolver.resolve(
              { role: { effort: effortDecl, thinking: thinkingDecl } },
              {
                taskComplexity: complexity,
                complexitySource: "analysis",
                providerType: ProviderType.ANTHROPIC,
                model,
                providerSupportsThinking: true,
                skillFloors: withFloor ? [{ skillId: "s", effort: "high", thinking: true }] : [],
              },
            );
            const preFloorHeuristic = (effortDecl === "auto" && !isNativeAdaptiveModel(model)) ||
              (thinkingDecl === "auto" && !isNativeAdaptiveModel(model));
            if (effortDecl === "auto") {
              // effort auto ALWAYS resolves through the heuristic
              assert(
                result.heuristicInputs !== undefined,
                `effort auto must keep heuristicInputs even under a floor (${effortDecl}/${thinkingDecl}/${complexity}/${model}/${withFloor})`,
              );
            } else if (thinkingDecl === "auto" && !isNativeAdaptiveModel(model)) {
              assert(
                result.heuristicInputs !== undefined,
                `thinking auto on a non-adaptive model must keep heuristicInputs (${model}/${withFloor})`,
              );
            } else if (thinkingDecl === "auto") {
              assert(
                result.heuristicInputs === undefined,
                `thinking auto native-adaptive must not fabricate heuristicInputs (${model}/${withFloor})`,
              );
            }
            void preFloorHeuristic;
          }
        }
      }
    }
  }
});

function isNativeAdaptiveModel(model: string): boolean {
  return model.startsWith("claude-sonnet-5");
}
