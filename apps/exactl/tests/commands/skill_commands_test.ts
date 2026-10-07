/**
 * @module SkillCommandsTest
 * @path apps/exactl/tests/commands/skill_commands_test.ts
 * @description Phase 206 Step 5 — `skills show` and the nested `memory skill show` read usage
 *   totals from the journal DB: overall and per-revision counts plus the last use. Both
 *   registrations call the same handler, so one handler test covers both aliases.
 * @architectural-layer Test
 * @dependencies [@std/assert, @exaix/core/skills, @exaix/testing]
 * @related-files [apps/exactl/src/commands/memory_commands.ts, packages/cli/src/formatters/memory_formatter.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { UIOutputFormat } from "@exaix/tui";
import { SkillStatus } from "@exaix/core";
import { policySkillSubmission, SkillsService } from "@exaix/core/skills";
import { testSkillContext } from "@exaix/testing";
import { TestEnvironmentFactory } from "../../../../tests/fixtures/test_environment_factory.ts";

Deno.test("[skills show] prints total, per-revision and last-use counts read from the journal", async () => {
  const { commands, config, db, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await commands.skillCreate("Usage Skill", { instructions: "Body one." });
    const service = new SkillsService({ memoryDir: join(config.system.root, config.paths.memory) }, db);
    const [draft] = await service.listSkills({ status: SkillStatus.DRAFT });
    const ctx = testSkillContext();
    await service.recordSubmission(policySkillSubmission(draft), ctx);
    await service.recordSubmission(policySkillSubmission(draft), ctx);

    const table = await commands.skillShow("usage-skill");
    assertStringIncludes(table, "Total uses: 2");
    assertStringIncludes(table, `Revision ${draft.id.slice(0, 8)}: 2 use(s)`);
    assertStringIncludes(table, "Last used:");

    const markdown = await commands.skillShow("usage-skill", UIOutputFormat.MARKDOWN);
    assertStringIncludes(markdown, "Total uses: 2");

    const json = JSON.parse(await commands.skillShow("usage-skill", UIOutputFormat.JSON));
    assertEquals(json.usage.totalUses, 2);
    assertEquals(json.usage.revisions[0].useCount, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("[skills show] an unused skill shows zero uses", async () => {
  const { commands, cleanup } = await TestEnvironmentFactory.createMemoryEnvironment();
  try {
    await commands.skillCreate("Idle Skill", { instructions: "Body." });
    const output = await commands.skillShow("idle-skill");
    assertStringIncludes(output, "Total uses: 0");
    assertEquals(JSON.parse(await commands.skillShow("idle-skill", UIOutputFormat.JSON)).usage.revisions, []);
  } finally {
    await cleanup();
  }
});
