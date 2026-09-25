/**
 * @module BlueprintEffortDeclarationTest
 * @path packages/schemas/tests/blueprint_effort_declaration_test.ts
 * @description Verifies BlueprintFrontmatterSchema accepts declaration-time effort/thinking
 *   ("auto") for `exactl blueprint create/validate` and rejects any other value (GAP-5,
 *   GAP-9) — the authoring blueprint surface.
 * @architectural-layer Schemas
 * @related-files [packages/schemas/src/blueprint.ts, packages/schemas/src/model_intent.ts]
 */

import { assertEquals } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import { BlueprintFrontmatterSchema } from "@exaix/schemas/blueprint.ts";

function frontmatter(overrides: Record<string, JSONValue>): Record<string, JSONValue> {
  return {
    agent_role: "test-agent",
    name: "Test Agent",
    created: "2026-01-01T00:00:00.000Z",
    created_by: "test@example.com",
    ...overrides,
  };
}

Deno.test("BlueprintFrontmatterSchema: accepts effort auto", () => {
  const parsed = BlueprintFrontmatterSchema.parse(frontmatter({ effort: "auto" }));
  assertEquals(parsed.effort, "auto");
});

Deno.test("BlueprintFrontmatterSchema: accepts the concrete effort tiers", () => {
  for (const tier of ["low", "medium", "high"]) {
    const parsed = BlueprintFrontmatterSchema.parse(frontmatter({ effort: tier }));
    assertEquals(parsed.effort, tier);
  }
});

Deno.test("BlueprintFrontmatterSchema: rejects effort turbo", () => {
  const result = BlueprintFrontmatterSchema.safeParse(frontmatter({ effort: "turbo" }));
  assertEquals(result.success, false);
});

Deno.test("BlueprintFrontmatterSchema: accepts thinking auto and booleans", () => {
  assertEquals(BlueprintFrontmatterSchema.parse(frontmatter({ thinking: "auto" })).thinking, "auto");
  assertEquals(BlueprintFrontmatterSchema.parse(frontmatter({ thinking: true })).thinking, true);
  assertEquals(BlueprintFrontmatterSchema.parse(frontmatter({ thinking: false })).thinking, false);
});

Deno.test("BlueprintFrontmatterSchema: rejects a nonsense thinking value", () => {
  const result = BlueprintFrontmatterSchema.safeParse(frontmatter({ thinking: "maybe" }));
  assertEquals(result.success, false);
});
