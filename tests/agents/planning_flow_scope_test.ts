/**
 * @module PlanningFlowScopeTest
 * @path tests/agents/planning_flow_scope_test.ts
 * @description Verifies explicit planning-step selection and valid skills across shipped delegate flows.
 * @architectural-layer Test
 * @related-files [packages/flow/src/flow_step_io.ts, packages/core/src/blueprint/blueprint_loader.ts]
 */
import { assertArrayIncludes, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { createBlueprintLoader } from "@exaix/core/blueprint";
import { FlowSchema } from "@exaix/schemas/flow.ts";
import { REPO_ROOT } from "@exaix/testing";

const PLANNING_STEPS = [
  ["feature-development", "design-architecture"],
  ["migration-planning", "create-migration-plan"],
  ["self-correcting-implementation", "plan"],
  ["refactoring", "identify-improvements"],
];

Deno.test("planning guidance belongs to implementation-planning flow steps and not every architect task", async () => {
  const loader = createBlueprintLoader(join(REPO_ROOT, "Blueprints"));
  const architect = await loader.load("software-architect");
  assertExists(architect);
  assertEquals(architect.frontmatter.default_skills, [
    "response-contract",
    "architecture-review",
    "collaborative-flow",
  ]);
  for (const [id, stepId] of PLANNING_STEPS) {
    const flow = FlowSchema.parse(
      parse(await Deno.readTextFile(join(REPO_ROOT, "Blueprints", "Flows", `${id}.flow.yaml`))),
    );
    const step = flow.steps.find((step) => step.id === stepId);
    assertExists(step);
    assertEquals(step.agent_role, "software-architect");
    assertArrayIncludes(step.skills ?? [], ["implementation-plan"]);
  }
});

Deno.test("all shipped CLI flow steps select real skill folders", async () => {
  const known = new Set<string>();
  for await (const entry of Deno.readDir(join(REPO_ROOT, "Blueprints", "Skills"))) {
    if (entry.isDirectory) known.add(entry.name);
  }
  for await (const entry of Deno.readDir(join(REPO_ROOT, "Blueprints", "Flows"))) {
    if (!entry.name.endsWith(".flow.yaml")) continue;
    const flow = FlowSchema.parse(parse(await Deno.readTextFile(join(REPO_ROOT, "Blueprints", "Flows", entry.name))));
    for (const step of flow.steps.filter((step) => step.strategy === "cli_delegate")) {
      assertEquals(
        (step.skills ?? flow.defaultSkills ?? []).filter((name) => !known.has(name)),
        [],
        `${flow.id}/${step.id}`,
      );
    }
  }
});
