/**
 * @module SkillsContextSchemaTest
 * @path tests/shared/types/skills_context_schema_test.ts
 * @description Tests for skills context Zod schemas.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { ZSkillsContext } from "@exaix/core/types";
describe("ZSkillsContext", () => {
  it("should validate a valid skills context", () => {
    const validContext = {
      matched: [
        {
          skillId: crypto.randomUUID(),
          title: "Test Skill",
          description: "A test skill",
          content: "Test instructions",
          matchScore: 0.9,
          tags: ["test"],
        },
      ],
      totalAvailable: 10,
      retrievalLatencyMs: 50,
    };

    const result = ZSkillsContext.parse(validContext);
    assertEquals(result.matched.length, 1);
    assertEquals(result.totalAvailable, 10);
  });

  it("should validate an empty skills context", () => {
    const emptyContext = {
      matched: [],
      totalAvailable: 0,
      retrievalLatencyMs: 0,
    };

    const result = ZSkillsContext.parse(emptyContext);
    assertEquals(result.matched.length, 0);
  });

  it("should failed on invalid match score", () => {
    const invalidContext = {
      matched: [
        {
          skillId: crypto.randomUUID(),
          title: "Test Skill",
          description: "A test skill",
          content: "Test instructions",
          matchScore: 1.5, // Invalid > 1
        },
      ],
      totalAvailable: 1,
      retrievalLatencyMs: 50,
    };

    assertThrows(() => ZSkillsContext.parse(invalidContext));
  });
});
