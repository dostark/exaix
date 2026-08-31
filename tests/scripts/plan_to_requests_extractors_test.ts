/**
 * @module PlanToRequestsExtractorsTest
 * @path tests/scripts/plan_to_requests_extractors_test.ts
 * @description Phase 173 Step 1 — unit tests for plan_to_requests.ts's exported pure
 *   extractors: `extractExecutiveSummary` (NEW heading-based extractor — the existing
 *   bold-label `extractSection` cannot match real markdown headings) and
 *   `extractRelevantConstraints` (token-overlap filter over the phase-level Constraints /
 *   Design Decisions blocks, with the frozen rule set: MIN_OVERLAP_TOKEN_LENGTH,
 *   degenerate-token denylist, document-order preservation + dedupe, MAX_RELEVANT_BULLETS).
 * @architectural-layer Tests
 * @dependencies [@std/assert, @std/path]
 * @related-files [scripts/plan_to_requests.ts, tests/integration/plan_to_requests_test.ts, tests/integration/fixtures/phase-nn-fixture-with-context.md]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { extractExecutiveSummary, extractRelevantConstraints } from "../../scripts/plan_to_requests.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
/** Shared doc-shaped fixture (mirrors real phase-153/173 section structure) — the SAME
 *  fixture the integration coverage uses, so there is exactly one. */
const PHASE_DOC = await Deno.readTextFile(
  join(REPO_ROOT, "tests", "integration", "fixtures", "phase-nn-fixture-with-context.md"),
);

function stepSliceOf(doc: string, stepNumber: number): string {
  const start = doc.indexOf(`### Step ${stepNumber}:`);
  const next = doc.indexOf(`### Step ${stepNumber + 1}:`);
  return doc.slice(start, next === -1 ? undefined : next);
}

Deno.test("extractExecutiveSummary returns the bold Problem/Solution/Goal paragraphs for a standard phase doc", () => {
  const summary = extractExecutiveSummary(PHASE_DOC);
  assertEquals(summary.includes("**The Problem.**"), true);
  assertEquals(summary.includes("**The Solution.**"), true);
  assertEquals(summary.includes("**The Goal.**"), true);
});

Deno.test("extractExecutiveSummary bounds output at the end of the Goal paragraph (trailing prose excluded)", () => {
  const summary = extractExecutiveSummary(PHASE_DOC);
  assertEquals(summary.includes("outside the bounded summary"), false);
});

Deno.test("extractExecutiveSummary returns empty string when the doc has no Executive Summary heading", () => {
  // style-exclude:FIXTURE_READABILITY - One-line negative-case input, not a structured fixture
  assertEquals(extractExecutiveSummary("# Doc\n\n## Current State\n\nnothing\n"), "");
});

Deno.test("extractRelevantConstraints returns only bullets sharing a token with the step slice", () => {
  const relevant = extractRelevantConstraints(PHASE_DOC, stepSliceOf(PHASE_DOC, 1));
  assertEquals(relevant.constraints.length, 1);
  assertEquals(
    relevant.constraints[0].includes("`scripts/plan_to_requests.ts`"),
    true,
    "the concise-constraints bullet cites the same file as the step's Action",
  );
  // Design Decisions bullets carry no token overlapping the step slice.
  assertEquals(relevant.designDecisions.length, 0);
});

Deno.test("[regression] a step with zero matching bullets omits both sub-block lists without error", () => {
  const relevant = extractRelevantConstraints(PHASE_DOC, stepSliceOf(PHASE_DOC, 2));
  assertEquals(relevant.constraints.length, 0);
  assertEquals(relevant.designDecisions.length, 0);
});

Deno.test("filter min-length boundary: a 4-char shared token does not match, a 5-char one does", () => {
  // style-exclude:FIXTURE_READABILITY - Minimal 4-line probe isolating one rule boundary
  const shortDoc = `# D

### Constraints

- Tune \`abcd\` handling everywhere.

### Design Decisions

- Prefer \`abcde\` normalization.
`;
  const stepRefShort = "slice mentioning `abcd`";
  const stepRefLong = "slice mentioning `abcde`";

  const forShort = extractRelevantConstraints(shortDoc, stepRefShort);
  assertEquals(forShort.constraints.length, 0, "`abcd` is 4 chars — below MIN_OVERLAP_TOKEN_LENGTH");
  assertEquals(forShort.designDecisions.length, 0);

  const forLong = extractRelevantConstraints(shortDoc, stepRefLong);
  assertEquals(forLong.constraints.length, 0);
  assertEquals(forLong.designDecisions.length, 1, "`abcde` is 5 chars — matches");
});

Deno.test("filter cap boundary: more matching bullets than MAX_RELEVANT_BULLETS yields exactly 8 in document order", () => {
  const many = Array.from({ length: 10 }, (_, i) => `- Handle \`file_${String(i).padStart(2, "0")}.ts\` here.`).join(
    "\n",
  );
  // style-exclude:FIXTURE_READABILITY - Generated probe for the cap boundary, not a structured fixture
  const cappedDoc = `# C

### Constraints

${many}
`;
  const stepMentioningAll = Array.from({ length: 10 }, (_, i) => `\`file_${String(i).padStart(2, "0")}.ts\``).join(" ");
  const relevant = extractRelevantConstraints(cappedDoc, stepMentioningAll);
  assertEquals(relevant.constraints.length, 8);
  assertEquals(relevant.constraints[0].includes("file_00"), true, "document order preserved from the top");
  assertEquals(relevant.constraints[7].includes("file_07"), true);
});

Deno.test("filter mixed-source match: a bullet citing its file WITHOUT backticks still matches", () => {
  // style-exclude:FIXTURE_READABILITY - Three-line probe for plain-path token sources
  const plainDoc = `# P

### Constraints

- Edit scripts/plain_path.ts handlers carefully.
`;
  const relevant = extractRelevantConstraints(plainDoc, "the step touches scripts/plain_path.ts");
  assertEquals(relevant.constraints.length, 1);
});

Deno.test("filter degenerate exclusion: a bullet sharing only the universal token `step` matches nothing", () => {
  // style-exclude:FIXTURE_READABILITY - Three-line probe for the degenerate-token denylist
  const degenerateDoc = `# G

### Constraints

- Every step slice repeats the word step.
`;
  const relevant = extractRelevantConstraints(degenerateDoc, "text containing step words galore");
  assertEquals(relevant.constraints.length, 0);
});
