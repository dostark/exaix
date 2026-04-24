// deno-lint-ignore-file no-explicit-any
/**
 * @module PlanCommandsSkillsTest
 * @path tests/cli/plan_commands_skills_test.ts
 * @description Specialized tests for dynamic skills injection during the plan approval phase,
 * ensuring additional capabilities can be appended to plans before execution.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { PlanCommands } from "../../src/cli/commands/plan_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { PlanStatus } from "../../src/shared/status/plan_status.ts";

interface Frontmatter {
  status?: string;
  skills?: string[];
  [key: string]: any;
}

Deno.test("PlanCommands - Skills Injection on Approve", async (t) => {
  const { tempDir, context, cleanup } = await createCliTestContext();
  const planCommands = new PlanCommands(context);

  await t.step("approve plan with skills", async () => {
    // 1. Create a mock plan file in Workspace/Plans
    const planId = "test-plan-123";
    const plansDir = join(tempDir, "Workspace/Plans");
    const planPath = join(plansDir, `${planId}.md`);

    const planContent = `---
status: ${PlanStatus.REVIEW}
trace_id: abc-123
request_id: request-xyz
identity_id: test-agent
created_at: 2026-01-27T10:00:00Z
---

# Test Plan

This is a test plan.
`;

    await Deno.writeTextFile(planPath, planContent);

    // 2. Approve with skills
    await planCommands.approve(planId, ["documentation-driven", "file-ops"]);

    // 3. Verify plan moved to Active with skills in frontmatter
    const activePath = join(tempDir, "Workspace/Active", `${planId}.md`);
    const activeContent = await Deno.readTextFile(activePath);

    const match = activeContent.match(/^---\n([\s\S]*?)\n---/);
    if (!match) throw new Error("No frontmatter found");

    const frontmatter = parseYaml(match[1]) as Frontmatter;

    assertEquals(frontmatter.status, PlanStatus.APPROVED);
    assertEquals(frontmatter.skills, ["documentation-driven", "file-ops"]);
    assertStringIncludes(activeContent, "skills:");
  });

  await t.step("approve plan without skills", async () => {
    // 1. Create another mock plan
    const planId = "test-plan-456";
    const plansDir = join(tempDir, "Workspace/Plans");
    const planPath = join(plansDir, `${planId}.md`);

    const planContent = `---
status: ${PlanStatus.REVIEW}
trace_id: def-456
request_id: request-abc
identity_id: test-agent
created_at: 2026-01-27T11:00:00Z
---

# Another Test Plan

This is another test plan.
`;

    await Deno.writeTextFile(planPath, planContent);

    // 2. Approve without skills
    await planCommands.approve(planId);

    // 3. Verify plan moved to Active without skills in frontmatter
    const activePath = join(tempDir, "Workspace/Active", `${planId}.md`);
    const activeContent = await Deno.readTextFile(activePath);

    const match = activeContent.match(/^---\n([\s\S]*?)\n---/);
    if (!match) throw new Error("No frontmatter found");

    const frontmatter = parseYaml(match[1]) as Frontmatter;

    assertEquals(frontmatter.status, PlanStatus.APPROVED);
    assertEquals(frontmatter.skills, undefined);
  });

  await cleanup();
});
