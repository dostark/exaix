/**
 * @module ApprovalListCliTest
 * @path apps/exactl/tests/approval_list_cli_test.ts
 * @description Runs `exactl approval list` through the real binary on a workspace seeded with one pending item per source.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @db/sqlite, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/commands/approval_sources.ts, apps/exactl/src/command_builders/approval_command.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import * as pathBuilders from "@exaix/shared";
import { createMinimalProposal } from "@exaix/testing";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";

const EXIT_USAGE = 2;
const TOOL_ID = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = "550e8400-e29b-41d4-a716-446655440001";
const WAIT_ID = "550e8400-e29b-41d4-a716-446655440000";
const TRACE = "trace-approval-list-cli";
const PLAN_ID = "plan-review";
const AMENDMENT_ID = "plan-amend";
const REQUEST_STEM = "request-clarify";
const REVIEW_BRANCH = "feat/request-cli-trace-review";
const SKILL_NAME = "cli-draft";
const PROPOSAL = createMinimalProposal();
const EXPIRY_WINDOW_MS = 10 * 60 * 1000;
const KINDS = ["amendment", "clarification", "plan", "proposal", "review", "skill", "tool", "wait"];

async function writeFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, content);
}

async function seed(root: string): Promise<void> {
  const plans = join(root, "Workspace", "Plans");
  await writeFile(
    join(plans, `${PLAN_ID}.md`),
    `---\ntrace_id: "trace-plan"\nstatus: review\nagent_role: senior-coder\ncreated_at: "2026-01-01T00:00:00Z"\nsubject: Plan to review\n---\n\n# Plan\n`,
  );
  await writeFile(
    join(root, "Workspace", "Active", `${AMENDMENT_ID}.md`),
    `---\ntrace_id: "trace-amend"\nstatus: amendment_pending\nagent_role: senior-coder\ncreated_at: "2026-01-02T00:00:00Z"\nsubject: Plan to amend\n---\n\n# Plan\n`,
  );
  await writeFile(
    join(root, "Workspace", "Requests", `${REQUEST_STEM}.md`),
    `---\ntrace_id: ${TRACE}\nstatus: needs_clarification\ncreated: 2026-01-03T00:00:00Z\ncreated_by: tester\nsource: cli\nsubject: Clarify me\n---\nBody\n`,
  );
  await writeFile(
    join(pathBuilders.memoryPendingPath(join(root, "Memory")), `${PROPOSAL.id}.json`),
    JSON.stringify(PROPOSAL),
  );
  await writeFile(
    join(root, "Workspace", "WaitStates", TRACE, `${WAIT_ID}.json`),
    JSON.stringify({
      waitStateId: WAIT_ID,
      traceId: "trace-wait",
      kind: "plan_approval",
      status: "pending",
      artifactPath: "Workspace/Active/test-flow",
      resumeToken: TOKEN,
      createdAt: "2026-01-04T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
      metadata: {},
    }),
  );
  const db = new Database(pathBuilders.runtimePath(root, "journal.db"));
  try {
    const now = new Date();
    db.prepare(
      `INSERT INTO reviews (id, trace_id, portal, branch, status, created, created_by, repository, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "review-db",
      "trace-review",
      "portal",
      REVIEW_BRANCH,
      "pending",
      "2026-01-05T00:00:00.000Z",
      "tester",
      root,
      "desc",
    );
    db.prepare(
      `INSERT INTO pending_tool_confirmations (
        id, tool_name, args_json, step_id, trace_id, requested_at, expires_at, approved, reason, decided_at, decided_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
    ).run(
      TOOL_ID,
      "exaix_request_create",
      JSON.stringify({ title: "Seeded" }),
      "step-1",
      "trace-tool",
      "2026-01-06T00:00:00.000Z",
      new Date(now.getTime() + EXPIRY_WINDOW_MS).toISOString(),
    );
  } finally {
    db.close();
  }
}

const CREATE_DRAFT = ["skill", "create", SKILL_NAME, "--instructions", "Draft body."];

Deno.test("approval list prints one row per source with the typed refs", async () => {
  const [created, list] = await runExactlSeededWorkspace(seed, [CREATE_DRAFT, ["approval", "list"]]);
  assertEquals(created.code, 0, created.stderr);
  assertEquals(list.code, 0, list.stderr);
  const rows = list.stdout.split("\n").filter((line) => line.includes("\t"));
  assertEquals(rows.map((row) => row.split("\t")[1]).sort(), KINDS, list.stdout);
  for (const ref of [`plan:${PLAN_ID}`, `amendment:${AMENDMENT_ID}`, `review:${REVIEW_BRANCH}`]) {
    assertStringIncludes(list.stdout, ref);
  }
  for (const ref of [`clarification:${REQUEST_STEM}`, `proposal:${PROPOSAL.id}`, `skill:${SKILL_NAME}`]) {
    assertStringIncludes(list.stdout, ref);
  }
  assertStringIncludes(list.stdout, `wait:${TOKEN}`);
  assertStringIncludes(list.stdout, `tool:${TOOL_ID}`);
  assertStringIncludes(list.stdout, `exactl skill approve ${SKILL_NAME} --revision `);
});

Deno.test("approval list --kind filters and an unknown kind exits 2", async () => {
  const [filtered, unknown] = await runExactlSeededWorkspace(seed, [
    ["approval", "list", "--kind", "plan,tool"],
    ["approval", "list", "--kind", "nope"],
  ]);
  assertEquals(filtered.code, 0, filtered.stderr);
  const kinds = filtered.stdout.split("\n").filter((line) => line.includes("\t")).map((row) => row.split("\t")[1]);
  assertEquals(kinds.sort(), ["plan", "tool"]);
  assertEquals(unknown.code, EXIT_USAGE, unknown.stderr);
  assertStringIncludes(unknown.stderr, "nope");
});
