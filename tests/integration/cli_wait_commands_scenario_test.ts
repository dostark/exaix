/**
 * @module CliWaitCommandsScenarioTest
 * @path tests/integration/cli_wait_commands_scenario_test.ts
 * @description Scenario tests for the full wait-state CLI lifecycle: creating wait-state
 * artifacts on disk and exercising exactl wait list/approve/reject/amend/expire commands.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { cliTest, runExactl } from "./helpers/cli_test_helpers.ts";

const WAIT_UUID = "550e8400-e29b-41d4-a716-446655440000";
const TOKEN_UUID = "550e8400-e29b-41d4-a716-446655440001";
const TRACE_ID = "trace-scenario-45";

function makeWaitStateJson(overrides: object = {}): string {
  return JSON.stringify(
    {
      waitStateId: WAIT_UUID,
      traceId: TRACE_ID,
      kind: "plan_approval",
      status: "pending",
      artifactPath: "Workspace/Active/test-flow",
      resumeToken: TOKEN_UUID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 86_400_000).toISOString(),
      metadata: {},
      ...overrides,
    },
    null,
    2,
  );
}

/** Creates a temp workspace with one wait-state file, runs fn, and cleans up. */
async function withWaitState(
  overrides: object,
  fn: (tempDir: string, waitDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "wait-scenario-" });
  try {
    const waitDir = join(tempDir, "Workspace", "WaitStates", TRACE_ID);
    await Deno.mkdir(waitDir, { recursive: true });
    await Deno.writeTextFile(join(waitDir, `${WAIT_UUID}.json`), makeWaitStateJson(overrides));
    await fn(tempDir, waitDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

async function assertWaitTransition(command: string, message: string, expectedStatus: string): Promise<void> {
  await withWaitState({}, async (tempDir, waitDir) => {
    const result = await runExactl(["wait", command, TOKEN_UUID, "-m", message], tempDir);
    assertEquals(result.code, 0, `expected exit 0, got ${result.code}: ${result.stderr}`);

    const updated = JSON.parse(await Deno.readTextFile(join(waitDir, `${WAIT_UUID}.json`)));
    assertEquals(updated.status, expectedStatus);
    assertEquals(updated.resolutionSummary, message);
  });
}

cliTest("WaitScenario: exactl wait list returns wait states created as files on disk", async () => {
  await withWaitState({}, async (tempDir) => {
    const result = await runExactl(["wait", "list"], tempDir);
    assertEquals(result.code, 0, `expected exit 0, got ${result.code}: ${result.stderr}`);
    assertStringIncludes(result.stdout, WAIT_UUID.substring(0, 8));
  });
});

cliTest("WaitScenario: exactl wait list --status filters by status", async () => {
  await withWaitState({ status: "fulfilled" }, async (tempDir) => {
    const result = await runExactl(["wait", "list", "--status", "fulfilled"], tempDir);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, WAIT_UUID.substring(0, 8));
  });
});

cliTest("WaitScenario: exactl wait approve transitions wait state to fulfilled", async () => {
  await assertWaitTransition("approve", "Approved in scenario", "fulfilled");
});

cliTest("WaitScenario: exactl wait reject transitions wait state to rejected", async () => {
  await assertWaitTransition("reject", "Rejected in scenario", "rejected");
});

cliTest("WaitScenario: exactl wait amend transitions wait state to amended", async () => {
  await assertWaitTransition("amend", "Please revise", "amended");
});

cliTest("WaitScenario: exactl wait expire transitions wait state to expired", async () => {
  await assertWaitTransition("expire", "Timed out", "expired");
});

cliTest("WaitScenario: exactl wait approve on non-pending wait state errors gracefully", async () => {
  await withWaitState({ status: "fulfilled" }, async (tempDir) => {
    const result = await runExactl(["wait", "approve", TOKEN_UUID, "-m", "Should fail"], tempDir);
    assertEquals(result.code, 1);
  });
});

cliTest("WaitScenario: exactl wait list returns empty when no wait states", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "wait-scenario-" });
  try {
    const result = await runExactl(["wait", "list"], tempDir);
    assertEquals(result.code, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
});
