/**
 * @module BlueprintFrontmatterHitlTest
 * @path packages/schemas/tests/blueprint_frontmatter_hitl_test.ts
 * @related-files ["packages/schemas/src/blueprint.ts", "packages/core/src/types/i_hitl_policy_evaluator.ts"]
 * @architectural-layer Schemas
 * @description Verifies BlueprintFrontmatterSchema accepts the optional `hitl` block (Phase 118).
 */

import { assertEquals } from "@std/assert";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";

const BASE = {
  identity_id: "senior-coder",
  name: "Senior Coder",
  model: "anthropic:claude-opus-4-5",
  created: new Date().toISOString(),
  created_by: "test-user",
};

Deno.test("BlueprintFrontmatterSchema: frontmatter without hitl still validates", () => {
  const result = BlueprintFrontmatterSchema.parse({ ...BASE });
  assertEquals("hitl" in result, false);
});

Deno.test("BlueprintFrontmatterSchema: hitl with empty require_secondary_approval validates", () => {
  const result = BlueprintFrontmatterSchema.parse({
    ...BASE,
    hitl: { require_secondary_approval: [] },
  });
  assertEquals(result.hitl?.require_secondary_approval, []);
});

Deno.test("BlueprintFrontmatterSchema: hitl with a rule set validates", () => {
  const result = BlueprintFrontmatterSchema.parse({
    ...BASE,
    hitl: {
      require_secondary_approval: [
        { tool: "git_commit", path_pattern: "**/migrations/**" },
      ],
    },
  });
  assertEquals(result.hitl?.require_secondary_approval.length, 1);
  assertEquals(result.hitl?.require_secondary_approval[0].tool, "git_commit");
});
