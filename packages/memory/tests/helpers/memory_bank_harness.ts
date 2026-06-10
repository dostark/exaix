/**
 * @module MemoryBankTestHarness
 * @path packages/memory/tests/helpers/memory_bank_harness.ts
 * @related-files ["packages/testing/src/helpers/services/memory_bank_test_helpers.ts"]
 * @architectural-layer Memory
 * @ungrounded
 * @description Package-local harness for MemoryBankService tests. Wires a temp
 * database, EventLogger, and MemoryBankService together; data factories come
 * from @exaix/testing.
 */

import type { ILearning, IProjectMemory } from "@exaix/schemas/memory_bank.ts";
import { MemoryBankService } from "@exaix/memory";
import { EventLogger } from "@exaix/core/logger";
import type { DatabaseService } from "@exaix/storage-sqlite";
import { createMinimalProjectMemory, createSampleLearning, initTestDbService } from "@exaix/testing";
import type { Config } from "@exaix/schemas/config.ts";
import { ConfidenceAssessmentLevel, LearningCategory, MemoryBankSource, MemoryScope } from "@exaix/core";
import { MemoryStatus } from "@exaix/core/status";
import { TEST_ID, TEST_PROJECT_NAME, TEST_TIMESTAMP } from "@exaix/testing/helpers/constants.ts";

/**
 * Creates a test setup with MemoryBankService and a pre-created project memory
 */
export function createTestMemoryBankWithProject(
  projectOverrides: Partial<IProjectMemory> = {},
): Promise<{
  service: MemoryBankService;
  config: Config;
  cleanup: () => Promise<void>;
}> {
  return createTestMemoryBankBase(async (service) => {
    // Create project memory
    const projectMemory = createMinimalProjectMemory({
      portal: TEST_PROJECT_NAME,
      overview: "Test project",
      ...projectOverrides,
    });
    await service.createProjectMemory(projectMemory);
  });
}

/**
 * Creates a test setup with MemoryBankService and initialized global memory
 */
export async function createTestMemoryBankWithGlobal(
  globalOverrides: Partial<ILearning> = {},
): Promise<{
  service: MemoryBankService;
  config: Config;
  db: DatabaseService;
  cleanup: () => Promise<void>;
}> {
  const result = await createTestMemoryBankBase(async (service) => {
    await service.initGlobalMemory();

    // Create a default global learning if overrides provided
    if (Object.keys(globalOverrides).length > 0) {
      const defaultLearning = createSampleLearning({
        id: "550e8400-e29b-41d4-a716-446655440000",
        created_at: TEST_TIMESTAMP,
        source: MemoryBankSource.USER,
        scope: MemoryScope.GLOBAL,
        title: "Test IPattern",
        description: "A test pattern for global memory",
        category: LearningCategory.PATTERN,
        tags: [TEST_ID],
        confidence: ConfidenceAssessmentLevel.HIGH,
        status: MemoryStatus.APPROVED,
        ...globalOverrides,
      });
      await service.addGlobalLearning(defaultLearning);
    }
  }, true);

  return result as {
    service: MemoryBankService;
    config: Config;
    db: DatabaseService;
    cleanup: () => Promise<void>;
  };
}

/**
 * Base function for creating test MemoryBankService instances
 */
async function createTestMemoryBankBase(
  setupFn: (service: MemoryBankService) => Promise<void>,
  includeDb: boolean = false,
): Promise<{
  service: MemoryBankService;
  config: Config;
  db?: DatabaseService;
  cleanup: () => Promise<void>;
}> {
  const { db, config, cleanup: dbCleanup } = await initTestDbService();

  const logger = includeDb ? new EventLogger({ db }) : undefined;
  const service = new MemoryBankService(config, logger);
  await setupFn(service);

  const cleanup = async () => {
    await dbCleanup();
  };

  const result: {
    service: MemoryBankService;
    config: Config;
    db?: DatabaseService;
    cleanup: () => Promise<void>;
  } = { service, config, cleanup };
  if (includeDb) {
    result.db = db;
  }
  return result;
}
