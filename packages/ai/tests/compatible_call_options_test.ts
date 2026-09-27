/**
 * @module CompatibleCallOptionsTest
 * @path packages/ai/tests/compatible_call_options_test.ts
 * @description Verifies provider capability projection omits unsupported controls while preserving token budgets.
 * @architectural-layer Tests
 * @dependencies [@exaix/ai]
 * @related-files [packages/ai/src/provider_call_options.ts]
 */
import { assertEquals, assertThrows } from "@std/assert";
import { projectResolvedCallOptions } from "../src/provider_call_options.ts";
import { EffortResolver, type IEffortDeclarations } from "../src/effort_resolver.ts";
import { ProviderType, TaskComplexity } from "@exaix/core";

Deno.test("unsupported role effort stays resolved for budgets but is omitted from wire", () => {
  const declarations: IEffortDeclarations = { role: { effort: "high" } };
  const resolution = new EffortResolver().resolve(declarations, {
    taskComplexity: TaskComplexity.COMPLEX,
    complexitySource: "analysis",
    providerType: ProviderType.OPENAI_CHAT,
    model: "gpt-4.1-mini",
    providerSupportsThinking: false,
    skillFloors: [],
  });
  const projected = projectResolvedCallOptions(resolution, declarations, {
    profile: "openai",
    supportsThinking: false,
    supportedEffortTiers: [],
  });
  assertEquals(projected.effort, undefined);
  assertEquals(projected.reason, "profile_unsupported_effort");
  assertEquals(resolution.effort, "high");
  assertEquals(resolution.concreteDeclaration, true);
});

Deno.test("unsupported concrete request and flow overrides fail while auto remains budget-only", () => {
  for (
    const declarations of [{ request: { effort: "high" as const } }, { flowStep: { effort: "high" as const } }, {
      role: { thinking: true },
    }]
  ) {
    const resolution = new EffortResolver().resolve(declarations, {
      taskComplexity: TaskComplexity.COMPLEX,
      complexitySource: "analysis",
      providerType: ProviderType.OPENAI_CHAT,
      model: "fixture",
      providerSupportsThinking: false,
      skillFloors: [],
    });
    assertThrows(
      () =>
        projectResolvedCallOptions(resolution, declarations, {
          profile: "openai",
          supportsThinking: false,
          supportedEffortTiers: [],
        }),
      Error,
      "unsupported_call_option",
    );
  }
  const declarations: IEffortDeclarations = { request: { effort: "auto" } };
  const resolution = new EffortResolver().resolve(declarations, {
    taskComplexity: TaskComplexity.COMPLEX,
    complexitySource: "analysis",
    providerType: ProviderType.OPENAI_CHAT,
    model: "fixture",
    providerSupportsThinking: false,
    skillFloors: [],
  });
  assertEquals(
    projectResolvedCallOptions(resolution, declarations, {
      profile: "openai",
      supportsThinking: false,
      supportedEffortTiers: [],
    }).effort,
    undefined,
  );
});
