/**
 * @module DelegateBriefAcceptanceParseTest
 * @path packages/core/tests/planning/delegate_brief_acceptance_parse_test.ts
 * @description Verifies that parseAcceptanceFromContent extracts acceptance criteria
 *   from markdown content (Phase 150 Step 12, GAP-F).
 */
import { assertEquals } from "@std/assert";
import { buildDelegateBriefArgs, parseAcceptanceFromContent } from "@exaix/core/planning";

Deno.test("parseAcceptanceFromContent: extracts bullets from ## Acceptance section", () => {
  const content = `Fix the login bug.

## Acceptance

- Email/password login works
- SSO login works
- Error states handled
`;
  const result = parseAcceptanceFromContent(content);
  assertEquals(result, ["Email/password login works", "SSO login works", "Error states handled"]);
});

Deno.test("parseAcceptanceFromContent: extracts bullets from ## Success Criteria section", () => {
  const content = `Fix the login bug.

## Success Criteria

- Login page renders
- Form validates input
`;
  const result = parseAcceptanceFromContent(content);
  assertEquals(result, ["Login page renders", "Form validates input"]);
});

Deno.test("parseAcceptanceFromContent: extracts bullets from ## Acceptance Criteria section", () => {
  const content = `Fix the login bug.

## Acceptance Criteria

- All tests pass
- No regressions
`;
  const result = parseAcceptanceFromContent(content);
  assertEquals(result, ["All tests pass", "No regressions"]);
});

Deno.test("parseAcceptanceFromContent: returns empty array when no acceptance section exists", () => {
  const content = `Fix the login bug.

## Notes

Some implementation notes here.
`;
  const result = parseAcceptanceFromContent(content);
  assertEquals(result, []);
});

Deno.test("parseAcceptanceFromContent: handles content with no sections at all", () => {
  const content = "Fix the typo in the footer.";
  const result = parseAcceptanceFromContent(content);
  assertEquals(result, []);
});

Deno.test("buildDelegateBriefArgs: structured successCriteria wins over parsed fallback", () => {
  const content = `Fix the login bug.

## Acceptance

- Parsed from content
`;
  const result = buildDelegateBriefArgs({
    title: "Fix login",
    content,
    successCriteria: ["Structured criterion"],
  });

  assertEquals(result.objective, content);
  assertEquals(result.acceptanceCriteria, ["Structured criterion"]);
});

Deno.test("buildDelegateBriefArgs: falls back to parsed acceptance when successCriteria is undefined", () => {
  const content = `Fix the login bug.

## Acceptance

- Email/password login works
- SSO login works
`;
  const result = buildDelegateBriefArgs({
    title: "Fix login",
    content,
  });

  assertEquals(result.objective, content);
  assertEquals(result.acceptanceCriteria, ["Email/password login works", "SSO login works"]);
});

Deno.test("buildDelegateBriefArgs: falls back to parsed acceptance when successCriteria is empty array", () => {
  const content = `Fix the login bug.

## Acceptance

- All tests pass
`;
  const result = buildDelegateBriefArgs({
    title: "Fix login",
    content,
    successCriteria: [],
  });

  assertEquals(result.objective, content);
  assertEquals(result.acceptanceCriteria, ["All tests pass"]);
});

Deno.test("buildDelegateBriefArgs: omits acceptanceCriteria when both sources are empty", () => {
  const result = buildDelegateBriefArgs({
    title: "Fix typo",
    content: "Fix the typo in the footer.",
  });

  assertEquals(result.objective, "Fix the typo in the footer.");
  assertEquals(result.acceptanceCriteria, undefined);
});
