/**
 * @module BlueprintAuthoringRoutingTest
 * @path tests/agents/blueprint_authoring_routing_test.ts
 * @description Exercises planning and authoring tag selection through the production skills service.
 * @architectural-layer Test
 * @related-files [packages/core/src/skills/skills.ts, scripts/skill_catalog_loader.ts]
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EventLogger } from "@exaix/core/logger";
import { SkillsService } from "@exaix/core/skills";
import { initTestDbService, REPO_ROOT } from "@exaix/testing";

Deno.test("Blueprint planning defaults and trigger-selected guidance have separate discovery routes", async () => {
  const environment = await initTestDbService();
  try {
    const service = new SkillsService(
      {
        memoryDir: join(environment.tempDir, "Memory"),
        blueprintSkillsDir: join(REPO_ROOT, "Blueprints", "Skills"),
      },
      environment.db,
      undefined,
      new EventLogger({ db: environment.db }),
    );
    const cases = [
      { tags: ["best-practices", "plan-quality", "blueprint"], expected: ["blueprint-best-practices"] },
      {
        tags: ["implementation-plan", "implementation-planning", "migration-planning"],
        expected: ["implementation-plan"],
      },
    ];
    const selected = new Set(["blueprint-best-practices", "implementation-plan"]);
    for (const sample of cases) {
      const result = await service.matchSkills({ tags: sample.tags });
      assertEquals(result.matches.map((match) => match.skillId).filter((id) => selected.has(id)), sample.expected);
    }
  } finally {
    await environment.cleanup();
  }
});
