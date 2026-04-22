/**
 * @module RequestSpecificationSchemaTest
 * @path tests/schemas/request_specification_test.ts
 * @description Tests for the RequestSpecificationSchema, verifying validation
 * of structured request specification output produced by the clarification
 * Q&A loop engine.
 * @architectural-layer Shared
 * @related-files [src/shared/schemas/request_specification.ts]
 */

import { assertEquals } from "@std/assert";
import { RequestSpecificationSchema } from "@exaix/schemas/request_specification.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validSpec() {
  return {
    summary: "Implement user authentication with JWT",
    goals: ["Add login endpoint", "Issue JWT tokens on success"],
    successCriteria: ["POST /auth/login returns 200 on valid credentials"],
    scope: {
      includes: ["auth module", "user table"],
      excludes: ["password reset flow"],
    },
    constraints: ["Use existing DB schema", "No new dependencies"],
    context: ["Current user model has email + password_hash fields"],
    originalBody: "add login to the app",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("[RequestSpecificationSchema] validates complete specification", () => {
  const result = RequestSpecificationSchema.safeParse(validSpec());
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.summary, "Implement user authentication with JWT");
    assertEquals(result.data.goals.length, 2);
    assertEquals(result.data.successCriteria.length, 1);
  }
});

Deno.test("[RequestSpecificationSchema] validates scope includes/excludes", () => {
  const result = RequestSpecificationSchema.safeParse(validSpec());
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.scope.includes.length, 2);
    assertEquals(result.data.scope.excludes.length, 1);
  }
});

Deno.test("[RequestSpecificationSchema] preserves originalBody", () => {
  const result = RequestSpecificationSchema.safeParse(validSpec());
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.originalBody, "add login to the app");
  }
});

Deno.test("[RequestSpecificationSchema] allows empty arrays for optional list fields", () => {
  const minimal = {
    ...validSpec(),
    goals: [],
    successCriteria: [],
    constraints: [],
    context: [],
    scope: { includes: [], excludes: [] },
  };
  const result = RequestSpecificationSchema.safeParse(minimal);
  assertEquals(result.success, true);
});

Deno.test("[RequestSpecificationSchema] rejects missing summary", () => {
  const { summary: _removed, ...withoutSummary } = validSpec();
  const result = RequestSpecificationSchema.safeParse(withoutSummary);
  assertEquals(result.success, false);
});

Deno.test("[RequestSpecificationSchema] rejects missing originalBody", () => {
  const { originalBody: _removed, ...withoutBody } = validSpec();
  const result = RequestSpecificationSchema.safeParse(withoutBody);
  assertEquals(result.success, false);
});

Deno.test("[RequestSpecificationSchema] rejects missing scope", () => {
  const { scope: _removed, ...withoutScope } = validSpec();
  const result = RequestSpecificationSchema.safeParse(withoutScope);
  assertEquals(result.success, false);
});
