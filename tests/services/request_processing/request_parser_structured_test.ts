/**
 * @module RequestParserStructuredTest
 * @path tests/services/request_processing/request_parser_structured_test.ts
 * @description Tests for structured frontmatter field extraction and runtime
 * guards (acceptance_criteria, expected_outcomes, scope) in RequestParser
 * (Phase 49, Step 9).
 * @architectural-layer Tests
 * @related-files [.copilot/planning/phase-49-quality-pipeline-hardening.md]
 */
import { assertEquals, assertExists } from "@std/assert";
import { RequestParser } from "../../../src/services/request_processing/request_parser.ts";
import type { EventLogger } from "@exaix/core/logger/event_logger.ts";
import type { JSONObject } from "@exaix/core/types/json.ts";
import type { ParsedRequestFile } from "@exaix/core/request/mod.ts";
// ---------------------------------------------------------------------------
// Logger helpers
// ---------------------------------------------------------------------------

interface LogEntry {
  level: "error" | "warn";
  action: string;
  target: string;
}

function createLogger(entries: LogEntry[]): EventLogger {
  return {
    error: (action: string, target: string, _payload?: JSONObject) => {
      entries.push({ level: "error", action, target });
      return Promise.resolve();
    },
    warn: (action: string, target: string, _payload?: JSONObject) => {
      entries.push({ level: "warn", action, target });
      return Promise.resolve();
    },
  } as Partial<EventLogger> as EventLogger;
}

// ---------------------------------------------------------------------------
// YAML file helpers
// ---------------------------------------------------------------------------

async function withTempFile(content: string, fn: (path: string) => Promise<void>): Promise<void> {
  const tmpPath = await Deno.makeTempFile({ suffix: ".md" });
  try {
    await Deno.writeTextFile(tmpPath, content);
    await fn(tmpPath);
  } finally {
    await Deno.remove(tmpPath);
  }
}

function buildRequestContent(extraFields: string): string {
  return `---
trace_id: "test-001"
created: "2024-01-01T00:00:00Z"
status: pending
priority: P2
source: cli
created_by: tester
${extraFields}
---

Request body text.
`;
}

async function parseRequestWithFields(
  extraFields: string,
): Promise<{ frontmatter: ParsedRequestFile["frontmatter"]; logs: LogEntry[] }> {
  const logs: LogEntry[] = [];
  const parser = new RequestParser(createLogger(logs));
  const content = buildRequestContent(extraFields);
  const tmpPath = await Deno.makeTempFile({ suffix: ".md" });
  try {
    await Deno.writeTextFile(tmpPath, content);
    const result = await parser.parse(tmpPath);
    assertExists(result);
    return { frontmatter: result.frontmatter, logs };
  } finally {
    await Deno.remove(tmpPath);
  }
}

// ---------------------------------------------------------------------------
// Extraction tests (GREEN — fields present and valid)
// ---------------------------------------------------------------------------

Deno.test("[RequestParser] extracts acceptance_criteria from frontmatter", async () => {
  const { frontmatter, logs } = await parseRequestWithFields(
    'acceptance_criteria:\n  - "criterion one"\n  - "criterion two"',
  );
  assertEquals(frontmatter.acceptance_criteria, ["criterion one", "criterion two"]);
  assertEquals(logs.filter((l) => l.level === "warn").length, 0);
});

Deno.test("[RequestParser] extracts expected_outcomes from frontmatter", async () => {
  const { frontmatter, logs } = await parseRequestWithFields(
    'expected_outcomes:\n  - "output file created"\n  - "no lint errors"',
  );
  assertEquals(frontmatter.expected_outcomes, ["output file created", "no lint errors"]);
  assertEquals(logs.filter((l) => l.level === "warn").length, 0);
});

Deno.test("[RequestParser] extracts scope from frontmatter", async () => {
  const { frontmatter, logs } = await parseRequestWithFields(
    'scope:\n  include:\n    - "src/"\n  exclude:\n    - "tests/"',
  );
  assertExists(frontmatter.scope);
  assertEquals(frontmatter.scope.include, ["src/"]);
  assertEquals(frontmatter.scope.exclude, ["tests/"]);
  assertEquals(logs.filter((l) => l.level === "warn").length, 0);
});

// ---------------------------------------------------------------------------
// Guard tests (RED until runtime guards added to parser)
// ---------------------------------------------------------------------------

Deno.test(
  "[RequestParser] handles malformed acceptance_criteria gracefully (strips + warns)",
  async () => {
    // acceptance_criteria is a plain string, not an array
    const content = buildRequestContent('acceptance_criteria: "not an array"');
    const logs: LogEntry[] = [];
    const parser = new RequestParser(createLogger(logs));

    await withTempFile(content, async (path) => {
      const result = await parser.parse(path);
      assertExists(result);
      // Field must be stripped (undefined), not passed through as a string
      assertEquals(result.frontmatter.acceptance_criteria, undefined);
      // A warning must be logged
      assertEquals(logs.filter((l) => l.level === "warn").length >= 1, true);
    });
  },
);

Deno.test(
  "[RequestParser] handles malformed expected_outcomes gracefully (strips + warns)",
  async () => {
    const content = buildRequestContent("expected_outcomes: 42");
    const logs: LogEntry[] = [];
    const parser = new RequestParser(createLogger(logs));

    await withTempFile(content, async (path) => {
      const result = await parser.parse(path);
      assertExists(result);
      assertEquals(result.frontmatter.expected_outcomes, undefined);
      assertEquals(logs.filter((l) => l.level === "warn").length >= 1, true);
    });
  },
);

Deno.test(
  "[RequestParser] handles malformed scope (non-object value) gracefully (strips + warns)",
  async () => {
    // scope is a plain string, not an object
    const content = buildRequestContent('scope: "bad-string"');
    const logs: LogEntry[] = [];
    const parser = new RequestParser(createLogger(logs));

    await withTempFile(content, async (path) => {
      const result = await parser.parse(path);
      assertExists(result);
      assertEquals(result.frontmatter.scope, undefined);
      assertEquals(logs.filter((l) => l.level === "warn").length >= 1, true);
    });
  },
);

Deno.test(
  "[RequestParser] handles malformed scope (array value) gracefully (strips + warns)",
  async () => {
    // scope is a YAML array, not an object with include/exclude keys
    const content = buildRequestContent('scope:\n  - "item1"');
    const logs: LogEntry[] = [];
    const parser = new RequestParser(createLogger(logs));

    await withTempFile(content, async (path) => {
      const result = await parser.parse(path);
      assertExists(result);
      assertEquals(result.frontmatter.scope, undefined);
      assertEquals(logs.filter((l) => l.level === "warn").length >= 1, true);
    });
  },
);

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

Deno.test("[RequestParser] parses existing files without new fields unchanged", async () => {
  const content = buildRequestContent("");
  const logs: LogEntry[] = [];
  const parser = new RequestParser(createLogger(logs));

  await withTempFile(content, async (path) => {
    const result = await parser.parse(path);
    assertExists(result);
    assertEquals(result.frontmatter.trace_id, "test-001");
    assertEquals(result.frontmatter.acceptance_criteria, undefined);
    assertEquals(result.frontmatter.expected_outcomes, undefined);
    assertEquals(result.frontmatter.scope, undefined);
    assertEquals(logs.filter((l) => l.level === "warn").length, 0);
  });
});
