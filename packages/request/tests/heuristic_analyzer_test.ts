/**
 * @module HeuristicAnalyzerTest
 * @path tests/services/request_analysis/heuristic_analyzer_test.ts
 * @description Tests for the heuristic (zero-cost) request analysis strategy.
 * Covers file reference detection, keyword extraction, complexity classification,
 * ambiguity signal detection, task type classification, and edge cases.
 */

import { assertEquals, assertExists } from "@std/assert";
import { analyzeHeuristic } from "@exaix/request";
import { AmbiguityImpact, RequestAnalysisComplexity, RequestTaskType } from "@exaix/schemas/request_analysis.ts";

// ---------------------------------------------------------------------------
// File reference detection
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAnalyzer] detects file references in request text", () => {
  const text = `
    Please refactor \`src/services/foo.ts\` and update the test in
    \`tests/services/foo_test.ts\`. Also check \`src/shared/schemas/bar.ts\`.
  `;
  const result = analyzeHeuristic(text);
  assertExists(result.referencedFiles);
  assertEquals(result.referencedFiles!.includes("src/services/foo.ts"), true);
  assertEquals(result.referencedFiles!.includes("tests/services/foo_test.ts"), true);
  assertEquals(result.referencedFiles!.includes("@exaix/schemas/bar.ts"), true);
});

Deno.test("[HeuristicAnalyzer] detects unquoted file paths with extensions", () => {
  const text = "Update apps/exactl/src/main.ts to add new command and write tests/cli/main_test.ts.";
  const result = analyzeHeuristic(text);
  assertExists(result.referencedFiles);
  assertEquals(result.referencedFiles!.some((f: string) => f.includes("apps/exactl/src/main.ts")), true);
});

Deno.test("[HeuristicAnalyzer] returns empty referencedFiles when none present", () => {
  const result = analyzeHeuristic("Add a new feature to the codebase.");
  assertEquals(result.referencedFiles, []);
});

// ---------------------------------------------------------------------------
// Keyword / tag extraction
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAnalyzer] extracts action verbs as tags", () => {
  const text = "Implement a new cache layer. Refactor the database service. Add tests for it.";
  const result = analyzeHeuristic(text);
  assertExists(result.tags);
  // Should contain at least the dominant verb as a tag
  const joined = result.tags!.join(" ").toLowerCase();
  assertEquals(joined.includes("implement") || joined.includes("refactor") || joined.includes("add"), true);
});

// ---------------------------------------------------------------------------
// Complexity classification
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAnalyzer] classifies simple single-line request", () => {
  const text = "Fix typo in README.";
  const result = analyzeHeuristic(text);
  assertEquals(result.complexity, RequestAnalysisComplexity.SIMPLE);
});

Deno.test("[HeuristicAnalyzer] classifies medium multi-step request (default)", () => {
  const text = `
    Add a \`getUser(id)\` method to UserService that queries the database
    and returns the user or null. Include error handling and write a test.
  `;
  const result = analyzeHeuristic(text);
  // Medium is the expected default for a 2-3 bullet equivalent request
  assertEquals(
    result.complexity === RequestAnalysisComplexity.MEDIUM ||
      result.complexity === RequestAnalysisComplexity.SIMPLE,
    true,
  );
});

Deno.test("[HeuristicAnalyzer] classifies complex multi-requirement request", () => {
  // style-exclude:FIXTURE_READABILITY - The inline request sample is intentionally embedded for readability and demonstration.
  const text = `
    Implement a full caching layer for the API:
    - Add Redis client configuration
    - Create CacheService with get/set/delete/invalidate methods
    - Integrate into UserService, ProductService, and OrderService
    - Add cache key namespacing per service
    - Implement TTL support with configurable defaults
    - Add circuit breaker on cache miss
    - Update all related tests in tests/services/
    - Add integration test for cache invalidation flow
    - Document all public methods
    - Ensure no breaking changes to existing API contracts
    - Add Prometheus metrics for cache hit/miss ratio
    - Export cache stats endpoint in diagnostics controller
  `;
  const result = analyzeHeuristic(text);
  assertEquals(result.complexity, RequestAnalysisComplexity.COMPLEX);
});

Deno.test("[HeuristicAnalyzer] classifies epic multi-phase request", () => {
  const text = `
    Phase 1: Design the new authentication architecture.
    Phase 2: Implement OAuth2 provider integrations.
    Phase 3: Migrate existing sessions.
    Phase 4: Deprecate legacy auth endpoints.
  `;
  const result = analyzeHeuristic(text);
  assertEquals(result.complexity, RequestAnalysisComplexity.EPIC);
});

// ---------------------------------------------------------------------------
// Ambiguity detection
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAnalyzer] detects ambiguity signals in vague requests", () => {
  const text = "Maybe fix that thing. It should probably work better somehow.";
  const result = analyzeHeuristic(text);
  assertExists(result.ambiguities);
  assertEquals(result.ambiguities!.length > 0, true);
});

Deno.test("[HeuristicAnalyzer] detects question marks as ambiguity signals", () => {
  const text = "Should we use Redis or Memcached? Which TTL makes sense? Maybe 5 minutes?";
  const result = analyzeHeuristic(text);
  assertExists(result.ambiguities);
  assertEquals(result.ambiguities!.length > 0, true);
});

Deno.test("[HeuristicAnalyzer] detects no ambiguity in well-specified requests", () => {
  const text = "Add a `createUser(email: string, role: Role): Promise<IUser>` method to UserService. " +
    "It must validate the email format, check for duplicates, and throw `DuplicateEmailError` on conflict. " +
    "Write tests in tests/services/user_service_test.ts.";
  const result = analyzeHeuristic(text);
  // A well-specified request should have fewer ambiguities (or fewer high-impact ones)
  const highImpact = (result.ambiguities ?? []).filter(
    (a: { impact: AmbiguityImpact }) => a.impact === AmbiguityImpact.HIGH,
  );
  assertEquals(highImpact.length, 0);
});

// ---------------------------------------------------------------------------
// Task type classification
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAnalyzer] classifies task type from 'fix' verb as bugfix", () => {
  const text = "Fix the NullPointerException in OrderService.processPayment().";
  const result = analyzeHeuristic(text);
  assertEquals(result.taskType, RequestTaskType.BUGFIX);
});

Deno.test("[HeuristicAnalyzer] classifies task type from 'refactor' verb", () => {
  const text = "Refactor the authentication module to use the new token strategy.";
  const result = analyzeHeuristic(text);
  assertEquals(result.taskType, RequestTaskType.REFACTOR);
});

Deno.test("[HeuristicAnalyzer] classifies task type from 'add tests' as test", () => {
  const text = "Add unit tests for the CacheService class.";
  const result = analyzeHeuristic(text);
  assertEquals(result.taskType, RequestTaskType.TEST);
});

Deno.test("[HeuristicAnalyzer] classifies task type from 'document' as docs", () => {
  const text = "Document the public API of RequestAnalyzer in docs/API.md.";
  const result = analyzeHeuristic(text);
  assertEquals(result.taskType, RequestTaskType.DOCS);
});

Deno.test("[HeuristicAnalyzer] classifies task type from 'implement' as feature", () => {
  const text = "Implement a new webhook notification system for plan completions.";
  const result = analyzeHeuristic(text);
  assertEquals(result.taskType, RequestTaskType.FEATURE);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAnalyzer] handles empty request text gracefully", () => {
  const result = analyzeHeuristic("");
  assertExists(result);
  assertEquals(result.referencedFiles, []);
  assertEquals(result.tags, []);
  assertEquals(result.ambiguities, []);
});

Deno.test("[HeuristicAnalyzer] handles Unicode and special characters", () => {
  // Should not throw; returns partial analysis
  const result = analyzeHeuristic("Добавить фичу 🚀 — fix bug in über-service. Implement café module.");
  assertExists(result);
  assertEquals(Array.isArray(result.referencedFiles), true);
});

// ---------------------------------------------------------------------------
// Step 21: Ambiguity objects include interpretations field
// ---------------------------------------------------------------------------

Deno.test("[HeuristicAnalyzer] ambiguity objects include empty interpretations array", () => {
  const text = "Maybe fix that thing somehow. It should probably work better.";
  const result = analyzeHeuristic(text);
  assertExists(result.ambiguities);
  assertEquals((result.ambiguities?.length ?? 0) > 0, true);
  for (const amb of result.ambiguities ?? []) {
    assertExists((amb as { interpretations?: string[] }).interpretations);
    assertEquals(Array.isArray((amb as { interpretations?: string[] }).interpretations), true);
  }
});
