/**
 * @module PatternDecisionIdBackfillTest
 * @path packages/memory/tests/bank/pattern_decision_id_backfill_test.ts
 * @description Verifies lazy id backfill for legacy pattern/decision markdown: parsing assigns UUID ids to marker-less entries, `<!-- id: ... -->` markers are read back verbatim, and a bank rewrite persists markers so re-parses return the same stable ids.
 * @architectural-layer Tests
 */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { MemoryBankService, parseDecisions, parsePatterns } from "@exaix/memory";
import { initTestDbService } from "@exaix/testing";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fixture(name: string): string {
  return Deno.readTextFileSync(join(import.meta.dirname!, "..", "fixtures", name));
}

const LEGACY_PATTERNS_MD = fixture("legacy_patterns.md");
const MARKED_PATTERNS_MD = fixture("marked_patterns.md");

Deno.test("parsePatterns assigns UUID ids to legacy entries with no id marker", () => {
  const patterns = parsePatterns(LEGACY_PATTERNS_MD);
  assertEquals(patterns.length, 2);
  for (const pattern of patterns) {
    assertEquals(UUID_PATTERN.test(pattern.id!), true, `expected UUID id, got ${pattern.id}`);
  }
});

Deno.test("parseDecisions assigns UUID ids to legacy entries with no id marker", () => {
  const decisions = parseDecisions(
    "## 2026-01-04: Use SQLite for local storage\n\nLightweight, no external dependencies.\n\n**Tags:** database\n",
  );
  assertEquals(decisions.length, 1);
  assertEquals(UUID_PATTERN.test(decisions[0].id!), true, `expected UUID id, got ${decisions[0].id}`);
});

Deno.test("parsePatterns reads persisted id markers and keeps them out of the description", () => {
  const patterns = parsePatterns(MARKED_PATTERNS_MD);
  assertEquals(patterns.length, 1);
  assertEquals(patterns[0].id, "11111111-1111-4111-8111-111111111111");
  assertEquals(patterns[0].description.includes("11111111"), false);
  assertEquals(patterns[0].description, "Database access through repository classes.");
});

Deno.test("backfilled pattern ids persist via markers on rewrite and stay stable across re-parses", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    // Stored WITHOUT ids: the written markdown is legacy-format (no markers).
    await bank.createProjectMemory({
      portal: "backfill-test",
      overview: "A test project.",
      patterns: [{ name: "Legacy Pattern", description: "Stored without an id marker.", examples: [] }],
      decisions: [],
      references: [],
    });

    const firstParse = (await bank.getProjectMemory("backfill-test"))!.patterns;
    assertEquals(firstParse.length, 1);
    assertEquals(UUID_PATTERN.test(firstParse[0].id!), true);

    // A rewrite persists the parsed ids as markers.
    await bank.updateProjectMemory("backfill-test", {});

    const secondParse = (await bank.getProjectMemory("backfill-test"))!.patterns;
    const thirdParse = (await bank.getProjectMemory("backfill-test"))!.patterns;
    assertEquals(secondParse[0].id, thirdParse[0].id, "ids must be stable across re-parses once persisted");
  } finally {
    await cleanup();
  }
});

Deno.test("backfilled decision ids persist via markers and stay stable across re-parses", async () => {
  const { config, cleanup } = await initTestDbService();
  try {
    const bank = new MemoryBankService(config);
    await bank.createProjectMemory({
      portal: "backfill-decisions",
      overview: "A test project.",
      patterns: [],
      decisions: [],
      references: [],
    });
    await bank.addDecision("backfill-decisions", {
      date: "2026-01-04",
      decision: "Use SQLite for local storage",
      rationale: "Lightweight, no external dependencies.",
    });

    const afterAdd = (await bank.getProjectMemory("backfill-decisions"))!.decisions;
    assertEquals(afterAdd.length, 1);
    assertEquals(UUID_PATTERN.test(afterAdd[0].id!), true);

    const secondParse = (await bank.getProjectMemory("backfill-decisions"))!.decisions;
    const thirdParse = (await bank.getProjectMemory("backfill-decisions"))!.decisions;
    assertEquals(secondParse[0].id, thirdParse[0].id, "decision ids must be stable once persisted");
  } finally {
    await cleanup();
  }
});
