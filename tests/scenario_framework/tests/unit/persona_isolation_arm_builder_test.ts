/**
 * @module PersonaIsolationArmBuilderTest
 * @path tests/scenario_framework/tests/unit/persona_isolation_arm_builder_test.ts
 * @description Covers persona arm planning and paired result provenance validation.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/persona_isolation_arm.ts]
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import {
  buildPersonaComparisonInput,
  buildPersonaIsolationArmPlan,
  type IPersonaIsolationRunResult,
  materializePersonaVariants,
} from "../../runner/persona_isolation_arm.ts";

async function fixture() {
  const root = await Deno.makeTempDir({ prefix: "persona-builder-" });
  await Deno.mkdir(join(root, "Blueprints", "Agents"), { recursive: true });
  await Deno.mkdir(join(root, "Memory", "overlays"), { recursive: true });
  await Deno.writeTextFile(join(root, "Blueprints", "Agents", "coder.md"), "---\nagent_role: coder\n---\nPersona\n");
  const resolver = new PathResolver(createMockConfig(root));
  const input = {
    agentRoleId: "coder",
    scenarioIds: ["swe-a", "swe-b"],
    trials: 3,
    provider: "mock",
    model: "test-model",
    sourceBlueprintAlias: "@Blueprints/Agents/coder.md",
    overlayRootAlias: "@Memory/overlays",
  };
  return { root, resolver, input };
}

Deno.test("[PersonaIsolationArmBuilder] emits three cells and two preregistered comparisons", async () => {
  const f = await fixture();
  try {
    const plan = await buildPersonaIsolationArmPlan(f.input, f.resolver);
    assertEquals(plan.cells.length, 3);
    assertEquals(plan.comparisons.length, 2);
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("[PersonaIsolationArmBuilder] rejects candidate content with changed frontmatter", async () => {
  const f = await fixture();
  try {
    const plan = await buildPersonaIsolationArmPlan(f.input, f.resolver);
    await assertRejects(() =>
      materializePersonaVariants(plan, {
        candidateContents: { generic: "---\nagent_role: changed\n---\nGeneric\n" },
      })
    );
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("[PersonaIsolationArmBuilder] rejects missing tasks, duplicates, and fewer than three trials", async () => {
  const f = await fixture();
  try {
    await assertRejects(() => buildPersonaIsolationArmPlan({ ...f.input, scenarioIds: ["swe-a"] }, f.resolver));
    await assertRejects(() =>
      buildPersonaIsolationArmPlan({ ...f.input, scenarioIds: ["swe-a", "swe-a"] }, f.resolver)
    );
    await assertRejects(() => buildPersonaIsolationArmPlan({ ...f.input, trials: 2 }, f.resolver));
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});

Deno.test("[PersonaIsolationArmBuilder] rejects unequal pairs and provider or model drift", async () => {
  const f = await fixture();
  try {
    const plan = await buildPersonaIsolationArmPlan(f.input, f.resolver);
    const results: IPersonaIsolationRunResult[] = plan.cells.map((cell) => ({
      variant: cell.variant,
      provider: cell.provider,
      model: cell.model,
      tasks: cell.scenarioIds.map((taskId) => ({ taskId, scores: [0.5, 0.5, 0.5], runManifestIds: ["a", "b", "c"] })),
    }));
    results[1].tasks[0].scores.pop();
    assertThrows(() => buildPersonaComparisonInput(plan, results));
    results[1].tasks[0].scores.push(0.5);
    results[2].provider = "drifted";
    assertThrows(() => buildPersonaComparisonInput(plan, results));
    results[2].provider = plan.provider;
    results[2].model = "drifted";
    assertThrows(() => buildPersonaComparisonInput(plan, results));
  } finally {
    await Deno.remove(f.root, { recursive: true });
  }
});
