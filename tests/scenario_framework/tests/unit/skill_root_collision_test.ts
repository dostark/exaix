/**
 * @module SkillRootCollisionTest
 * @path tests/scenario_framework/tests/unit/skill_root_collision_test.ts
 * @description Checks that a Blueprint acceptance rejects the shadowing dogfood skill.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/skill_root_collision.ts]
 */
import { assertEquals, assertNotEquals } from "@std/assert";
import { inspectFixBugRoots } from "../../runner/skill_root_collision.ts";

Deno.test("fix-bug root acceptance rejects the actual dogfood revision", async () => {
  const result = await inspectFixBugRoots();
  assertEquals(result.blueprintAccepted, true);
  assertEquals(result.shadowAccepted, false);
  assertNotEquals(result.blueprintRevision, result.shadowRevision);
});
