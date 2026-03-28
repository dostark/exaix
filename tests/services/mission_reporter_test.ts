/**
 * @module MissionReporterTest
 * @path tests/mission_reporter_test.ts
 * @description Verifies the MissionReporter service, ensuring that post-execution summaries
 * and lessons learned are correctly formatted and persisted as execution memory records.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { ExecutionStatus, MemoryOperation, PortalOperation } from "../../src/shared/enums.ts";
import { MemoryBankService } from "../../src/services/memory_bank.ts";
import { createMockConfig } from "../helpers/config.ts";
import { initTestDbService } from "../helpers/db.ts";
import { getMemoryExecutionDir } from "../helpers/paths_helper.ts";
import type { IDatabaseService } from "../../src/services/db.ts";
import { ITraceData, MissionReporter, ReportConfig } from "../../src/services/mission_reporter.ts";
import { join } from "@std/path";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a test trace data with sensible defaults
 */
function createTestTraceData(overrides: Partial<ITraceData> = {}): ITraceData {
  return {
    traceId: overrides.traceId ?? "550e8400-e29b-41d4-a716-446655440000",
    requestId: overrides.requestId ?? "implement-auth",
    identityId: overrides.identityId ?? "senior-coder",
    status: overrides.status ?? ExecutionStatus.COMPLETED,
    branch: overrides.branch ?? "feat/implement-auth-550e8400",
    completedAt: overrides.completedAt ?? new Date(),
    contextFiles: overrides.contextFiles ?? [
      "Portals/MyApp/config.md",
      "Memory/Projects/MyApp/architecture.md",
    ],
    reasoning: overrides.reasoning ?? "Chose JWT over sessions for stateless authentication.",
    summary: overrides.summary ?? "Successfully implemented JWT-based authentication system.",
  };
}

/**
 * Sets up a git repository with test commits
 */
async function setupTestGitRepo(tempDir: string): Promise<void> {
  // Initialize git
  await runGitCommand(tempDir, ["init"]);
  await runGitCommand(tempDir, ["config", "user.email", "test@test.com"]);
  await runGitCommand(tempDir, ["config", "user.name", "Test User"]);

  // Create initial commit
  await Deno.writeTextFile(join(tempDir, "README.md"), "# Test Project\n");
  await runGitCommand(tempDir, [MemoryOperation.ADD, "."]);
  await runGitCommand(tempDir, ["commit", "-m", "Initial commit"]);
}

/**
 * Helper to run git commands
 */
async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  const cmd = new Deno.Command(PortalOperation.GIT, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout, stderr, code } = await cmd.output();
  if (code !== 0) {
    throw new Error(`Git command failed: ${new TextDecoder().decode(stderr)}`);
  }
  return new TextDecoder().decode(stdout);
}

// ============================================================================
// Test: Basic Report Generation
// ============================================================================

Deno.test("MissionReporter: generates execution memory record after successful execution", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();

  try {
    // Create required directories for Memory Banks
    await Deno.mkdir(getMemoryExecutionDir(tempDir), { recursive: true });
    await setupTestGitRepo(tempDir);

    const config = createMockConfig(tempDir);
    const reportConfig: ReportConfig = {
      reportsDirectory: getMemoryExecutionDir(tempDir),
    };

    const memoryBank = new MemoryBankService(config, db);
    const reporter = new MissionReporter(config, reportConfig, memoryBank, db);
    const traceData = createTestTraceData();

    const result = await reporter.generate(traceData);

    // Verify result is successful
    assert(result.success);
    assertExists(result.reportPath);
    assertEquals(result.traceId, traceData.traceId);

    // Verify execution memory directory exists
    const executionDir = join(getMemoryExecutionDir(tempDir), traceData.traceId);
    const dirStat = await Deno.stat(executionDir);
    assert(dirStat.isDirectory);

    // Verify the required files exist
    const summaryFile = join(executionDir, "summary.md");
    const contextFile = join(executionDir, "context.json");

    const summaryExists = await Deno.stat(summaryFile).then(() => true).catch(() => false);
    const contextExists = await Deno.stat(contextFile).then(() => true).catch(() => false);

    assert(summaryExists, "summary.md should exist");
    assert(contextExists, "context.json should exist");
  } finally {
    await cleanup();
  }
});

Deno.test("MissionReporter: creates structured execution memory with lessons learned", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();

  try {
    await Deno.mkdir(getMemoryExecutionDir(tempDir), { recursive: true });
    await setupTestGitRepo(tempDir);

    const config = createMockConfig(tempDir);
    const reportConfig: ReportConfig = {
      reportsDirectory: getMemoryExecutionDir(tempDir),
    };

    const memoryBank = new MemoryBankService(config, db);
    const reporter = new MissionReporter(config, reportConfig, memoryBank, db);
    const traceData = createTestTraceData({
      reasoning:
        "I learned that JWT tokens are better for stateless auth. I discovered that Redis is useful for caching.",
      summary: "Successfully implemented authentication with lessons learned about security best practices.",
    });

    const result = await reporter.generate(traceData);

    // Verify result is successful
    assert(result.success);

    // Read the execution memory to verify lessons learned extraction
    const executionMemory = await memoryBank.getExecutionByTraceId(traceData.traceId);
    assertExists(executionMemory);

    // Should have extracted lessons from reasoning text
    assert(executionMemory.lessons_learned && executionMemory.lessons_learned.length > 0);
    assert(
      executionMemory.lessons_learned.some((lesson: string) =>
        lesson.toLowerCase().includes("jwt") || lesson.toLowerCase().includes("redis")
      ),
    );
  } finally {
    await cleanup();
  }
});

Deno.test("MissionReporter: handles failed execution status", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();

  try {
    await Deno.mkdir(getMemoryExecutionDir(tempDir), { recursive: true });
    await setupTestGitRepo(tempDir);

    const config = createMockConfig(tempDir);
    const reportConfig: ReportConfig = {
      reportsDirectory: getMemoryExecutionDir(tempDir),
    };

    const memoryBank = new MemoryBankService(config, db);
    const reporter = new MissionReporter(config, reportConfig, memoryBank, db);
    const traceData = createTestTraceData({
      status: ExecutionStatus.FAILED,
      summary: "Failed to implement authentication due to dependency issues.",
    });

    const result = await reporter.generate(traceData);

    // Verify result is successful (we still create memory records for failures)
    assert(result.success);

    // Read the execution memory to verify status
    const executionMemory = await memoryBank.getExecutionByTraceId(traceData.traceId);
    assertExists(executionMemory);
    assertEquals(executionMemory.status, ExecutionStatus.FAILED);
    assertExists(executionMemory.error_message);
  } finally {
    await cleanup();
  }
});

Deno.test("MissionReporter: extracts portal from context files", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();

  try {
    await Deno.mkdir(getMemoryExecutionDir(tempDir), { recursive: true });
    await setupTestGitRepo(tempDir);

    const config = createMockConfig(tempDir);
    const reportConfig: ReportConfig = {
      reportsDirectory: getMemoryExecutionDir(tempDir),
    };

    const memoryBank = new MemoryBankService(config, db);
    const reporter = new MissionReporter(config, reportConfig, memoryBank, db);
    const traceData = createTestTraceData({
      contextFiles: [
        "Portals/TestPortal/config.md",
        "src/components/Auth.tsx",
      ],
    });

    const result = await reporter.generate(traceData);

    // Verify result is successful
    assert(result.success);

    // Read the execution memory to verify portal extraction
    const executionMemory = await memoryBank.getExecutionByTraceId(traceData.traceId);
    assertExists(executionMemory);
    assertEquals(executionMemory.portal, "TestPortal");
  } finally {
    await cleanup();
  }
});

Deno.test("MissionReporter: works without database service", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    await Deno.mkdir(getMemoryExecutionDir(tempDir), { recursive: true });
    await setupTestGitRepo(tempDir);

    const config = createMockConfig(tempDir);
    const reportConfig: ReportConfig = {
      reportsDirectory: getMemoryExecutionDir(tempDir),
    };

    // Create memoryBank without db (should fall back to console logging)
    const mockDb = {
      logActivity: () => {},
    } as Partial<IDatabaseService> as IDatabaseService;

    const memoryBank = new MemoryBankService(config, mockDb);
    const reporter = new MissionReporter(config, reportConfig, memoryBank);
    const traceData = createTestTraceData();

    const result = await reporter.generate(traceData);

    // Should still work without database
    assert(result.success);
    assertExists(result.reportPath);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("MissionReporter: handles generation errors gracefully", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();

  try {
    await Deno.mkdir(getMemoryExecutionDir(tempDir), { recursive: true });

    // Config and setup
    const config = createMockConfig(tempDir);
    const reportConfig: ReportConfig = {
      reportsDirectory: getMemoryExecutionDir(tempDir),
    };

    // Create a mock MemoryBankService that throws
    const mockMemoryBank = new MemoryBankService(config, db);
    mockMemoryBank.createExecutionRecord = () => Promise.reject(new Error("Storage failure"));

    const reporter = new MissionReporter(config, reportConfig, mockMemoryBank, db);
    const traceData = createTestTraceData();

    const result = await reporter.generate(traceData);

    // Verify error handling
    assert(!result.success);
    assert(result.error?.includes("Storage failure"));
    assertExists(result.traceId);
  } finally {
    await cleanup();
  }
});

Deno.test("MissionReporter: handles git stats failure gracefully", async () => {
  const { db, tempDir, cleanup } = await initTestDbService();

  try {
    await Deno.mkdir(getMemoryExecutionDir(tempDir), { recursive: true });
    // Note: We DO NOT setup git repo here, so git commands should fail

    const config = createMockConfig(tempDir);
    const reportConfig: ReportConfig = {
      reportsDirectory: getMemoryExecutionDir(tempDir),
    };

    const memoryBank = new MemoryBankService(config, db);
    const reporter = new MissionReporter(config, reportConfig, memoryBank, db);
    const traceData = createTestTraceData({
      branch: "non-existent-branch",
    });

    const result = await reporter.generate(traceData);

    // Should succeed even if git stats fail
    assert(result.success);
    assertExists(result.gitStats);
    // Should have empty stats
    assertEquals(result.gitStats?.totalFilesChanged, 0);
    assertEquals(result.gitStats?.insertions, 0);
  } finally {
    await cleanup();
  }
});
