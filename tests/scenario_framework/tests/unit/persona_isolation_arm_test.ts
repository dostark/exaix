/**
 * @module PersonaIsolationArmTest
 * @path tests/scenario_framework/tests/unit/persona_isolation_arm_test.ts
 * @description Verifies persona overlays vary only blueprint body text.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/persona_isolation_arm.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import {
  buildPersonaIsolationArmPlan,
  GENERIC_PERSONA_BODY,
  materializePersonaVariants,
} from "../../runner/persona_isolation_arm.ts";

// style-exclude:FIXTURE_READABILITY - The byte-level frontmatter/body boundary is clearest inline.
const BLUEPRINT = `---
agent_role: "senior-coder"
model_size: L
capabilities: ["testing"]
default_skills: ["tdd-methodology"]
permitted_tools: ["read_file"]
---

# Senior Coder

Write careful code.
`;

Deno.test("[PersonaIsolationArm] materializes shipped, generic, and empty bodies with byte-identical frontmatter", async () => {
  const root = await Deno.makeTempDir({ prefix: "persona-arm-" });
  try {
    const source = join(root, "Blueprints", "Agents", "senior-coder.md");
    await Deno.mkdir(join(root, "Blueprints", "Agents"), { recursive: true });
    await Deno.mkdir(join(root, "Memory", "persona-overlays"), { recursive: true });
    await Deno.writeTextFile(source, BLUEPRINT);
    const plan = await buildPersonaIsolationArmPlan({
      agentRoleId: "senior-coder",
      scenarioIds: ["swe-write-tests-uncovered", "swe-fix-bug-null-guard"],
      trials: 3,
      provider: "mock",
      model: "test-model",
      sourceBlueprintAlias: "@Blueprints/Agents/senior-coder.md",
      overlayRootAlias: "@Memory/persona-overlays",
    }, new PathResolver(createMockConfig(root)));

    const materialized = await materializePersonaVariants(plan);
    const contents = await Promise.all(materialized.map((variant) => Deno.readTextFile(variant.blueprintPath)));
    const frontmatters = contents.map((content) => content.slice(0, content.indexOf("---", 4) + 3));

    assertEquals(new Set(frontmatters).size, 1);
    assertStringIncludes(contents[0], "Write careful code.");
    assertStringIncludes(contents[1], GENERIC_PERSONA_BODY);
    assertEquals(contents[2], `${frontmatters[2]}\n`);
    assertEquals(await Deno.readTextFile(source), BLUEPRINT);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
