/**
 * @module CustomAssertions
 * @path tests/helpers/custom_assertions.ts
 * @description Provides project-specific assertions for validating agent
 * logic, terminal visuals, and asynchronous execution states.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { MemoryBankService } from "../../src/services/memory/memory_bank.ts";
import type { MemoryExtractorService } from "../../src/services/memory/memory_extractor.ts";
import { ExecutionStatus } from "../../src/shared/enums.ts";

/**
 * Asserts that the command output contains all expected strings
 */
export function assertOutputContains(output: string, expected: string[]): void {
  for (const str of expected) {
    assertStringIncludes(output, str);
  }
}

/**
 * Asserts that a project memory exists and matches basic expectations
 */
export async function assertProjectExists(
  memoryBank: MemoryBankService,
  portal: string,
  message?: string,
): Promise<void> {
  const project = await memoryBank.getProjectMemory(portal);
  assertEquals(project !== null, true, message || `Project memory for ${portal} should exist`);
  assertEquals(project!.portal, portal);
}

/**
 * Asserts that an execution memory exists
 */
export async function assertExecutionExists(
  memoryBank: MemoryBankService,
  traceId: string,
  expectedStatus: ExecutionStatus = ExecutionStatus.COMPLETED,
): Promise<void> {
  const execution = await memoryBank.getExecutionByTraceId(traceId);
  assertEquals(execution !== null, true, `Execution memory for ${traceId} should exist`);
  if (execution) {
    assertEquals(execution.status, expectedStatus);
  }
}

/**
 * Asserts that a list of pending content contains a specific ID
 */
export async function assertPendingExists(
  extractor: MemoryExtractorService,
  proposalId: string,
): Promise<void> {
  const pending = await extractor.listPending();
  const exists = pending.some((p) => p.id === proposalId);
  assertEquals(exists, true, `Pending proposal ${proposalId} should exist`);
}
