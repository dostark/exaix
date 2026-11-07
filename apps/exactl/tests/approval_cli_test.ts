/**
 * @module ApprovalCliTest
 * @path apps/exactl/tests/approval_cli_test.ts
 * @description Runs `exactl approval` through the real binary against a seeded wait state and tool confirmation.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @db/sqlite, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/approval_command.ts, apps/exactl/src/commands/approval_commands.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import * as pathBuilders from "@exaix/shared";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";

const EXIT_USAGE = 2;
const EXIT_NOT_FOUND = 3;
const TOOL_ID = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = "550e8400-e29b-41d4-a716-446655440001";
const WAIT_ID = "550e8400-e29b-41d4-a716-446655440000";
const TRACE = "trace-approval-cli";
const WAIT_STATES_DIR = join("Workspace", "WaitStates");
const EXPIRY_WINDOW_MS = 10 * 60 * 1000;

async function seed(root: string): Promise<void> {
  const waitDir = join(root, WAIT_STATES_DIR, TRACE);
  await Deno.mkdir(waitDir, { recursive: true });
  await Deno.writeTextFile(
    join(waitDir, `${WAIT_ID}.json`),
    JSON.stringify({
      waitStateId: WAIT_ID,
      traceId: TRACE,
      kind: "plan_approval",
      status: "pending",
      artifactPath: "Workspace/Active/test-flow",
      resumeToken: TOKEN,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    }),
  );
  const db = new Database(pathBuilders.runtimePath(root, "journal.db"));
  try {
    const now = new Date();
    db.prepare(
      `INSERT INTO pending_tool_confirmations (
        id, tool_name, args_json, step_id, trace_id, requested_at, expires_at, approved, reason, decided_at, decided_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
    ).run(
      TOOL_ID,
      "exaix_request_create",
      JSON.stringify({ title: "Seeded" }),
      "step-1",
      TRACE,
      now.toISOString(),
      new Date(now.getTime() + EXPIRY_WINDOW_MS).toISOString(),
    );
  } finally {
    db.close();
  }
}

Deno.test("approval approve tool:<id> resolves the confirmation and journals one tool_confirmation.decided with approved true", async () => {
  const [approve, journal] = await runExactlSeededWorkspace(seed, [
    ["approval", "approve", `tool:${TOOL_ID}`],
    ["log", "list", "--filter", "tool_confirmation.decided", "--format", "json"],
  ]);
  assertEquals(approve.code, 0, approve.stderr);
  assertEquals(journal.stdout.split("tool_confirmation.decided").length - 1, 1);
  assertStringIncludes(journal.stdout, TOOL_ID);
  assertStringIncludes(journal.stdout, '\\"approved\\":true');
});

Deno.test("approval reject wait:<token> --reason x moves the wait state to rejected", async () => {
  const [reject, show] = await runExactlSeededWorkspace(seed, [
    ["approval", "reject", `wait:${TOKEN}`, "--reason", "x"],
    ["approval", "show", `wait:${TOKEN}`],
  ]);
  assertEquals(reject.code, 0, reject.stderr);
  assertStringIncludes(show.stdout, "status: rejected");
});

Deno.test("approval list shows the pending wait state and tool confirmation with typed refs", async () => {
  const [list] = await runExactlSeededWorkspace(seed, [["approval", "list"]]);
  assertEquals(list.code, 0, list.stderr);
  assertStringIncludes(list.stdout, `wait:${TOKEN}`);
  assertStringIncludes(list.stdout, `tool:${TOOL_ID}`);
  assertStringIncludes(list.stdout, "exaix_request_create");
});

Deno.test("approval exits 2 for a plan ref and a wait-only verb on a tool ref, and 3 for an unknown id", async () => {
  const [plan, amend, unknown] = await runExactlSeededWorkspace(seed, [
    ["approval", "approve", "plan:p-42"],
    ["approval", "amend", `tool:${TOOL_ID}`],
    ["approval", "approve", "dddd4444-0000-4000-8000-000000000004"],
  ]);
  assertEquals(plan.code, EXIT_USAGE, plan.stderr);
  assertStringIncludes(plan.stderr, "exactl plan approve p-42");
  assertEquals(amend.code, EXIT_USAGE, amend.stderr);
  assertEquals(unknown.code, EXIT_NOT_FOUND, unknown.stderr);
});
