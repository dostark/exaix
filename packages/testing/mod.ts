/**
 * @module TestingPackage
 * @path packages/testing/mod.ts
 * @ungrounded
 * @related-files []
 * @architectural-layer Testing
 * @description Package entrypoint for @exaix/testing. This package houses shared test helpers, mocks, and fixtures.
 */
export * from "./src/constants.ts";
export { TestEnvironment } from "../../tests/integration/helpers/test_environment.ts";
export type { ILoggedActivity, TestDatabaseService } from "./src/helpers/db.ts";
export { createLoggingTestDb } from "./src/helpers/db.ts";
export { createMockConfig, createTestConfigService } from "./src/helpers/config.ts";
export { createMockLogger } from "./src/helpers/services/graceful_shutdown_test_helpers.ts";
export { createMockProvider } from "./src/helpers/mock_provider.ts";
export { createTestLearning, createTestProposal } from "./src/helpers/services/memory_test_helpers.ts";
export { getFixturePath, readFixtureTextSync } from "./src/helpers/fixtures.ts";
export { initActivityTableSchema, initTestDbService } from "./src/helpers/init_db.ts";
export { isCi, withEnv } from "./src/helpers/env.ts";
export { REPO_ROOT, withRepoRoot } from "./src/helpers/repo_root.ts";
export { setupPortalWorkspaceTestDirs } from "./src/helpers/services/portal_workspace_test_helper.ts";
export {
  castAny,
  createStubConfig,
  createStubContext,
  createStubDb,
  createStubDisplay,
  createStubGit,
  createStubProvider,
  makeGenerateResult,
} from "./src/helpers/test_helpers.ts";
export {
  createMockAgentRunner,
  createMockEventLogger,
  createMockFlowRunner,
  createMockFlowValidator,
  createRouterTestContext,
  createTestRequestRouter,
  sampleRouterRequest,
} from "./src/helpers/services/barrel.ts";
export {
  createMinimalExecutionMemory,
  createSampleProjectMemory,
  createTestMemoryBankWithGlobal,
  createTestMemoryBankWithProject,
} from "./src/helpers/services/memory_bank_test_helpers.ts";
export {
  createNotificationTestProposal,
  runNotificationTest,
} from "./src/helpers/services/notification_test_helper.ts";
export {
  createTestExecution,
  createTestProject,
  NullEmbeddingStub,
  NullMemoryBankStub,
} from "./src/helpers/memory_test_helper.ts";
export {
  getBlueprintsIdentitiesDir,
  getMemoryDir,
  getMemoryExecutionDir,
  getMemoryGlobalDir,
  getMemoryIndexDir,
  getMemoryPendingDir,
  getMemoryProjectsDir,
  getMemorySkillsDir,
  getMemoryTasksDir,
  getPortalsDir,
  getRuntimeDir,
  getWorkspaceActiveDir,
  getWorkspaceArchiveDir,
  getWorkspaceDir,
  getWorkspacePlansDir,
  getWorkspaceRejectedDir,
  getWorkspaceRequestsDir,
} from "./src/helpers/paths_helper.ts";
