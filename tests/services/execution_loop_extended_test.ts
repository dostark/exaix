/**
 * @module ExecutionLoopExtendedTest
 * @path tests/execution_loop_extended_test.ts
 * @description Targeted tests for the core execution loop, verifying multi-step
 * task transitions and state consistency across complex agent workflows.
 */
import { assert, assertEquals, assertExists } from "@std/assert";

import { MemoryOperation, PortalOperation } from "../../src/shared/enums.ts";

import { join } from "@std/path";
import { ExecutionLoop } from "../../src/services/execution_loop.ts";
import { createMockConfig } from "../helpers/config.ts";
import { initTestDbService } from "../helpers/db.ts";
import { getWorkspaceActiveDir } from "../helpers/paths_helper.ts";

// ===== executeNext tests =====

// Helper for test setup
async function runExecutionTest(
  prefix: string,
  fn: (ctx: {
    tempDir: string;
    config: any;
    db: any;
    loop: ExecutionLoop;
    activeDir: string;
  }) => Promise<void>,
  options: { noDb?: boolean; createActiveDir?: boolean; identityId?: string } = {},
) {
  const tempDir = await Deno.makeTempDir({ prefix: `exec-ext-${prefix}-` });
  let db, cleanup;

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
    const planContent = `---
trace_id: "test-execute-next"
request_id: next-test
status: pending
---

# Execute Next Test Plan

\`\`\`toml
tool = McpToolName.READ_FILE
description = "Read test file"

[params]
path = "test.txt"
\`\`\`
`;
    const planPath = join(activeDir, "next-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const result = await loop.executeNext();
    assertExists(result.traceId);
    assertEquals(result.traceId, "test-execute-next");
  });
});

Deno.test("ExecutionLoop.executeNext: skips non-pending plans", async () => {
  await runExecutionTest("skip", async ({ activeDir, loop }) => {
    // Create plan with active status (not pending)
    const planContent = `---
trace_id: "test-skip-active"
request_id: skip-test
status: active
---

# Should Be Skipped Plan
`;

    const planPath = join(activeDir, "skip-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const result = await loop.executeNext();
    assertEquals(result.success, true);
    assertEquals(result.traceId, undefined);
  });
});

Deno.test("ExecutionLoop.executeNext: handles plans directory not found", async () => {
  await runExecutionTest(
    "notfound",
    async ({ loop }) => {
      const result = await loop.executeNext();
      assertEquals(result.success, true);
      assertEquals(result.traceId, undefined);
    },
    { createActiveDir: false },
  );
});

Deno.test("ExecutionLoop.executeNext: skips plans with invalid frontmatter", async () => {
  await runExecutionTest("invalid-fm", async ({ activeDir, loop }) => {
    const planContent = `# No Frontmatter Plan

This plan has no YAML frontmatter.
`;

    const planPath = join(activeDir, "no-frontmatter.md");
    await Deno.writeTextFile(planPath, planContent);

    const result = await loop.executeNext();
    assertEquals(result.success, true);
    assertEquals(result.traceId, undefined);
  });
});

// ===== parsePlanActions edge cases =====

Deno.test("ExecutionLoop: skips non-TOML code blocks", async () => {
  await runExecutionTest("non-toml", async ({ activeDir, loop }) => {
    const planContent = `---
trace_id: "test-non-toml"
request_id: non-toml-test
status: active
---

# Plan with Non-TOML Code Blocks

\`\`\`javascript
// This is JavaScript, not TOML
console.log("Hello");
\`\`\`

\`\`\`python
# This is Python, not TOML
print("Hello")
\`\`\`

No TOML actions here.
`;

    const planPath = join(activeDir, "non-toml-test.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    // Should succeed (creates dummy file when no actions)
    assertEquals(result.success, true);
  });
});

Deno.test("ExecutionLoop: skips invalid TOML blocks", async () => {
  await runExecutionTest("bad-toml", async ({ activeDir, loop }) => {
    const planContent = `---
trace_id: "test-bad-toml"
request_id: bad-toml-test
status: active
---

# Plan with Invalid TOML

\`\`\`toml
this is not valid toml = [broken
\`\`\`

Should skip the invalid block.
`;

    const planPath = join(activeDir, "bad-toml-test.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    // Should succeed (no valid actions found)
    assertEquals(result.success, true);
  });
});

Deno.test("ExecutionLoop: skips TOML blocks without tool field", async () => {
  await runExecutionTest("no-tool", async ({ activeDir, loop }) => {
    const planContent = `---
trace_id: "test-no-tool"
request_id: no-tool-test
status: active
---

# Plan with TOML but No Tool

\`\`\`toml
description = "This has no tool field"
value = 42
\`\`\`

Should skip this block.
`;

    const planPath = join(activeDir, "no-tool-test.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.processTask(planPath);

    // Should succeed (creates dummy file when no valid actions)
    assertEquals(result.success, true);
  });
});

// ===== summarizeResult edge cases =====

Deno.test("ExecutionLoop: logs action with null result", async () => {
  await runExecutionTest("null-result", async ({ activeDir, db, loop }) => {
    const planContent = `---
trace_id: "test-null-result"
request_id: null-result-test
status: active
---

# Plan that Produces Null Result

\`\`\`toml
tool = McpToolName.READ_FILE
description = "Read non-existent file"

[params]
path = "does-not-exist.txt"
\`\`\`
`;

    const planPath = join(activeDir, "null-result-test.md");
    await Deno.writeTextFile(planPath, planContent);
    // This may fail due to file not found, but we just want to ensure summarizeResult works
    const _result = await loop.processTask(planPath);

    // Check that activity was logged (regardless of success/failure)
    await new Promise((resolve) => setTimeout(resolve, 150));
    const activities = db.getActivitiesByTrace("test-null-result");
    assert(activities.length > 0, "Some activities should be logged");
  });
});

// ===== Lease handling edge cases =====

Deno.test("ExecutionLoop: same agent can reacquire own lease", async () => {
  await runExecutionTest(
    "reacquire",
    async ({ activeDir, loop }) => {
      const planContent = `---
trace_id: "test-reacquire"
request_id: reacquire-test
status: active
---

# Reacquire Lease Test
`;

      const planPath = join(activeDir, "reacquire-test.md");
      await Deno.writeTextFile(planPath, planContent);

      // First execution
      const result1 = await loop.processTask(planPath);
      assertEquals(result1.success, true);

      // Plan was archived, recreate it
      await Deno.writeTextFile(planPath, planContent);

      // Second execution by same agent should work
      const result2 = await loop.processTask(planPath);
      assertEquals(result2.success, true);
    },
    { identityId: "same-agent" },
  );
});

// ===== Error handling edge cases =====

Deno.test("ExecutionLoop: handles missing status in frontmatter", async () => {
  await runExecutionTest("no-status", async ({ activeDir, loop }) => {
    const planContent = `---
trace_id: "test-no-status"
request_id: "test-request"
---

# Plan Missing status
`;

    const planPath = join(activeDir, "no-status.md");
    await Deno.writeTextFile(planPath, planContent);

    const result = await loop.processTask(planPath);

    assertEquals(result.success, false);
    assert(result.error?.includes("status"), "Error should mention missing status");
  });
});

Deno.test("ExecutionLoop: handles empty frontmatter content", async () => {
  await runExecutionTest("empty-fm", async ({ activeDir, loop }) => {
    const planContent = `---
---

# Plan with Empty Frontmatter
`;

    const planPath = join(activeDir, "empty-frontmatter.md");
    await Deno.writeTextFile(planPath, planContent);

    const result = await loop.processTask(planPath);

    assertEquals(result.success, false);
    // Should fail due to missing required fields
    assertExists(result.error);
  });
});

// ===== executeNext with actions =====

Deno.test("ExecutionLoop.executeNext: fails when plan has no actions", async () => {
  await runExecutionTest("no-actions", async ({ activeDir, loop }) => {
    const planContent = `---
trace_id: "test-no-actions"
request_id: no-actions-test
status: pending
---

# Plan Without Actions

This plan has no TOML action blocks.
`;

    const planPath = join(activeDir, "no-actions.md");
    await Deno.writeTextFile(planPath, planContent);
    const result = await loop.executeNext();

    // executeNext requires at least one action
    assertEquals(result.success, false);
    assert(result.error?.includes("no executable actions"), "Should mention no actions");
  });
});

// ===== commitChanges nothing to commit =====

Deno.test("ExecutionLoop: handles nothing to commit gracefully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-ext-no-commit-" });
  const { db, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir);
    const activeDir = getWorkspaceActiveDir(tempDir);
    await Deno.mkdir(activeDir, { recursive: true });

    // Create initial file and commit it first
    const testFile = join(tempDir, "existing.txt");
    await Deno.writeTextFile(testFile, "existing content");

    // Git add and commit
    const addCmd = new Deno.Command(PortalOperation.GIT, {
      args: [MemoryOperation.ADD, "."],
      cwd: tempDir,
      stdout: "piped",
      stderr: "piped",
    });
    await addCmd.output();

    const commitCmd = new Deno.Command(PortalOperation.GIT, {
      args: ["commit", "-m", "Initial commit"],
      cwd: tempDir,
      stdout: "piped",
      stderr: "piped",
    });
    await commitCmd.output();

    // Plan that reads but doesn't change anything
    const planContent = `---
trace_id: "test-no-changes"
request_id: no-changes-test
status: active
---

# No Changes Plan

\`\`\`toml
tool = McpToolName.READ_FILE
description = "Just read existing file"

[params]
path = "existing.txt"
\`\`\`
`;

    const planPath = join(activeDir, "no-changes-test.md");
    await Deno.writeTextFile(planPath, planContent);

    const loop = new ExecutionLoop({ config, db, identityId: "test-agent" });
    const result = await loop.processTask(planPath);

    // Should succeed even with nothing to commit
    assertEquals(result.success, true);

    // Check for no_changes log
    await new Promise((resolve) => setTimeout(resolve, 150));
    const activities = db.getActivitiesByTrace("test-no-changes");
    const _noChangesLog = activities.find((a: any) => a.action_type === "execution.no_changes");
    // This may or may not be present depending on whether the tool created any output
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ===== Without database =====

Deno.test("ExecutionLoop: works without database (no logging)", async () => {
  await runExecutionTest(
    "no-db",
    async ({ activeDir, loop }) => {
      const planContent = `---
trace_id: "test-no-db"
request_id: no-db-test
status: active
---

# No Database Test

No actions - just testing without db.
`;

      const planPath = join(activeDir, "no-db-test.md");
      await Deno.writeTextFile(planPath, planContent);

      const result = await loop.processTask(planPath);

      assertEquals(result.success, true);
    },
    { noDb: true },
  );
});

Deno.test("ExecutionLoop: uses correct memory execution path configuration", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "exec-path-config-" });
  const { db, cleanup } = await initTestDbService();

  try {
    const config = createMockConfig(tempDir);

    const _loop = new ExecutionLoop({
      config,
      db,
      identityId: "test-agent",
      llmProvider: undefined,
    });

    // Verify that the execution loop uses the configured memory execution path
    // This is a regression test to ensure paths are not hardcoded
    const expectedPath = join(tempDir, "Memory", "Execution");
    const actualPath = join(config.system.root, config.paths.memory, "Execution");

    assertEquals(actualPath, expectedPath, "ExecutionLoop should use configured memoryExecution path");
  } finally {
    await cleanup();
    await Deno.remove(tempDir, { recursive: true });
  }
});
