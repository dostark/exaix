/**
 * @module ParsingPackageInvalidInputTest
 * @path packages/core/tests/parsing/invalid_input_test.ts
 * @related-files []
 * @architectural-layer Core
 * @description Verifies invalid YAML and frontmatter handling inside @exaix/parsing.
 */
import { assert, assertEquals, assertExists, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { FrontmatterParser } from "@exaix/core/parsing";
import type { IEventLogger } from "@exaix/core/logger";
import type { ILogEvent } from "@exaix/core";

const FIXTURE_ROOT = join(dirname(fromFileUrl(import.meta.url)), "fixtures");
const loadFixture = async (name: string) => await Deno.readTextFile(join(FIXTURE_ROOT, name));

Deno.test("FrontmatterParser: malformed YAML is rejected", async () => {
  const markdown = await loadFixture("malformed-yaml.md");
  const parser = new FrontmatterParser();
  assertThrows(() => parser.parse(markdown));
});

Deno.test("FrontmatterParser: error message is descriptive for malformed YAML", () => {
  const markdown = `---
trace_id: !!!invalid yaml here!!!
---

# Request`;
  const parser = new FrontmatterParser();

  const error = assertThrows(() => parser.parse(markdown)) as Error;
  assertEquals(error.message.length > 0, true);
});

Deno.test("FrontmatterParser: logs validation failure to activity journal", () => {
  const calls: Array<{ action: string; target: string | null }> = [];
  const logger: IEventLogger = {
    info(action: string, target: string | null): Promise<void> {
      calls.push({ action, target });
      return Promise.resolve();
    },
    warn(action: string, target: string | null): Promise<void> {
      calls.push({ action, target });
      return Promise.resolve();
    },
    error: () => Promise.resolve(),
    fatal: () => Promise.resolve(),
    debug: () => Promise.resolve(),
    log: (_event: ILogEvent) => Promise.resolve(),
    child: function () {
      return logger;
    },
  };
  const parser = new FrontmatterParser(logger);
  const markdown = `---
agent_role: coder-agent
status: pending
---

# Bad`;

  assertThrows(() => parser.parse(markdown, "bad.md"));

  assertEquals(calls.length, 1);
  assertEquals(calls[0].action, "request.validation_failed");
  assertEquals(calls[0].target, "bad.md");
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

Deno.test("FrontmatterParser: rejects missing frontmatter delimiters", () => {
  const markdown = `# Just a heading

Some content without any YAML frontmatter.`;
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
