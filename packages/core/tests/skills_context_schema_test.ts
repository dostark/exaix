/**
 * @module SkillsContextSchemaTest
 * @path packages/core/tests/skills_context_schema_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Tests for skills context Zod schemas: the final match shape carrying the slug,
 *   revision identity, display name, confidence, matched triggers, source and references.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { SkillMatchSource, SkillRootKind } from "@exaix/core";
import { type ISkillsContext, ZSkillsContext } from "@exaix/core/types";

const REVISION_ID = "123e4567-e89b-52d3-a456-426614174000";
const CONTENT_SHA256 = "a".repeat(64);

function validMatch(
  overrides: Partial<ISkillsContext["matched"][number]> = {},
): Partial<ISkillsContext["matched"][number]> {
  return {
    skillId: "test-skill",
    revisionId: REVISION_ID,
    contentSha256: CONTENT_SHA256,
    rootKind: SkillRootKind.BLUEPRINT,
    sourcePath: "test-skill",
    name: "Test Skill",
    description: "A test skill",
    content: "Test instructions",
    confidence: 0.9,
    source: SkillMatchSource.MATCHED,
    tags: ["test"],
    ...overrides,
  };
}

describe("ZSkillsContext", () => {
  it("should validate a valid skills context and default optional fields", () => {
    const result = ZSkillsContext.parse({ matched: [validMatch()], totalAvailable: 10, retrievalLatencyMs: 50 });
    assertEquals(result.matched.length, 1);
    assertEquals(result.totalAvailable, 10);
    assertEquals(result.matched[0].critical, false);
    assertEquals(result.matched[0].matchedTriggers, {});
    assertEquals(result.matched[0].references, []);
  });

  it("should round-trip the identity, trigger and reference fields", () => {
    const match = validMatch({
      matchedTriggers: { keywords: ["tdd"], tags: ["testing"] },
      references: [{ path: "references/guide.md", content: "Guide", linked: true }],
    });
    const result = ZSkillsContext.parse({ matched: [match], totalAvailable: 1, retrievalLatencyMs: 0 });
    assertEquals(result.matched[0].revisionId, REVISION_ID);
    assertEquals(result.matched[0].matchedTriggers.keywords, ["tdd"]);
    assertEquals(result.matched[0].references[0].path, "references/guide.md");
  });

  it("should validate an empty skills context", () => {
    const result = ZSkillsContext.parse({ matched: [], totalAvailable: 0, retrievalLatencyMs: 0 });
    assertEquals(result.matched.length, 0);
  });

  it("should fail on an out-of-range confidence", () => {
    assertThrows(() =>
      ZSkillsContext.parse({ matched: [validMatch({ confidence: 1.5 })], totalAvailable: 1, retrievalLatencyMs: 50 })
    );
  });

  it("should fail on a non-UUID revision id or an unknown match source", () => {
    assertThrows(() =>
      ZSkillsContext.parse({
        matched: [validMatch({ revisionId: "not-a-uuid" })],
        totalAvailable: 1,
        retrievalLatencyMs: 0,
      })
    );
    assertThrows(() =>
      ZSkillsContext.parse({
        matched: [validMatch({ source: "guessed" as never })],
        totalAvailable: 1,
        retrievalLatencyMs: 0,
      })
    );
  });
});
