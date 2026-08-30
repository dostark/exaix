/**
 * @module ZombiePlanLifecycleReproTest
 * @path tests/repro/repro_zombie_plan_lifecycle.ts
 * @description Reproduction test for zombie plan lifecycle issue in manual execution mode.
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { ConfigService } from "@exaix/core/config";
import { DatabaseService } from "@exaix/storage-sqlite";
import { PlanExecutor } from "@exaix/core/planning";
import { ProviderFactory } from "@exaix/ai";
import { ExecutionLoop } from "@exaix/execution";
import type { ProviderType } from "@exaix/core";

/**
 * Reproduces the zombie-plan lifecycle: when a manually parsed/executed plan's execution
 * fails, it stays in Workspace/Active (never cleaned up) and no failure report is written.
 */
Deno.test("Reproduction: Zombie Plan Lifecycle in Manual Execution Mode", async () => {
  // 1. Setup Environment
  const testRoot = await Deno.makeTempDir({ prefix: "exa_test_zombie_" });
  const configPath = `${testRoot}/exa.config.toml`;
  console.log("testRoot:", testRoot);
  console.log("configPath:", configPath);
  console.log("isAbsolute:", configPath.startsWith("/"));

  const configService = new ConfigService(configPath);
  const config = configService.get();

  console.log("Files in testRoot:", Array.from(Deno.readDirSync(testRoot)));
  console.log("Files in cwd:", Array.from(Deno.readDirSync(Deno.cwd())).filter((f) => f.name.includes("config")));

  // Use the test root
  const originalRoot = config.system.root;
  config.system.root = testRoot;

  let db: DatabaseService | undefined;

  try {
    // Initialize paths
    const workspacePath = join(testRoot, "Workspace");
    const activePath = join(workspacePath, "Active");
    const requestsPath = join(workspacePath, "Requests");
    const memoryPath = join(testRoot, "Memory");
    const executionPath = join(memoryPath, "Execution");

    // Database requires config.paths.runtime to exist
    const runtimePath = join(testRoot, config.paths.runtime);
    await ensureDir(runtimePath);

    await ensureDir(activePath);
    await ensureDir(requestsPath);
    await ensureDir(executionPath);

    // Initialize Services
    // Fix test config to ensure mock:test resolves to mock provider
    config.models = {
      "mock:test": {
        provider: "mock" as ProviderType,
        model: "test-model",
      },
    };
    db = new DatabaseService(config);
    // Mock provider that will choke or we just rely on invalid tool in plan
    const provider = await ProviderFactory.createByName(config, "mock:test");
    const _executor = new PlanExecutor(config, provider, db, testRoot);

    // 2. Create a "Fail Plan"
    // This plan tries to use a non-existent tool or invalid arguments to force a failure
    const traceId = "test-zombie-trace-" + Date.now();
    const planId = "request-test_plan";
    const planContent = `---
trace_id: "${traceId}"
request_id: "request-test"
identity: "default"
status: "approved"
---

## Step 1: Fail Purposefully
Tool: non_existent_tool
Arguments:
  foo: "bar"

Description: Intentionally fail for test
`;

    const planPath = join(activePath, `${planId}.md`);
    await Deno.writeTextFile(planPath, planContent);

    // 3. Simulate src/main.ts execution (Now using ExecutionLoop)
    console.log("Simulating ExecutionLoop delegation from main.ts...");

    const executionLoop = new ExecutionLoop({
      config,
      db,
      identityId: "daemon",
    });

    const result = await executionLoop.processTask(planPath);
    console.log("Execution Result:", result);

    // 4. Verification of CORRECT behavior (Fix Verification)

    // Assertion 1: Plan file is GONE from Active (Moved by ExecutionLoop)
    const existsInActive = await exists(planPath);
    assert(!existsInActive, "Plan should be removed from Active (Fix Verified)");

    // Assertion 2: Plan file moved to Rejected with Error status
    const rejectedDir = join(workspacePath, "Rejected");
    const rejectedPlanPath = join(rejectedDir, `${planId}_failed.md`);
    const existsInRejected = await exists(rejectedPlanPath);
    assert(existsInRejected, "Plan should be moved to Rejected on failure (Fix Verified)");

    // Check content for error status
    const newContent = await Deno.readTextFile(rejectedPlanPath);
    assert(newContent.includes("status: error"), "Rejected plan file should have status: error");

    // Assertion 3: Failure report generated
    const failureReportPath = join(executionPath, traceId, "failure.md");
    const reportExists = await exists(failureReportPath);
    assert(reportExists, "Failure report should exist in Memory (Fix Verified)");

    console.log("Fix Verification successful: Lifecycle handled correctly.");
  } finally {
    // Cleanup
    if (db) await db.close();
    config.system.root = originalRoot;
    await Deno.remove(testRoot, { recursive: true });
  }
});
