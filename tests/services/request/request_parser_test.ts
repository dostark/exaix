/**
 * @module RequestParserTest
 * @path tests/services/request/request_parser_test.ts
 * @description Verifies the RequestParser's ability to extract structured data from Markdown
 * request files, ensuring strict validation of frontmatter fields and trace identifiers.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { RequestParser } from "../../../src/services/request_processing/request_parser.ts";
import { RequestStatus } from "@exaix/core";
import type { EventLogger } from "../../../src/services/core/event_logger.ts";
import {
  TEST_LOG_ACTION_FILE_NOT_FOUND,
  TEST_LOG_ACTION_FRONTMATTER_INVALID,
  TEST_LOG_ACTION_MISSING_TRACE_ID,
  TEST_LOG_ACTION_PARSE_FAILED,
  TEST_REQUEST_AGENT,
  TEST_REQUEST_BODY,
  TEST_REQUEST_CREATED_AT,
  TEST_REQUEST_CREATED_BY,
  TEST_REQUEST_FILE_NAME,
  TEST_REQUEST_INVALID_YAML,
  TEST_REQUEST_PRIORITY,
  TEST_REQUEST_SOURCE,
  TEST_REQUEST_STATUS_UNKNOWN,
  TEST_REQUEST_STATUS_VALID,
  TEST_REQUEST_TRACE_ID,
} from "../../config/constants.ts";
import type { JSONObject } from "@exaix/core/types/json.ts";

interface LoggedError {
  action: string;
  target: string;
  payload?: JSONObject;
}

function createLogger(errors: LoggedError[]) {
  return {
    error: (action: string, target: string, payload?: JSONObject) => {
      errors.push({ action, target, payload });
      return Promise.resolve();
    },
  } as Partial<EventLogger> as EventLogger;
}

function buildFrontmatter(traceId?: string, status?: string): string {
  const fields = [
    traceId ? `trace_id: "${traceId}"` : null,
    `created: "${TEST_REQUEST_CREATED_AT}"`,
    `status: ${status ?? TEST_REQUEST_STATUS_VALID}`,
    `priority: ${TEST_REQUEST_PRIORITY}`,
    `identity: ${TEST_REQUEST_AGENT}`,
    `source: ${TEST_REQUEST_SOURCE}`,
    `created_by: "${TEST_REQUEST_CREATED_BY}"`,
  ].filter(Boolean);

  return `---\n${fields.join("\n")}\n---\n\n${TEST_REQUEST_BODY}\n`;
}

async function withTempRequestFile(
  testFn: (filePath: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    const filePath = join(tempDir, TEST_REQUEST_FILE_NAME);
    await testFn(filePath);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

Deno.test("RequestParser: returns null and logs when file is missing", async () => {
  const errors: LoggedError[] = [];
  const parser = new RequestParser(createLogger(errors));

  await withTempRequestFile(async (filePath) => {
    const result = await parser.parse(filePath);

    assertEquals(result, null);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].action, TEST_LOG_ACTION_FILE_NOT_FOUND);
    assertEquals(errors[0].target, filePath);
  });
});

Deno.test("RequestParser: returns null for invalid frontmatter delimiters", async () => {
  const errors: LoggedError[] = [];
  const parser = new RequestParser(createLogger(errors));

  await withTempRequestFile(async (filePath) => {
    await Deno.writeTextFile(filePath, TEST_REQUEST_BODY);

    const result = await parser.parse(filePath);

    assertEquals(result, null);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].action, TEST_LOG_ACTION_FRONTMATTER_INVALID);
    assertEquals(errors[0].target, filePath);
  });
});

Deno.test("RequestParser: returns null when trace_id is missing", async () => {
  const errors: LoggedError[] = [];
  const parser = new RequestParser(createLogger(errors));

  await withTempRequestFile(async (filePath) => {
    await Deno.writeTextFile(filePath, buildFrontmatter(undefined, TEST_REQUEST_STATUS_VALID));

    const result = await parser.parse(filePath);

    assertEquals(result, null);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].action, TEST_LOG_ACTION_MISSING_TRACE_ID);
    assertEquals(errors[0].target, filePath);
  });
});

Deno.test("RequestParser: normalizes unknown status to pending", async () => {
  const errors: LoggedError[] = [];
  const parser = new RequestParser(createLogger(errors));

  await withTempRequestFile(async (filePath) => {
    await Deno.writeTextFile(filePath, buildFrontmatter(TEST_REQUEST_TRACE_ID, TEST_REQUEST_STATUS_UNKNOWN));

    const result = await parser.parse(filePath);

    assertEquals(errors.length, 0);
    assertEquals(result?.frontmatter.trace_id, TEST_REQUEST_TRACE_ID);
    assertEquals(result?.frontmatter.status, RequestStatus.PENDING);
    assertEquals(result?.body.trim(), TEST_REQUEST_BODY);
  });
});

Deno.test("RequestParser: logs parse failure on invalid YAML", async () => {
  const errors: LoggedError[] = [];
  const parser = new RequestParser(createLogger(errors));

  await withTempRequestFile(async (filePath) => {
    await Deno.writeTextFile(filePath, `---\n${TEST_REQUEST_INVALID_YAML}\n---\n\n${TEST_REQUEST_BODY}`);

    const result = await parser.parse(filePath);

    assertEquals(result, null);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].action, TEST_LOG_ACTION_PARSE_FAILED);
    assertEquals(errors[0].target, filePath);
  });
});

// ============================================================================
// Phase 54: Identity field only (agent field removed) tests
// ============================================================================

Deno.test("RequestParser: parses identity field from frontmatter", async () => {
  const errors: LoggedError[] = [];
  const parser = new RequestParser(createLogger(errors));

  await withTempRequestFile(async (filePath) => {
    const frontmatter = [
      `trace_id: "${TEST_REQUEST_TRACE_ID}"`,
      `created: "${TEST_REQUEST_CREATED_AT}"`,
      `status: ${TEST_REQUEST_STATUS_VALID}`,
      `priority: ${TEST_REQUEST_PRIORITY}`,
      `identity: "senior-coder"`,
      `source: ${TEST_REQUEST_SOURCE}`,
      `created_by: "${TEST_REQUEST_CREATED_BY}"`,
    ].join("\n");

    await Deno.writeTextFile(filePath, `---\n${frontmatter}\n---\n\n${TEST_REQUEST_BODY}\n`);

    const result = await parser.parse(filePath);

    assertEquals(errors.length, 0);
    assertEquals(result?.frontmatter.identity, "senior-coder");
  });
});

Deno.test("RequestParser: ignores agent field (Phase 54 removed)", async () => {
  const errors: LoggedError[] = [];
  const parser = new RequestParser(createLogger(errors));

  await withTempRequestFile(async (filePath) => {
    // Request with only agent field (no identity) - should parse but identity will be undefined
    const frontmatter = [
      `trace_id: "${TEST_REQUEST_TRACE_ID}"`,
      `created: "${TEST_REQUEST_CREATED_AT}"`,
      `status: ${TEST_REQUEST_STATUS_VALID}`,
      `priority: ${TEST_REQUEST_PRIORITY}`,
      `agent: "code-reviewer"`,
      `source: ${TEST_REQUEST_SOURCE}`,
      `created_by: "${TEST_REQUEST_CREATED_BY}"`,
    ].join("\n");

    await Deno.writeTextFile(filePath, `---\n${frontmatter}\n---\n\n${TEST_REQUEST_BODY}\n`);

    const result = await parser.parse(filePath);

    assertEquals(errors.length, 0);
    // agent field is no longer recognized - identity should be undefined
    assertEquals(result?.frontmatter.identity, undefined);
  });
});
