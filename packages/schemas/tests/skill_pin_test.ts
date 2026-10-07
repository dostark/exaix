/**
 * @module SkillPinSchemaTest
 * @path packages/schemas/tests/skill_pin_test.ts
 * @description Verifies the strict plan skill pin schema and the plan frontmatter field that
 *   carries it. Valid, empty and absent vectors parse. Malformed, unknown-key, duplicate and
 *   out-of-range entries are rejected.
 * @architectural-layer Unit
 * @dependencies [@std/assert, @exaix/schemas]
 * @related-files [packages/schemas/src/skill_pin.ts, packages/schemas/src/plan_schema.ts]
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { SkillMatchSource, SkillRenderOutcome, SkillRootKind } from "@exaix/core";
import { PlanStatus } from "@exaix/core/status";
import type { JSONObject } from "@exaix/core/types";
import { SkillPinSchema, SkillPinVectorSchema } from "@exaix/schemas/skill_pin.ts";
import { PlanFrontmatterSchema } from "@exaix/schemas/plan_schema.ts";

const REVISION_ID = "0f3e1c6a-2f3b-5c1a-9a77-0d6a1f9d4e21";
const DIGEST = "a".repeat(64);

function pin(overrides: JSONObject = {}): JSONObject {
  return {
    name: "code-review",
    revision_id: REVISION_ID,
    content_sha256: DIGEST,
    root_kind: SkillRootKind.BLUEPRINT,
    source_path: "code-review",
    portal: null,
    match_source: SkillMatchSource.MATCHED,
    confidence: 0.8,
    matched_task_types: ["code_review"],
    required: false,
    render_mode: SkillRenderOutcome.FULL,
    content_included: true,
    ...overrides,
  };
}

Deno.test("[skill_pin] a complete pin parses", () => {
  assertEquals(SkillPinSchema.parse(pin()).name, "code-review");
});

Deno.test("[skill_pin] unknown keys, bad names, bad ids and bad confidence are rejected", () => {
  for (
    const bad of [
      pin({ extra: true }),
      pin({ name: "Not A Slug" }),
      pin({ revision_id: "not-a-uuid" }),
      pin({ content_sha256: "abc" }),
      pin({ confidence: 1.5 }),
      pin({ confidence: -0.1 }),
      pin({ root_kind: "elsewhere" }),
      pin({ match_source: "invented" }),
      pin({ portal: "../escape" }),
      pin({ content_included: null }),
    ]
  ) {
    assertFalse(SkillPinSchema.safeParse(bad).success, JSON.stringify(bad));
  }
});

Deno.test("[skill_pin] a vector keeps order and rejects duplicate names", () => {
  const other = pin({ name: "security-first", revision_id: "1f3e1c6a-2f3b-5c1a-9a77-0d6a1f9d4e21" });
  assertEquals(SkillPinVectorSchema.parse([pin(), other]).map((entry) => entry.name), [
    "code-review",
    "security-first",
  ]);
  assertFalse(SkillPinVectorSchema.safeParse([pin(), pin()]).success);
  assertEquals(SkillPinVectorSchema.parse([]), []);
});

Deno.test("[skill_pin] plan frontmatter distinguishes absent, empty and populated vectors", () => {
  const base = { status: PlanStatus.REVIEW };
  assertEquals(PlanFrontmatterSchema.parse(base).resolved_skills, undefined);
  assertEquals(PlanFrontmatterSchema.parse({ ...base, resolved_skills: [] }).resolved_skills, []);
  const parsed = PlanFrontmatterSchema.parse({ ...base, resolved_skills: [pin()] });
  assertEquals(parsed.resolved_skills?.length, 1);
  assert(!PlanFrontmatterSchema.safeParse({ ...base, resolved_skills: [{ name: "x" }] }).success);
  assert(!PlanFrontmatterSchema.safeParse({ ...base, resolved_skills: "code-review" }).success);
});
