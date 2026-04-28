/**
 * @module RequestSchemaTest
 * @path tests/schemas/frontmatter_test.ts
 * @description Verifies RequestSchema validation behavior for request frontmatter data.
 */

import { assertEquals } from "@std/assert";
import { RequestStatus } from "@exaix/core";
import { RequestSchema } from "@exaix/schemas/request.ts";

/**
 * Tests for Step 2.2: The Zod Frontmatter Parser
 *
 * Success Criteria (from Implementation Plan):
 * - Test 1: Valid frontmatter + Zod validation → Returns typed Request object
 * - Test 2: Missing required field (trace_id) → Throws validation error with specific field name
 * - Test 3: Invalid enum value (status: "banana") → Throws error listing valid options
 * - Test 4: Extra fields in frontmatter → Ignored (Zod strips unknown keys by default)
 * - Test 5: No frontmatter delimiters → Throws "No frontmatter found" error
 *
 * Uses YAML frontmatter format (--- delimiters).
 */

Deno.test("RequestSchema: valid frontmatter object passes validation", () => {
  const validRequest = {
    trace_id: "550e8400-e29b-41d4-a716-446655440000",
    identity_id: "coder-agent",
    status: RequestStatus.PENDING,
    priority: 8,
    tags: ["feature", "ui"],
  };

  const result = RequestSchema.parse(validRequest);

  assertEquals(result.trace_id, "550e8400-e29b-41d4-a716-446655440000");
  assertEquals(result.identity_id, "coder-agent");
  assertEquals(result.status, RequestStatus.PENDING);
  assertEquals(result.priority, 8);
  assertEquals(result.tags, ["feature", "ui"]);
});

Deno.test("RequestSchema: applies default values", () => {
  const minimalRequest = {
    trace_id: "550e8400-e29b-41d4-a716-446655440000",
    identity_id: "coder-agent",
    status: RequestStatus.PENDING,
  };

  const result = RequestSchema.parse(minimalRequest);

  assertEquals(result.priority, 5); // default
  assertEquals(result.tags, []); // default
});

Deno.test("RequestSchema: rejects missing required field (trace_id)", () => {
  const invalidRequest = {
    identity_id: "coder-agent",
    status: RequestStatus.PENDING,
  };

  try {
    RequestSchema.parse(invalidRequest);
    throw new Error("Should have thrown");
  } catch (error) {
    if (error instanceof Error) {
      // Should mention the missing field
      assertEquals(error.message.includes("trace_id"), true);
    } else {
      throw error;
    }
  }
});

Deno.test("RequestSchema: rejects invalid enum value", () => {
  const invalidRequest = {
    trace_id: "550e8400-e29b-41d4-a716-446655440000",
    identity_id: "coder-agent",
    status: "banana", // invalid
  };

  try {
    RequestSchema.parse(invalidRequest);
    throw new Error("Should have thrown");
  } catch (error) {
    if (error instanceof Error) {
      // Should list valid options
      assertEquals(error.message.includes(RequestStatus.PENDING), true);
      assertEquals(error.message.includes("in_progress"), true);
    } else {
      throw error;
    }
  }
});

Deno.test("RequestSchema: strips unknown fields", () => {
  const requestWithExtra = {
    trace_id: "550e8400-e29b-41d4-a716-446655440000",
    identity_id: "coder-agent",
    status: RequestStatus.PENDING,
    unknown_field: "should be stripped",
    another_extra: 123,
  };

  const result = RequestSchema.parse(requestWithExtra);

  assertEquals("unknown_field" in result, false);
  assertEquals("another_extra" in result, false);
});
