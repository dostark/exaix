/**
 * @module FrontmatterParserTest
 * @path tests/schemas/frontmatter_test.ts
 * @description Verifies the YAML frontmatter parsing logic, ensuring stable
 * serialization and validation of metadata across all project file types.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { RequestStatus } from "../../../src/shared/status/request_status.ts";

import { RequestSchema } from "@exaix/schemas/request.ts";
import { FrontmatterParser } from "../../../src/parsers/markdown.ts";
import { initTestDbService } from "../../../tests/helpers/db.ts";

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

Deno.test("FrontmatterParser: valid markdown with YAML frontmatter", () => {
  const markdown = `---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
identity_id: coder-agent
status: pending
priority: 8
tags: [feature, ui]
---

# Implement Login Page

Create a modern login page with:
- Email/password fields
- "Remember me" checkbox
`;

  const parser = new FrontmatterParser();
  const result = parser.parse(markdown);

  assertEquals(result.request.trace_id, "550e8400-e29b-41d4-a716-446655440000");
  assertEquals(result.request.identity_id, "coder-agent");
  assertEquals(result.request.status, RequestStatus.PENDING);
  assertEquals(result.request.priority, 8);
  assertEquals(result.request.tags, ["feature", "ui"]);
  assertEquals(result.body.includes("Implement Login Page"), true);
  assertEquals(result.body.includes("Email/password"), true);
});

Deno.test("FrontmatterParser: throws on missing frontmatter delimiters", () => {
  const markdown = `# Just a title

No frontmatter here!
`;

  const parser = new FrontmatterParser();

  const error = assertThrows(
    () => parser.parse(markdown),
  ) as Error;

  assertEquals(error.message.includes("No frontmatter found"), true);
  assertEquals(error.message.includes("---"), true);
});

Deno.test("FrontmatterParser: throws on invalid YAML syntax", () => {
  const markdown = `---
trace_id: "missing-closing-quote
identity_id: coder-agent
---

Body content
`;

  const parser = new FrontmatterParser();

  assertThrows(() => parser.parse(markdown));
});

Deno.test("FrontmatterParser: throws on validation error with field details", () => {
  const markdown = `---
identity_id: coder-agent
status: pending
---

Missing trace_id field
`;

  const parser = new FrontmatterParser();

  const error = assertThrows(
    () => parser.parse(markdown),
  ) as Error;

  // Should mention validation failure
  assertEquals(error.message.includes("validation") || error.message.includes("trace_id"), true);
});

Deno.test("FrontmatterParser: handles empty body content", () => {
  const markdown = `---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
identity_id: coder-agent
status: pending
---
`;

  const parser = new FrontmatterParser();
  const result = parser.parse(markdown);

  assertEquals(result.body.trim(), "");
  assertEquals(result.request.trace_id, "550e8400-e29b-41d4-a716-446655440000");
});

Deno.test("FrontmatterParser: YAML with datetime parses correctly", () => {
  const markdown = `---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
identity_id: coder-agent
status: pending
created_at: "2025-11-27T10:30:00Z"
---

Body content
`;

  const parser = new FrontmatterParser();
  const result = parser.parse(markdown);

  assertEquals(result.request.trace_id, "550e8400-e29b-41d4-a716-446655440000");
  assertEquals(result.request.created_at, "2025-11-27T10:30:00Z");
});

Deno.test("FrontmatterParser: handles special characters in strings", () => {
  const markdown = `---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
identity_id: coder-agent
status: pending
---

# Fix: Bug with colons and "quotes"

Content with special chars: test = value
`;

  const parser = new FrontmatterParser();
  const result = parser.parse(markdown);

  assertEquals(result.request.trace_id, "550e8400-e29b-41d4-a716-446655440000");
  assertEquals(result.body.includes("Fix: Bug"), true);
  assertEquals(result.body.includes("quotes"), true);
});

Deno.test("FrontmatterParser logs successful validation", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const parser = new FrontmatterParser(db);
    const markdown = `---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
identity_id: coder-agent
status: pending
priority: 8
tags: [feature, ui]
---

# Test
`;
    const result = parser.parse(markdown, "test.md");
    assertEquals(result.request.trace_id, "550e8400-e29b-41d4-a716-446655440000");

    // Allow time for batched write to flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    const rows = db.getActivitiesByActionType("request.validated");
    assertEquals(rows.length, 1);
    const { actor, action_type, target, payload } = rows[0];
    assertEquals(actor, "system");
    assertEquals(action_type, "request.validated");
    assertEquals(target, "test.md");
    const payloadObj = JSON.parse(payload);
    assertEquals(payloadObj.trace_id, "550e8400-e29b-41d4-a716-446655440000");
  } finally {
    await cleanup();
  }
});

Deno.test("FrontmatterParser logs validation failure", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const parser = new FrontmatterParser(db);
    const markdown = `---
identity_id: coder-agent
status: pending
---

# Bad
`;
    let caught = false;
    try {
      parser.parse(markdown, "bad.md");
    } catch {
      caught = true;
    }
    assertEquals(caught, true);

    // Allow time for batched write to flush
    await new Promise((resolve) => setTimeout(resolve, 150));

    const rows = db.getActivitiesByActionType("request.validation_failed");
    assertEquals(rows.length, 1);
    const { actor, action_type, target, payload } = rows[0];
    assertEquals(actor, "system");
    assertEquals(action_type, "request.validation_failed");
    assertEquals(target, "bad.md");
    const payloadObj = JSON.parse(payload);
    assertEquals(Array.isArray(payloadObj.errors), true);
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Additional Coverage Tests
// ============================================================================

Deno.test("FrontmatterParser: handles frontmatter that is not an object", () => {
  // YAML that parses to a string instead of object
  const markdown = `---
just a string value
---

Body content
`;

  const parser = new FrontmatterParser();

  const error = assertThrows(
    () => parser.parse(markdown),
  ) as Error;

  assertEquals(error.message.includes("object") || error.message.includes("validation"), true);
});

Deno.test("FrontmatterParser: handles YAML array frontmatter", () => {
  // YAML that parses to an array instead of object
  const markdown = `---
- item1
- item2
---

Body content
`;

  const parser = new FrontmatterParser();

  const error = assertThrows(
    () => parser.parse(markdown),
  ) as Error;

  // Should fail validation since array is not expected schema
  assertEquals(error.message.includes("validation") || error.message.includes("object"), true);
});

Deno.test("FrontmatterParser: handles null frontmatter", () => {
  // Empty YAML block that parses to null
  const markdown = `---
---

Body content
`;

  const parser = new FrontmatterParser();

  const error = assertThrows(
    () => parser.parse(markdown),
  ) as Error;

  assertEquals(error.message.includes("object") || error.message.includes("frontmatter"), true);
});

Deno.test("FrontmatterParser: logs activity without file_path", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const parser = new FrontmatterParser(db);
    const markdown = `---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
identity_id: coder-agent
status: pending
---

# Test
`;
    // Parse without providing filePath
    const result = parser.parse(markdown);
    assertEquals(result.request.trace_id, "550e8400-e29b-41d4-a716-446655440000");

    // Allow time for batched write
    await new Promise((resolve) => setTimeout(resolve, 150));

    const rows = db.getActivitiesByActionType("request.validated");
    assertEquals(rows.length >= 1, true);
  } finally {
    await cleanup();
  }
});

Deno.test("FrontmatterParser: handles YAML parsing exception gracefully", () => {
  // Severely malformed YAML that might throw unexpected error
  const markdown = `---
key: value
  bad indent: [unclosed
another: "missing quote
---

Body
`;

  const parser = new FrontmatterParser();

  assertThrows(
    () => parser.parse(markdown),
    Error,
  );
});

Deno.test("FrontmatterParser: handles valid frontmatter with all optional fields", () => {
  const markdown = `---
trace_id: "550e8400-e29b-41d4-a716-446655440000"
identity_id: senior-coder
status: in_progress
priority: 10
tags: [urgent, bug-fix, security]
created_at: "2025-12-01T10:00:00Z"
---

Full content here
`;

  const parser = new FrontmatterParser();
  const result = parser.parse(markdown);

  assertEquals(result.request.trace_id, "550e8400-e29b-41d4-a716-446655440000");
  assertEquals(result.request.status, "in_progress");
  assertEquals(result.request.priority, 10);
  assertEquals(result.request.tags?.length, 3);
  assertEquals(result.request.created_at, "2025-12-01T10:00:00Z");
});
