/**
 * @module RealSkillsServiceHelper
 * @path tests/agents/helpers/real_skills_service.ts
 * @description Builds the production skills service over the shipped Blueprints skills for agent catalog tests.
 * @architectural-layer Test
 * @dependencies [@exaix/core/skills, @exaix/testing]
 * @related-files [tests/agents/output_contract_selection_test.ts]
 */
import { join } from "@std/path";
import { EventLogger } from "@exaix/core/logger";
import { SkillsService } from "@exaix/core/skills";
import { initTestDbService, REPO_ROOT } from "@exaix/testing";

/** The skills service of the repository catalog and the cleanup of its temporary database. */
export async function createRealSkillsService(): Promise<{ service: SkillsService; cleanup: () => Promise<void> }> {
  const environment = await initTestDbService();
  const service = new SkillsService(
    {
      memoryDir: join(environment.tempDir, "Memory"),
      blueprintSkillsDir: join(REPO_ROOT, "Blueprints", "Skills"),
    },
    environment.db,
    undefined,
    new EventLogger({ db: environment.db }),
  );
  return { service, cleanup: () => environment.cleanup() };
}
