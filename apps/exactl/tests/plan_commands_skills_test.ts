/**
 * @module PlanCommandsSkillsTest
 * @path apps/exactl/tests/plan_commands_skills_test.ts
 * @description Plan approval never changes the plan's skills. The pin vector the planning run wrote
 *   passes through approval untouched, and an absent vector stays absent.
 * @architectural-layer CLI
 * @dependencies [@std/assert, @std/yaml, @exaix/core/skills]
 * @related-files [apps/exactl/src/commands/plan_commands.ts, packages/schemas/src/skill_pin.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { PlanCommands } from "../src/commands/plan_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { PlanStatus } from "@exaix/core/status";
import { SkillMatchSource, SkillRenderOutcome, SkillRootKind } from "@exaix/core";
import type { ISkillPin } from "@exaix/core/skills";

interface IFrontmatter {
  status?: string;
  resolved_skills?: ISkillPin[];
}

const PLANNING_PIN: ISkillPin = {
  name: "planned-skill",
  revision_id: "0f3e1c6a-2f3b-5c1a-9a77-0d6a1f9d4e21",
  content_sha256: "a".repeat(64),
  root_kind: SkillRootKind.BLUEPRINT,
  source_path: "planned-skill",
  portal: null,
  match_source: SkillMatchSource.MATCHED,
  confidence: 0.6,
  matched_task_types: [],
  required: false,
  render_mode: SkillRenderOutcome.FULL,
  content_included: true,
};

async function approvedFrontmatter(extra: string): Promise<IFrontmatter> {
  const env = await createCliTestContext();
  try {
    const planId = "plan-approval";
    await Deno.writeTextFile(
      join(env.tempDir, "Workspace/Plans", `${planId}.md`),
      `---\nstatus: ${PlanStatus.REVIEW}\ntrace_id: ${crypto.randomUUID()}\nrequest_id: request-xyz\nagent_role: test-agent\ncreated_at: 2026-01-27T10:00:00Z\n${extra}---\n\n# Plan\n`,
    );
    await new PlanCommands(env.context).approve(planId);
    const content = await Deno.readTextFile(join(env.tempDir, "Workspace/Active", `${planId}.md`));
    return parseYaml(content.match(/^---\n([\s\S]*?)\n---/)![1]) as IFrontmatter;
  } finally {
    await env.cleanup();
  }
}

Deno.test("[approve] the planning pin vector passes through approval untouched", async () => {
  const frontmatter = await approvedFrontmatter(`resolved_skills:\n  - ${JSON.stringify(PLANNING_PIN)}\n`);
  assertEquals(frontmatter.status, PlanStatus.APPROVED);
  assertEquals(frontmatter.resolved_skills, [PLANNING_PIN]);
});

Deno.test("[approve] an empty vector stays empty and an absent one stays absent", async () => {
  assertEquals((await approvedFrontmatter("resolved_skills: []\n")).resolved_skills, []);
  assert(!("resolved_skills" in await approvedFrontmatter("")));
});
