/**
 * @module PlanWriterResolvedSkillsTest
 * @path packages/core/tests/planning/plan_writer_resolved_skills_test.ts
 * @description Verifies that PlanWriter persists the final planning pin vector as
 *   `resolved_skills` without loading current files. A populated vector round-trips through the
 *   plan frontmatter schema, an empty vector is written as `[]`, an absent vector writes no field,
 *   a malformed vector is refused, and the retired `resolved_skill_ids` field is never written.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/yaml, @exaix/core/planning, @exaix/testing]
 * @related-files [packages/core/src/planning/plan_writer.ts, packages/schemas/src/skill_pin.ts]
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { SkillMatchSource, SkillRenderOutcome, SkillRootKind } from "@exaix/core";
import type { JSONObject } from "@exaix/core/types";
import { type IRequestMetadata, PlanWriter } from "@exaix/core/planning";
import type { ISkillPin } from "@exaix/core/skills";
import { PlanFrontmatterSchema } from "@exaix/schemas/plan_schema.ts";
import { initTestDbService } from "@exaix/testing";

const PIN: ISkillPin = {
  name: "code-review",
  revision_id: "0f3e1c6a-2f3b-5c1a-9a77-0d6a1f9d4e21",
  content_sha256: "a".repeat(64),
  root_kind: SkillRootKind.BLUEPRINT,
  source_path: "code-review",
  portal: null,
  match_source: SkillMatchSource.MATCHED,
  confidence: 0.8,
  matched_task_types: ["code_review"],
  required: false,
  render_mode: SkillRenderOutcome.FULL,
  content_included: true,
};

const RESULT = {
  thought: "thinking",
  content: JSON.stringify({
    subject: "Subject",
    description: "Desc",
    steps: [{ step: 1, title: "Step 1", description: "Do it" }],
  }),
  raw: "raw",
};

async function writePlan(metadata: Partial<IRequestMetadata>): Promise<JSONObject> {
  const { db, config, tempDir, cleanup } = await initTestDbService();
  try {
    const plansDir = join(tempDir, config.paths.workspace, "Plans");
    await Deno.mkdir(plansDir, { recursive: true });
    const writer = new PlanWriter({
      plansDirectory: plansDir,
      includeReasoning: true,
      generateWikiLinks: true,
      runtimeRoot: tempDir,
      db,
    });
    const { planPath } = await writer.writePlan(RESULT, {
      requestId: "req-pins",
      traceId: crypto.randomUUID(),
      createdAt: new Date(),
      contextFiles: [],
      contextWarnings: [],
      ...metadata,
    });
    const content = await Deno.readTextFile(planPath);
    return parseYaml(content.split("---")[1]) as JSONObject;
  } finally {
    await cleanup();
  }
}

Deno.test("[writer] a pin vector is written verbatim and parses with the plan schema", async () => {
  const frontmatter = await writePlan({ resolvedSkills: [PIN] });
  assertEquals(frontmatter.resolved_skills, [PIN]);
  assertEquals(PlanFrontmatterSchema.parse(frontmatter).resolved_skills, [PIN]);
  assert(!("resolved_skill_ids" in frontmatter));
});

Deno.test("[writer] an empty final vector is written as an empty list", async () => {
  const frontmatter = await writePlan({ resolvedSkills: [] });
  assertEquals(frontmatter.resolved_skills, []);
});

Deno.test("[writer] an absent vector writes no resolved_skills field", async () => {
  const frontmatter = await writePlan({});
  assert(!("resolved_skills" in frontmatter));
});

Deno.test("[writer][security] a malformed or duplicate vector is refused before anything is written", async () => {
  await assertRejects(() => writePlan({ resolvedSkills: [{ ...PIN, confidence: 9 }] }));
  await assertRejects(() => writePlan({ resolvedSkills: [PIN, PIN] }));
});
