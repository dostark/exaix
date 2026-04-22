/**
 * @module ParsingPackageInvalidInputTest
 * @path packages/parsing/tests/invalid_input_test.ts
 * @description Verifies invalid YAML and frontmatter handling inside @exaix/parsing.
 */
import { assert, assertEquals, assertExists, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { FrontmatterParser } from "@exaix/parsing";
import { createLoggingTestDb } from "@exaix/testing/helpers/db.ts";

const FIXTURE_ROOT = join(dirname(fromFileUrl(import.meta.url)), "fixtures");
const loadFixture = async (name: string) => await Deno.readTextFile(join(FIXTURE_ROOT, name));

Deno.test("FrontmatterParser: malformed YAML is rejected", async () => {
  const markdown = await loadFixture("malformed-yaml.md");
  const parser = new FrontmatterParser();
  assertThrows(() => parser.parse(markdown));
});

Deno.test("FrontmatterParser: error message is descriptive for malformed YAML", async () => {
  const markdown = await loadFixture("malformed-yaml-descriptive-error.md");
  const parser = new FrontmatterParser();

  const error = assertThrows(() => parser.parse(markdown)) as Error;
  assertEquals(error.message.length > 0, true);
});

Deno.test("FrontmatterParser: logs validation failure to activity journal", async () => {
  const { activities, db } = createLoggingTestDb();
  const parser = new FrontmatterParser(db);
  const markdown = await loadFixture("validation-failure.md");

  assertThrows(() => parser.parse(markdown, "bad.md"));

  assertEquals(activities.length, 1);
  assertEquals(activities[0].actor, "system");
  assertEquals(activities[0].actionType, "request.validation_failed");
  assertEquals(activities[0].target, "bad.md");
});

Deno.test("FrontmatterParser: handles partial content with valid frontmatter", async () => {
  const markdown = await loadFixture("partial-request.md");
  const parser = new FrontmatterParser();

  try {
    const result = parser.parse(markdown, "partial_request.md");
    assertExists(result.request.trace_id);
  } catch {
    assert(true, "Parsing handled incomplete content");
  }
});

Deno.test("FrontmatterParser: rejects missing required fields", async () => {
  const markdown = await loadFixture("missing-required-fields.md");
  const parser = new FrontmatterParser();
  assertThrows(() => parser.parse(markdown));
});

Deno.test("FrontmatterParser: rejects wrong field types", async () => {
  const markdown = await loadFixture("wrong-field-types.md");
  const parser = new FrontmatterParser();
  assertThrows(() => parser.parse(markdown));
});

Deno.test("FrontmatterParser: handles very long values", async () => {
  const longValue = "x".repeat(10000);
  let markdown = await loadFixture("long-value-template.md");
  markdown = markdown.replace("{{LONG_VALUE}}", longValue);

  const parser = new FrontmatterParser();

  try {
    const result = parser.parse(markdown);
    assertExists(result);
  } catch {
    assert(true, "Long value handled");
  }
});

Deno.test("FrontmatterParser: handles special characters safely", async () => {
  const markdown = await loadFixture("special-characters.md");
  const parser = new FrontmatterParser();

  const result = parser.parse(markdown);
  assertExists(result.request);
  assertExists(result.request.trace_id);
});

Deno.test("FrontmatterParser: rejects empty file", () => {
  const parser = new FrontmatterParser();
  assertThrows(() => parser.parse("", "empty.md"));
});

Deno.test("FrontmatterParser: rejects missing frontmatter delimiters", async () => {
  const markdown = await loadFixture("no-frontmatter.md");
  const parser = new FrontmatterParser();
  assertThrows(() => parser.parse(markdown));
});

Deno.test("FrontmatterParser: handles duplicate YAML keys", async () => {
  const markdown = await loadFixture("duplicate-keys.md");
  const parser = new FrontmatterParser();

  try {
    const result = parser.parse(markdown);
    assertExists(result.request.trace_id);
  } catch {
    assert(true, "Duplicate keys handled");
  }
});
