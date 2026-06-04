/**
 * @module ToolExecutionTestUtils
 * @path tests/helpers/tool_test_utils.ts
 * @description Provides low-level utilities for verifying tool execution results,
 * capturing stdout/stderr, and asserting on file system changes.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { ToolRegistry } from "@exaix/tool-runtime";
import { createMockConfig } from "@exaix/testing";
import { initTestDbService } from "@exaix/testing";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { JSONValue } from "@exaix/core/types";
import type { JSONObject } from "@exaix/core/types";

export interface IToolTestContext {
  registry: ToolRegistry;
  tempDir: string;
  cleanup: () => Promise<void>;
  allowedPath: string;
  forbiddenPath: string;
}

/**
 * Setup tool test context with allowed/forbidden paths
 */
export async function setupToolTestContext(): Promise<IToolTestContext> {
  const tempDir = await Deno.makeTempDir({ prefix: "tool-test-" });
  const { cleanup } = await initTestDbService();

  const allowedPath = join(tempDir, "allowed");
  const forbiddenPath = join(tempDir, "forbidden");
  await ensureDir(allowedPath);
  await ensureDir(forbiddenPath);

  const config = createMockConfig(tempDir);
  const registry = new ToolRegistry({
    config,
    traceId: "test-trace",
    identityId: "test-agent",
  });

  return {
    registry,
    tempDir,
    cleanup,
    allowedPath,
    forbiddenPath,
  };
}

/**
 * Test that tool executes successfully with valid params
 */
export async function assertToolSuccess(
  registry: ToolRegistry,
  tool: string,
  params: JSONObject,
  expectedSuccess: boolean = true,
): Promise<void> {
  const result = await registry.execute(tool, params as Record<string, JSONValue>);
  assertEquals(result.success, expectedSuccess);
}

/**
 * Test that tool rejects path traversal attempts
 */
export async function assertToolRejectsPathTraversal(
  registry: ToolRegistry,
  tool: string,
  baseParams: JSONObject,
  pathParam: string = "path",
): Promise<void> {
  const traversalParams = { ...baseParams, [pathParam]: "../../../etc/passwd" };
  await assertRejects(
    async () => await registry.execute(tool, traversalParams as Record<string, JSONValue>),
    Error,
    "Path traversal",
  );
}

/**
 * Test that tool rejects absolute paths
 */
export async function assertToolRejectsAbsolutePath(
  registry: ToolRegistry,
  tool: string,
  baseParams: JSONObject,
  pathParam: string = "path",
): Promise<void> {
  const absoluteParams = { ...baseParams, [pathParam]: "/etc/passwd" };
  await assertRejects(
    async () => await registry.execute(tool, absoluteParams as Record<string, JSONValue>),
    Error,
    "Absolute paths",
  );
}

/**
 * Test that tool rejects hidden files
 */
export async function assertToolRejectsHiddenFile(
  registry: ToolRegistry,
  tool: string,
  baseParams: JSONObject,
  pathParam: string = "path",
): Promise<void> {
  const hiddenParams = { ...baseParams, [pathParam]: ".hidden" };
  await assertRejects(
    async () => await registry.execute(tool, hiddenParams as Record<string, JSONValue>),
    Error,
    "Hidden files",
  );
}

/**
 * Create a test file with content
 */
export async function createTestFile(
  dir: string,
  filename: string,
  content: string,
): Promise<string> {
  const filepath = join(dir, filename);
  await Deno.writeTextFile(filepath, content);
  return filepath;
}

/**
 * Read test file and verify content
 */
export async function verifyTestFile(
  filepath: string,
  expectedContent: string,
): Promise<void> {
  const content = await Deno.readTextFile(filepath);
  assertEquals(content, expectedContent);
}
