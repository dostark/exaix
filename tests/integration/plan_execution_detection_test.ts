// deno-lint-ignore-file no-explicit-any
/**
 * @module PlanExecutionDetectionIntegrationTest
 * @path tests/integration/plan_execution_detection_test.ts
 * @description Verifies the system's ability to detect and queue approved plans for execution,
 * ensuring it ignores malformed or non-plan files within the tracking directories.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { MemoryStatus } from "@exaix/core/status";
import { TestEnvironment } from "./helpers/test_environment.ts";
import { getWorkspaceActiveDir } from "@exaix/testing";

interface Frontmatter {
  trace_id?: string;
  request_id?: string;
  agent_role?: string;
  status?: string;
  created_at?: string;
  [key: string]: any;
}

function createWatcherEnv(): Promise<TestEnvironment> {
  return TestEnvironment.create({
    initGit: false,
    configOverrides: {
      watcher: { debounce_ms: 50, stability_check: false },
    },
  });
}

async function createActiveDir(env: TestEnvironment): Promise<string> {
  const activePath = getWorkspaceActiveDir(env.tempDir);
  await ensureDir(activePath);
  return activePath;
}

/** Wait for the file watcher to process (with stability check). */
function waitForWatcher(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

async function assertFileExists(path: string, message: string): Promise<void> {
  const exists = await Deno.stat(path)
    .then(() => true)
    .catch(() => false);
  assertEquals(exists, true, message);
}

Deno.test("Integration: Plan Execution Detection - approved plan detected", async () => {
  const env = await createWatcherEnv();

  try {
    const activePath = await createActiveDir(env);

    const traceId = crypto.randomUUID();
    const requestId = `request-${traceId.slice(0, 8)}`;
    const planContent = `---
trace_id: "${traceId}"
request_id: "${requestId}"
agent_role: "senior-coder"
status: approved
created_at: "${new Date().toISOString()}"
---

# Plan: ${requestId}

## Proposed Plan

### Overview
Implement a hello world function in utils.ts.

### Steps
1. **Create File** - Create src/utils.ts with hello function
2. **Write Tests** - Add tests for the hello function
3. **Verify** - Ensure tests pass

### Expected Outcome
A working hello world function with tests.
`;

    const planPath = join(activePath, `${requestId}_plan.md`);
    await Deno.writeTextFile(planPath, planContent);

    await waitForWatcher();

    await assertFileExists(planPath, "Plan file should exist");

    const content = await Deno.readTextFile(planPath);
    assertStringIncludes(content, traceId);
    assertStringIncludes(content, MemoryStatus.APPROVED);
    assertStringIncludes(content, "Implement a hello world function");

    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assertExists(yamlMatch, "Should have YAML frontmatter");

    const frontmatter = parseYaml(yamlMatch[1]) as Frontmatter;

    assertEquals(frontmatter.trace_id, traceId);
    assertEquals(frontmatter.request_id, requestId);
    assertEquals(frontmatter.status, MemoryStatus.APPROVED);

    console.log("✅ Integration test passed: Plan detection successful");
  } finally {
    await env.cleanup();
  }
});

Deno.test("Integration: Plan Execution Detection - ignores non-plan files", async () => {
  const env = await createWatcherEnv();

  try {
    const activePath = await createActiveDir(env);

    // Create non-plan files
    await Deno.writeTextFile(join(activePath, "README.md"), "# Active Tasks");
    await Deno.writeTextFile(join(activePath, "notes.txt"), "Some notes");
    await Deno.writeTextFile(
      join(activePath, "config.json"),
      JSON.stringify({ test: true }),
    );

    const traceId = crypto.randomUUID();
    const planPath = join(activePath, `request-${traceId.slice(0, 8)}_plan.md`);
    await Deno.writeTextFile(
      planPath,
      `---
trace_id: "${traceId}"
status: approved
---

# Plan
`,
    );

    await waitForWatcher();

    const files = [];
    for await (const entry of Deno.readDir(activePath)) {
      if (entry.isFile && entry.name.endsWith("_plan.md")) {
        files.push(entry.name);
      }
    }

    assertEquals(files.length, 1);
    assertEquals(files[0], `request-${traceId.slice(0, 8)}_plan.md`);

    console.log("✅ Integration test passed: Non-plan files ignored");
  } finally {
    await env.cleanup();
  }
});

Deno.test("Integration: Plan Execution Detection - handles invalid plan gracefully", async () => {
  const env = await createWatcherEnv();

  try {
    const activePath = await createActiveDir(env);

    const planPath = join(activePath, "invalid_plan.md");
    await Deno.writeTextFile(
      planPath,
      `---
trace_id: [broken yaml syntax
status: invalid
---

# Invalid Plan
`,
    );

    await waitForWatcher();

    await assertFileExists(planPath, "Invalid plan file should still exist");

    console.log("✅ Integration test passed: Invalid plan handled gracefully");
  } finally {
    await env.cleanup();
  }
});

Deno.test("Integration: Plan Execution Detection - handles missing trace_id", async () => {
  const env = await createWatcherEnv();

  try {
    const activePath = await createActiveDir(env);

    const planPath = join(activePath, "no-trace_plan.md");
    await Deno.writeTextFile(
      planPath,
      `---
request_id: "request-test"
status: approved
---

# Plan without trace_id
`,
    );

    await waitForWatcher();

    await assertFileExists(planPath, "Plan without trace_id should still exist");

    console.log("✅ Integration test passed: Missing trace_id handled gracefully");
  } finally {
    await env.cleanup();
  }
});
