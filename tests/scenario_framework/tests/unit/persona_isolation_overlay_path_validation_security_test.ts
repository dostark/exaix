/**
 * @module PersonaIsolationOverlayPathValidationTest
 * @path tests/scenario_framework/tests/unit/persona_isolation_overlay_path_validation_security_test.ts
 * @description Security coverage for persona overlay alias validation.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/persona_isolation_arm.ts, packages/portal/src/path_resolver.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { DEFAULT_AGENTS_PATH } from "@exaix/shared";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import { buildPersonaIsolationArmPlan } from "../../runner/persona_isolation_arm.ts";

Deno.test("[security] persona overlay traversal is rejected before environment mutation", async () => {
  const root = await Deno.makeTempDir({ prefix: "persona-path-" });
  const envName = "EXA_EVAL_AGENT_ROLE_OVERLAY_DIR";
  const previous = Deno.env.get(envName);
  try {
    await Deno.mkdir(pathBuilders.blueprintsPath(root, DEFAULT_AGENTS_PATH), { recursive: true });
    await Deno.mkdir(pathBuilders.memoryPath(root), { recursive: true });
    await Deno.writeTextFile(
      pathBuilders.blueprintsPath(root, DEFAULT_AGENTS_PATH, "senior-coder.md"),
      "---\nagent_role: senior-coder\n---\nbody\n",
    );
    Deno.env.delete(envName);
    const error = await assertRejects(() =>
      buildPersonaIsolationArmPlan({
        agentRoleId: "senior-coder",
        scenarioIds: ["swe-a", "swe-b"],
        trials: 3,
        provider: "mock",
        model: "test-model",
        sourceBlueprintAlias: "@Blueprints/Agents/senior-coder.md",
        overlayRootAlias: "@Memory/../../../etc",
      }, new PathResolver(createMockConfig(root)))
    );
    assertStringIncludes(String(error), "denied");
    assertEquals(Deno.env.get(envName), undefined);
  } finally {
    if (previous === undefined) Deno.env.delete(envName);
    else Deno.env.set(envName, previous);
    await Deno.remove(root, { recursive: true });
  }
});
