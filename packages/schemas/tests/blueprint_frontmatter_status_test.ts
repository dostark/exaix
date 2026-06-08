/**
 * @module BlueprintFrontmatterSchemaStatusTest
 * @path packages/schemas/tests/blueprint_frontmatter_status_test.ts
 * @related-files ["packages/schemas/src/blueprint.ts", "packages/core/src/types/enums.ts"]
 * @architectural-layer Schemas
 * @description Verifies BlueprintFrontmatterSchema supports the lifecycle status field
 * (Phase 93 Solo salvage): defaults to active, accepts draft/deprecated, rejects invalid.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { BlueprintStatus } from "@exaix/core";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";

const BASE = {
  identity_id: "senior-coder",
  name: "Senior Coder",
  model: "anthropic:claude-opus-4-5",
  created: new Date().toISOString(),
  created_by: "test-user",
};

Deno.test("BlueprintFrontmatterSchema: status defaults to active when omitted", () => {
  const result = BlueprintFrontmatterSchema.parse({ ...BASE });
  assertEquals(result.status, BlueprintStatus.ACTIVE);
});

Deno.test("BlueprintFrontmatterSchema: accepts deprecated status", () => {
  const result = BlueprintFrontmatterSchema.parse({ ...BASE, status: BlueprintStatus.DEPRECATED });
  assertEquals(result.status, BlueprintStatus.DEPRECATED);
});

Deno.test("BlueprintFrontmatterSchema: accepts draft status", () => {
  const result = BlueprintFrontmatterSchema.parse({ ...BASE, status: BlueprintStatus.DRAFT });
  assertEquals(result.status, BlueprintStatus.DRAFT);
});

Deno.test("BlueprintFrontmatterSchema: rejects invalid status value", () => {
  assertThrows(() => BlueprintFrontmatterSchema.parse({ ...BASE, status: "retired" }));
});
