/**
 * @module GlobalMemoryTestHelpers
 * @path tests/helpers/memory_test_helper.ts
 * @description Provides common utilities for validating global knowledge banks
 * and shared learned patterns across project boundaries.
 */

import { ExecutionMemoryBuilder, ProjectMemoryBuilder } from "../fixtures/memory_builder.ts";
import type { MemoryBankService } from "../../src/services/memory/memory_bank.ts";
import { MemoryReferenceType } from "../../src/shared/enums.ts";

/**
 * Creates a test project memory using the Builder pattern and persistence
 */
export async function createTestProject(memoryBank: MemoryBankService, portal: string, opts: {
  overview?: string;
  patternName?: string;
} = {}): Promise<void> {
  const builder = new ProjectMemoryBuilder(portal);

  if (opts.overview) {
    builder.withOverview(opts.overview);
  }

  // Add default content similar to original test helper
  builder.addPattern({
    name: opts.patternName || "Test IPattern as IPattern",
    description: "A test pattern for unit testing",
    examples: ["src/test.ts"],
    tags: ["testing", "typescript"],
  });

  builder.addDecision({
    date: "2026-01-04",
    decision: "Use TypeScript for all code",
    rationale: "Type safety and tooling support",
    tags: ["typescript"],
  });

  builder.addReference({
    type: MemoryReferenceType.FILE,
    path: "src/main.ts",
    description: "Main entry point",
  });

  await memoryBank.createProjectMemory(builder.build());
}

/**
 * Creates a test execution memory using the Builder pattern and persistence
 */
export async function createTestExecution(
  memoryBank: MemoryBankService,
  traceId: string,
  portal: string,
  opts: {
    identity?: string;
    summary?: string;
  } = {},
): Promise<void> {
  const builder = new ExecutionMemoryBuilder(portal, traceId);

  builder.withIdentity(opts.identity || "test-agent");
  builder.withSummary(opts.summary || `Test execution for ${portal}`);
  builder.addContextFile("src/main.ts");
  builder.withChanges({
    files_created: ["src/new.ts"],
    files_modified: ["src/main.ts"],
    files_deleted: [],
  });
  builder.addLesson("Always test first");

  await memoryBank.createExecutionRecord(builder.build());
}
