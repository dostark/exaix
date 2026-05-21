/**
 * @module ExecutionLoopExtendedTest
 * @path tests/services/execution/execution_loop_extended_test.ts
 * @description Targeted tests for the core execution loop, verifying multi-step
 * task transitions and state consistency across complex agent workflows.
 */
import { join } from "@std/path";

import { assertEquals } from "@std/assert";
import { ExecutionLoop } from "../../../src/services/agent/execution_loop.ts";
import type { DatabaseService } from "@exaix/storage-sqlite";
import type { IDatabaseService } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";
import { createMockConfig } from "../../helpers/config.ts";
import { initTestDbService } from "../../helpers/db.ts";
import { getWorkspaceActiveDir } from "../../helpers/paths_helper.ts";
import { readFixtureTextSync } from "../../helpers/fixtures.ts";

// ===== executeNext tests =====

// Helper for test setup
async function runExecutionTest(
  prefix: string,
  fn: (ctx: {
    tempDir: string;
    config: Config;
    db?: IDatabaseService;
    loop: ExecutionLoop;
    activeDir: string;
  }) => Promise<void>,
  options: { noDb?: boolean; createActiveDir?: boolean; identityId?: string } = {},
) {
  const tempDir = await Deno.makeTempDir({ prefix: `exec-ext-${prefix}-` });
  let db: DatabaseService | undefined;
  let cleanup: (() => Promise<void>) | undefined;

  if (!options.noDb) {
    const dbService = await initTestDbService();
    db = dbService.db;
    cleanup = dbService.cleanup;
  }

  try {
    const config = createMockConfig(tempDir);
    const activeDir = getWorkspaceActiveDir(tempDir);

    if (options.createActiveDir !== false) {
      await Deno.mkdir(activeDir, { recursive: true });
    }

    const loop = new ExecutionLoop({ config, db, identityId: options.identityId ?? "test-agent" });
    await fn({ tempDir, config, db, loop, activeDir });
  } finally {
    if (cleanup) await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
}

// ===== executeNext tests =====

Deno.test("ExecutionLoop.executeNext: returns success when no plans available", async () => {
  await runExecutionTest("no-plans", async ({ loop }) => {
    const result = await loop.executeNext();
    assertEquals(result.success, true);
    assertEquals(result.traceId, undefined);
  });
});

Deno.test("ExecutionLoop.executeNext: processes pending plan", async () => {
  await runExecutionTest("next", async ({ activeDir, loop }) => {
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_extended_test",
      "planContent.md",
    );
    const planPath = join(activeDir, "non-toml-test.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    // Should succeed (creates dummy file when no actions)
    assertEquals(result.success, true);
  });
});

Deno.test("ExecutionLoop: skips invalid TOML blocks", async () => {
  await runExecutionTest("bad-toml", async ({ activeDir, loop }) => {
    const planContent = readFixtureTextSync(
      import.meta.url,
      "services",
      "execution",
      "execution_loop_extended_test",
      "planContent_3.md",
    );
    const planPath = join(activeDir, "bad-toml-plan.md");
    await Deno.writeTextFile(planPath, planContent);

    const result = await loop.processTask(planPath);
    assertEquals(result.success, true);
    assertEquals(result.traceId, "test-bad-toml");
  });
});
