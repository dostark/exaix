/**
 * @module DestructiveVerbsConfirmTest
 * @path apps/exactl/tests/destructive_verbs_confirm_test.ts
 * @description Runs the real exactl binary to check that each destructive verb exits 2 without a terminal and without --yes, changes nothing, and acts under --yes.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/output/exactl_confirm.ts, apps/exactl/src/command_builders/blueprint_command.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";
import { SEEDED_PLAN_ID, SEEDED_REQUEST_TRACE, SEEDED_WAIT_TOKEN, seedWorkNouns } from "./helpers/work_nouns_seed.ts";
import { seedOperationsA } from "./helpers/operations_a_seed.ts";

const BLUEPRINT_ID = "old-reviewer";
const PORTAL_ALIAS = "seedportal";
const LEARNING_ID = "learning-1";
const CONFIG_PATH = "ai.timeout_ms";
const CREATE_BLUEPRINT = ["blueprint", "create", BLUEPRINT_ID, "--name", "Old Reviewer", "--model", "mock:test"];

async function seedAll(root: string): Promise<void> {
  await seedWorkNouns(root);
  await seedOperationsA(root);
}

/** The verbs that confirm, each with the arguments that run it. */
const CONFIRMING_VERBS: ReadonlyArray<readonly [string, string[]]> = [
  ["blueprint remove", ["blueprint", "remove", BLUEPRINT_ID]],
  ["portal remove", ["portal", "remove", PORTAL_ALIAS]],
  ["git worktree prune", ["git", "worktree", "prune"]],
  ["config rollback", ["config", "rollback", CONFIG_PATH, "1"]],
  ["config compact", ["config", "compact"]],
  ["memory learning remove", ["memory", "learning", "remove", LEARNING_ID]],
  ["request cancel", ["request", "cancel", SEEDED_REQUEST_TRACE]],
  ["approval cancel", ["approval", "cancel", `wait:${SEEDED_WAIT_TOKEN}`]],
  ["plan approve --all", ["plan", "approve", "--all"]],
  ["plan amendment approve --all", ["plan", "amendment", "approve", "--all"]],
  ["memory proposal approve --all", ["memory", "proposal", "approve", "--all"]],
];

Deno.test("every confirming verb exits 2 without a TTY and without --yes, naming --yes", async () => {
  const runs = await runExactlSeededWorkspace(seedAll, CONFIRMING_VERBS.map(([, args]) => args));
  CONFIRMING_VERBS.forEach(([name], index) => {
    assertEquals(runs[index].code, ExaCtlExitCode.USAGE, `${name}: ${runs[index].stderr}`);
    assertStringIncludes(runs[index].stderr, "--yes");
  });
});

Deno.test("blueprint remove without a TTY and without --yes exits 2 and keeps the file", async () => {
  const [created, removed, shown] = await runExactlSeededWorkspace(seedAll, [
    CREATE_BLUEPRINT,
    ["blueprint", "remove", BLUEPRINT_ID],
    ["blueprint", "show", BLUEPRINT_ID],
  ]);
  assertEquals(created.code, 0, created.stderr);
  assertEquals(removed.code, ExaCtlExitCode.USAGE, removed.stderr);
  assertEquals(shown.code, 0, shown.stderr);
});

Deno.test("plan approve --all without --yes leaves the plan in review", async () => {
  const [refused, listed] = await runExactlSeededWorkspace(seedAll, [
    ["plan", "approve", "--all"],
    ["plan", "list", "--status", "review", "-o", "json"],
  ]);
  assertEquals(refused.code, ExaCtlExitCode.USAGE, refused.stderr);
  assertStringIncludes(listed.stdout, SEEDED_PLAN_ID);
});

Deno.test("plan approve --all --yes approves without prompting", async () => {
  const [approved, listed] = await runExactlSeededWorkspace(seedAll, [
    ["plan", "approve", "--all", "--yes"],
    ["plan", "list", "--status", "review", "-o", "json"],
  ]);
  assertEquals(approved.code, 0, approved.stderr);
  assertEquals(JSON.parse(listed.stdout), []);
});

Deno.test("--no-input refuses a confirming verb even with a terminal", async () => {
  const [run] = await runExactlSeededWorkspace(seedAll, [["blueprint", "remove", BLUEPRINT_ID, "--no-input"]]);
  assertEquals(run.code, ExaCtlExitCode.USAGE, run.stderr);
});

Deno.test("blueprint remove --yes removes the blueprint", async () => {
  const [created, removed, shown] = await runExactlSeededWorkspace(seedAll, [
    CREATE_BLUEPRINT,
    ["blueprint", "remove", BLUEPRINT_ID, "--yes"],
    ["blueprint", "show", BLUEPRINT_ID],
  ]);
  assertEquals(created.code, 0, created.stderr);
  assertEquals(removed.code, 0, removed.stderr);
  assertEquals(shown.code, ExaCtlExitCode.NOT_FOUND, shown.stderr);
});

Deno.test("--yes and a refusal each appear in the journal as cli.confirmation_resolved", async () => {
  const [refused, confirmed, journal] = await runExactlSeededWorkspace(seedAll, [
    ["plan", "approve", "--all"],
    ["plan", "approve", "--all", "--yes"],
    ["log", "list", "--filter", "action_type=cli.confirmation_resolved", "-o", "json"],
  ]);
  assertEquals(refused.code, ExaCtlExitCode.USAGE, refused.stderr);
  assertEquals(confirmed.code, 0, confirmed.stderr);
  const outcomes = (JSON.parse(journal.stdout) as Array<{ payload: string }>).map((row) => JSON.parse(row.payload));
  assertEquals(outcomes.map((payload) => [payload.mode, payload.outcome]).sort(), [
    ["no_tty", "refused"],
    ["yes", "confirmed"],
  ]);
});
