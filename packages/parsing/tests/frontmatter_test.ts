/**
 * @module ParsingPackageFrontmatterTest
 * @path packages/parsing/tests/frontmatter_test.ts
 * @description Verifies @exaix/parsing frontmatter parsing behavior, including validation and activity logging.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { RequestStatus } from "@exaix/core/status";
import { FrontmatterParser } from "@exaix/parsing";
import { createLoggingTestDb } from "@exaix/testing";

const FIXTURE_ROOT = join(dirname(fromFileUrl(import.meta.url)), "fixtures");
const loadFixture = async (name: string) => await Deno.readTextFile(join(FIXTURE_ROOT, name));

Deno.test("FrontmatterParser: valid markdown with YAML frontmatter", async () => {
  const markdown = await loadFixture("valid-request.md");
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

No frontmatter here!`;
  const parser = new FrontmatterParser();
  const error = assertThrows(() => parser.parse(markdown)) as Error;

  assertEquals(error.message.includes("No frontmatter found"), true);
});

Deno.test("FrontmatterParser: logs successful validation", async () => {
  const { activities, db } = createLoggingTestDb();
  const parser = new FrontmatterParser(db);
  const markdown = await loadFixture("validated-request.md");

  const result = parser.parse(markdown, "test.md");
  assertEquals(result.request.trace_id, "550e8400-e29b-41d4-a716-446655440000");

  assertEquals(activities.length, 1);
  assertEquals(activities[0].actor, "system");
  assertEquals(activities[0].actionType, "request.validated");
  assertEquals(activities[0].target, "test.md");
});

Deno.test("FrontmatterParser: logs validation failure", () => {
  const { activities, db } = createLoggingTestDb();
  const parser = new FrontmatterParser(db);
  const markdown = `---
identity_id: coder-agent
status: pending
---

# Bad`;

  assertThrows(() => parser.parse(markdown, "bad.md"));

  assertEquals(activities.length, 1);
  assertEquals(activities[0].actor, "system");
  assertEquals(activities[0].actionType, "request.validation_failed");
  assertEquals(activities[0].target, "bad.md");
});
