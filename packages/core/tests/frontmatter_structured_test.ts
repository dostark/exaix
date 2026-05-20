/**
 * @module FrontmatterStructuredTest
 * @path tests/services/request_processing/frontmatter_structured_test.ts
 * @description Tests for structured expectation fields (acceptance_criteria,
 * expected_outcomes, scope) added to IRequestFrontmatter (Phase 49, Step 8).
 * @architectural-layer Tests
 * @related-files [.copilot/planning/phase-49-quality-pipeline-hardening.md]
 */
import { assertEquals, assertExists } from "@std/assert";
import type { IRequestFrontmatter } from "@exaix/core/request";
// ---------------------------------------------------------------------------
// acceptance_criteria
// ---------------------------------------------------------------------------

Deno.test("[IRequestFrontmatter] accepts acceptance_criteria string array", () => {
  const fm: IRequestFrontmatter = {
    trace_id: "abc-001",
    created: "2024-01-01T00:00:00Z",
    status: "pending",
    priority: "P2",
    source: "test",
    created_by: "tester",
    acceptance_criteria: ["must log errors", "must return 200"],
  };
  assertExists(fm.acceptance_criteria);
  assertEquals(fm.acceptance_criteria, ["must log errors", "must return 200"]);
});

Deno.test("[IRequestFrontmatter] acceptance_criteria is optional", () => {
  const fm: IRequestFrontmatter = {
    trace_id: "abc-002",
    created: "2024-01-01T00:00:00Z",
    status: "pending",
    priority: "P2",
    source: "test",
    created_by: "tester",
  };
  assertEquals(fm.acceptance_criteria, undefined);
});

// ---------------------------------------------------------------------------
// expected_outcomes
// ---------------------------------------------------------------------------

Deno.test("[IRequestFrontmatter] accepts expected_outcomes string array", () => {
  const fm: IRequestFrontmatter = {
    trace_id: "abc-003",
    created: "2024-01-01T00:00:00Z",
    status: "pending",
    priority: "P2",
    source: "test",
    created_by: "tester",
    expected_outcomes: ["output file generated", "no warnings in log"],
  };
  assertExists(fm.expected_outcomes);
  assertEquals(fm.expected_outcomes, ["output file generated", "no warnings in log"]);
});

Deno.test("[IRequestFrontmatter] expected_outcomes is optional", () => {
  const fm: IRequestFrontmatter = {
    trace_id: "abc-004",
    created: "2024-01-01T00:00:00Z",
    status: "pending",
    priority: "P2",
    source: "test",
    created_by: "tester",
  };
  assertEquals(fm.expected_outcomes, undefined);
});

// ---------------------------------------------------------------------------
// scope
// ---------------------------------------------------------------------------

Deno.test("[IRequestFrontmatter] accepts scope with include and exclude arrays", () => {
  const fm: IRequestFrontmatter = {
    trace_id: "abc-005",
    created: "2024-01-01T00:00:00Z",
    status: "pending",
    priority: "P2",
    source: "test",
    created_by: "tester",
    scope: { include: ["src/services/"], exclude: ["tests/"] },
  };
  assertExists(fm.scope);
  assertEquals(fm.scope.include, ["src/services/"]);
  assertEquals(fm.scope.exclude, ["tests/"]);
});

Deno.test("[IRequestFrontmatter] accepts scope with only include", () => {
  const fm: IRequestFrontmatter = {
    trace_id: "abc-006",
    created: "2024-01-01T00:00:00Z",
    status: "pending",
    priority: "P2",
    source: "test",
    created_by: "tester",
    scope: { include: ["src/"] },
  };
  assertExists(fm.scope);
  assertEquals(fm.scope.include, ["src/"]);
  assertEquals(fm.scope.exclude, undefined);
});

Deno.test("[IRequestFrontmatter] scope is optional", () => {
  const fm: IRequestFrontmatter = {
    trace_id: "abc-007",
    created: "2024-01-01T00:00:00Z",
    status: "pending",
    priority: "P2",
    source: "test",
    created_by: "tester",
  };
  assertEquals(fm.scope, undefined);
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

Deno.test("[IRequestFrontmatter] existing fields unaffected by new additions", () => {
  const fm: IRequestFrontmatter = {
    trace_id: "abc-008",
    created: "2024-01-01T00:00:00Z",
    status: "pending",
    priority: "P2",
    source: "test",
    created_by: "tester",
    identity: "ExaAgent",
    portal: "/portal",
    model: "gpt-4o",
    subject: "Refactor module",
    subject_is_fallback: false,
    assessed_at: "2024-01-01T01:00:00Z",
    clarification_session_path: "/Workspace/Active/req.clarification.json",
  };
  assertEquals(fm.trace_id, "abc-008");
  assertEquals(fm.identity, "ExaAgent");
  assertEquals(fm.assessed_at, "2024-01-01T01:00:00Z");
  assertEquals(fm.acceptance_criteria, undefined);
  assertEquals(fm.expected_outcomes, undefined);
  assertEquals(fm.scope, undefined);
});
