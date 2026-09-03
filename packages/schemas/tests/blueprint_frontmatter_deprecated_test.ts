/**
 * @module BlueprintFrontmatterSchemaDeprecatedTest
 * @path packages/schemas/tests/blueprint_frontmatter_deprecated_test.ts
 * @related-files ["packages/schemas/src/blueprint.ts", "packages/routing/src/capability_matcher.ts"]
 * @architectural-layer Schemas
 * @description Verifies BlueprintFrontmatterSchema recognises the optional `deprecated`
 * flag (Phase 93 Solo salvage) — the single source of truth routing/capability matching
 * consumes to exclude a blueprint. Absent means active; no separate stored status field.
 */

import { assertEquals } from "@std/assert";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";

const BASE = {
  agent_role: "senior-coder",
  name: "Senior Coder",
  model: "anthropic:claude-opus-4-5",
  created: new Date().toISOString(),
  created_by: "test-user",
};

Deno.test("BlueprintFrontmatterSchema: deprecated is undefined when omitted (active)", () => {
  const result = BlueprintFrontmatterSchema.parse({ ...BASE });
  assertEquals(result.deprecated, undefined);
});

Deno.test("BlueprintFrontmatterSchema: accepts deprecated = true", () => {
  const result = BlueprintFrontmatterSchema.parse({ ...BASE, deprecated: true });
  assertEquals(result.deprecated, true);
});

Deno.test("BlueprintFrontmatterSchema: accepts deprecated = false", () => {
  const result = BlueprintFrontmatterSchema.parse({ ...BASE, deprecated: false });
  assertEquals(result.deprecated, false);
});

Deno.test("BlueprintFrontmatterSchema: does not introduce a stored status field", () => {
  const result = BlueprintFrontmatterSchema.parse({ ...BASE });
  assertEquals("status" in result, false);
});
