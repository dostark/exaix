/**
 * @module StatusManagerErrorTest
 * @path tests/services/status/status_manager_error_test.ts
 * @description Regression tests for the StatusManager's error reporting, ensuring that
 * plan and request failures are accurately captured in file frontmatter.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse } from "@std/yaml";

import { StatusManager } from "../../../src/services/request_processing/status_manager.ts";
import { RequestStatus } from "@exaix/core";
import { initTestDbService } from "../../helpers/db.ts";
import { EventLogger } from "@exaix/core/logger/event_logger.ts";
import type { JSONObject } from "@exaix/core/types/json.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

function parseFrontmatter(content: string): JSONObject {
  const parts = content.split("---");
  if (parts.length < 3) {
    throw new Error("Invalid markdown content: missing YAML frontmatter delimiters.");
  }
  return parse(parts[1]) as JSONObject;
}

Deno.test("StatusManager error storage regression test", async () => {
  const testDbResult = await initTestDbService();
  const { tempDir, cleanup } = testDbResult;

  try {
    const statusManager = new StatusManager(new EventLogger({ prefix: "test" }));

    const requestPath = join(tempDir, "test-request.md");
    const originalContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "status",
      "status_manager_error_test",
      "originalContent.md",
    );
    await Deno.writeTextFile(requestPath, originalContent);

    // Test error message storage
    await statusManager.updateStatus(
      requestPath,
      RequestStatus.FAILED,
      "Plan validation failed: Invalid JSON structure",
    );

    const updatedContent = await Deno.readTextFile(requestPath);
    const updatedFrontmatter = parseFrontmatter(updatedContent);

    // Verify status was updated
    assertEquals(updatedFrontmatter.status, RequestStatus.FAILED);

    // Verify error message was added
    assertEquals(updatedFrontmatter.error, "Plan validation failed: Invalid JSON structure");

    console.log("✅ StatusManager error storage test passed");
  } finally {
    await cleanup();
  }
});
