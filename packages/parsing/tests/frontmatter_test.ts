/**
 * @module ParsingPackageFrontmatterTest
 * @path packages/parsing/tests/frontmatter_test.ts
 * @description Verifies @exaix/parsing frontmatter parsing behavior, including validation and activity logging.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { RequestStatus } from "../../../src/shared/status/request_status.ts";
import { FrontmatterParser } from "@exaix/parsing";
import { createLoggingTestDb } from "@exaix/testing/helpers/db.ts";

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
- \"Remember me\" checkbox
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

No frontmatter here!\n`;
  const parser = new FrontmatterParser();
  const error = assertThrows(() => parser.parse(markdown)) as Error;

  assertEquals(error.message.includes("No frontmatter found"), true);
});

Deno.test("FrontmatterParser: logs successful validation", async () => {
  const { db, cleanup } = await createLoggingTestDb();
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

    await new Promise((resolve) => setTimeout(resolve, 150));
    const rows = db.getActivitiesByActionType("request.validated");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].actor, "system");
    assertEquals(rows[0].action_type, "request.validated");
    assertEquals(rows[0].target, "test.md");
  } finally {
    await cleanup();
  }
});

Deno.test("FrontmatterParser: logs validation failure", async () => {
  const { db, cleanup } = await initTestDbService();
  try {
    const parser = new FrontmatterParser(db);
    const markdown = `---
identity_id: coder-agent
status: pending
---

# Bad
`;

    assertThrows(() => parser.parse(markdown, "bad.md"));

    await new Promise((resolve) => setTimeout(resolve, 150));
    const rows = db.getActivitiesByActionType("request.validation_failed");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].actor, "system");
    assertEquals(rows[0].action_type, "request.validation_failed");
    assertEquals(rows[0].target, "bad.md");
  } finally {
    await cleanup();
  }
});
