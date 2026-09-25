/**
 * @module RequestParserEffortValidationTest
 * @path packages/request/tests/request_parser_effort_validation_test.ts
 * @description Verifies RequestParser rejects an invalid effort/thinking declaration at the
 *   request-file boundary with a typed IRequestParseRejection (naming the field and the
 *   request's trace_id), while a valid "auto" declaration parses — GAP-5's main input
 *   channel since requests are file-driven, and GAP-7's typed outcome instead of a swallowed
 *   error. The processor owns the visible RequestFailed + status transition.
 * @architectural-layer Services
 * @related-files [packages/request/src/processing/parser.ts, packages/schemas/src/model_intent.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { isRequestParseRejection, RequestParser } from "@exaix/request";
import { EventLogger } from "@exaix/core/logger";
import type { IParsedRequestFile } from "@exaix/core/request";

function frontmatterBody(extra: string, body = "Do the thing."): string {
  return `---
trace_id: "trace-123"
created: "${new Date().toISOString()}"
status: pending
priority: normal
agent_role: default
source: cli
created_by: "test@example.com"
subject: "Test"
${extra}
---
${body}
`;
}

Deno.test("RequestParser: an injected effort value returns a typed rejection naming effort with the trace", async () => {
  const filePath = join(await Deno.makeTempDir({ prefix: "req-parser-effort-" }), "request.md");
  await Deno.writeTextFile(
    filePath,
    frontmatterBody(`effort: 'high" sandbox_mode="danger-full-access'`, "Do the thing."),
  );
  const logger = new EventLogger({ prefix: "[test]" });
  const parser = new RequestParser(logger);
  try {
    const result = await parser.parse(filePath);
    assertEquals(isRequestParseRejection(result!), true, "an invalid effort must be a typed rejection");
    const rejection = result as Extract<typeof result, { rejected: true }>;
    assertEquals(rejection.field, "effort");
    assertEquals(rejection.traceId, "trace-123");
  } finally {
    await Deno.remove(filePath).catch(() => {});
  }
});

Deno.test("RequestParser: rejects effort turbo as a typed rejection", async () => {
  const filePath = join(await Deno.makeTempDir({ prefix: "req-parser-effort-" }), "request.md");
  await Deno.writeTextFile(filePath, frontmatterBody("effort: turbo", "Do the thing."));
  const logger = new EventLogger({ prefix: "[test]" });
  const parser = new RequestParser(logger);
  try {
    const result = await parser.parse(filePath);
    assertEquals(isRequestParseRejection(result!), true);
  } finally {
    await Deno.remove(filePath).catch(() => {});
  }
});

Deno.test("RequestParser: rejects a nonsense thinking value as a typed rejection naming thinking", async () => {
  const filePath = join(await Deno.makeTempDir({ prefix: "req-parser-effort-" }), "request.md");
  await Deno.writeTextFile(filePath, frontmatterBody("thinking: maybe", "Do the thing."));
  const logger = new EventLogger({ prefix: "[test]" });
  const parser = new RequestParser(logger);
  try {
    const result = await parser.parse(filePath);
    assertEquals(isRequestParseRejection(result!), true);
    const rejection = result as Extract<typeof result, { rejected: true }>;
    assertEquals(rejection.field, "thinking");
  } finally {
    await Deno.remove(filePath).catch(() => {});
  }
});

Deno.test("RequestParser: effort auto parses and reaches the parsed frontmatter", async () => {
  const filePath = join(await Deno.makeTempDir({ prefix: "req-parser-effort-" }), "request.md");
  await Deno.writeTextFile(filePath, frontmatterBody("effort: auto", "Do the thing."));
  const logger = new EventLogger({ prefix: "[test]" });
  const parser = new RequestParser(logger);
  try {
    const result = await parser.parse(filePath);
    assertEquals(result !== null && !isRequestParseRejection(result), true, "effort auto must parse");
    assertEquals((result as IParsedRequestFile).frontmatter.effort, "auto");
  } finally {
    await Deno.remove(filePath).catch(() => {});
  }
});

Deno.test("RequestParser: thinking auto parses and reaches the parsed frontmatter", async () => {
  const filePath = join(await Deno.makeTempDir({ prefix: "req-parser-effort-" }), "request.md");
  await Deno.writeTextFile(filePath, frontmatterBody("thinking: auto", "Do the thing."));
  const logger = new EventLogger({ prefix: "[test]" });
  const parser = new RequestParser(logger);
  try {
    const result = await parser.parse(filePath);
    assertEquals(result !== null && !isRequestParseRejection(result), true);
    assertEquals((result as IParsedRequestFile).frontmatter.thinking, "auto");
  } finally {
    await Deno.remove(filePath).catch(() => {});
  }
});
