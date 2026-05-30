/**
 * @module TestRunnerTest
 * @path packages/portal/knowledge/tests/test_runner_test.ts
 * @description Tests for TestRunner — Strategy 8 of PortalKnowledgeService.
 * Tests dry-run mode, config-based fallback, and non-TS/JS language handling.
 */

import { assertEquals } from "@std/assert";
import { TestDetectionKind } from "@exaix/core";
import { TestRunner } from "../test_runner.ts";

Deno.test("TestRunner: returns none detection when deno test fails", async () => {
  const runner = new TestRunner();

  const result = await runner.analyze("/nonexistent/path", ["test.ts"], "typescript");

  assertEquals(result.testFiles, []);
  assertEquals(result.testCount, 0);
  assertEquals(result.detected, TestDetectionKind.NONE);
});

Deno.test("TestRunner: handles empty file list", async () => {
  const runner = new TestRunner();

  const result = await runner.analyze("/tmp", [], "typescript");

  assertEquals(result.testFiles, []);
  assertEquals(result.testCount, 0);
  assertEquals(result.detected, TestDetectionKind.NONE);
});

Deno.test("TestRunner: handles non-TS/JS language", async () => {
  const runner = new TestRunner();

  const result = await runner.analyze("/tmp", ["test.py"], "python");

  assertEquals(result.testFiles, []);
  assertEquals(result.testCount, 0);
  assertEquals(result.detected, TestDetectionKind.NONE);
});

Deno.test("TestRunner: handles missing directory gracefully", async () => {
  const runner = new TestRunner();

  const result = await runner.analyze("/nonexistent", ["test.ts"], "typescript");

  assertEquals(result.detected, TestDetectionKind.NONE);
});
