/**
 * @module RequestCancelCliTest
 * @path apps/exactl/tests/request_cancel_cli_test.ts
 * @description Runs `exactl request cancel` through the real binary: exit codes, the journal row and the clarification wait state.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/request_command.ts, packages/request/src/service.ts]
 */

import { assertEquals, assertNotMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runExactlSeededWorkspace } from "./helpers/exactl_cli_process.ts";

const EXIT_USAGE = 2;
const EXIT_NOT_FOUND = 3;
const EXIT_STATE_CONFLICT = 4;
const EXIT_INVALID = 6;
const REQUESTS_DIR = join("Workspace", "Requests");
const WAIT_STATES_DIR = join("Workspace", "WaitStates");
const PENDING_TRACE = "aaaa1111-0000-4000-8000-000000000001";
const RUNNING_TRACE = "bbbb2222-0000-4000-8000-000000000002";
const CLARIFY_TRACE = "cccc3333-0000-4000-8000-000000000003";
const RESUME_TOKEN = "550e8400-e29b-41d4-a716-446655440011";

function requestFile(traceId: string, status: string): string {
  return `---\ntrace_id: "${traceId}"\ncreated: 2026-01-01T00:00:00.000Z\nstatus: ${status}\npriority: normal\nagent_role: default\nsource: cli\ncreated_by: tester\nsubject: ${status} request\n---\n\n# Request\n\nbody\n`;
}

async function seed(root: string): Promise<void> {
  const requests = join(root, REQUESTS_DIR);
  await Deno.mkdir(requests, { recursive: true });
  await Deno.writeTextFile(join(requests, "request-aaaa1111.md"), requestFile(PENDING_TRACE, "pending"));
  await Deno.writeTextFile(join(requests, "request-bbbb2222.md"), requestFile(RUNNING_TRACE, "in_progress"));
  await Deno.writeTextFile(join(requests, "request-cccc3333.md"), requestFile(CLARIFY_TRACE, "needs_clarification"));
  const waitDir = join(root, WAIT_STATES_DIR, CLARIFY_TRACE);
  await Deno.mkdir(waitDir, { recursive: true });
  await Deno.writeTextFile(
    join(waitDir, "clarification-gate.json"),
    JSON.stringify({
      waitStateId: "550e8400-e29b-41d4-a716-446655440010",
      traceId: CLARIFY_TRACE,
      kind: "clarification",
      status: "pending",
      artifactPath: `${WAIT_STATES_DIR}/${CLARIFY_TRACE}/clarification-gate.json`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resumeToken: RESUME_TOKEN,
      metadata: {},
    }),
  );
}

Deno.test("request cancel on a pending request sets cancelled and journals one request.cancelled", async () => {
  const [cancel, show, journal] = await runExactlSeededWorkspace(seed, [
    ["request", "cancel", PENDING_TRACE, "--reason", "no longer needed"],
    ["request", "show", PENDING_TRACE],
    ["log", "list", "--filter", "request.cancelled", "--format", "json"],
  ]);
  assertEquals(cancel.code, 0, cancel.stderr);
  assertStringIncludes(show.stdout, "cancelled");
  assertStringIncludes(journal.stdout, "request.cancelled");
  assertStringIncludes(journal.stdout, PENDING_TRACE);
  assertStringIncludes(journal.stdout, "no longer needed");
});

Deno.test("request cancel on a running request exits 4", async () => {
  const [cancel, show] = await runExactlSeededWorkspace(seed, [
    ["request", "cancel", RUNNING_TRACE],
    ["request", "show", RUNNING_TRACE],
  ]);
  assertEquals(cancel.code, EXIT_STATE_CONFLICT, cancel.stderr);
  assertStringIncludes(cancel.stderr, "in flight");
  assertStringIncludes(show.stdout, "in_progress");
});

Deno.test("request cancel with a short or empty id exits 2 and an unknown id exits 3", async () => {
  const [short, empty, unknown] = await runExactlSeededWorkspace(seed, [
    ["request", "cancel", PENDING_TRACE.slice(0, 7)],
    ["request", "cancel", ""],
    ["request", "cancel", "dddd4444-0000-4000-8000-000000000004"],
  ]);
  assertEquals(short.code, EXIT_USAGE, short.stderr);
  assertEquals(empty.code, EXIT_USAGE, empty.stderr);
  assertEquals(unknown.code, EXIT_NOT_FOUND, unknown.stderr);
});

Deno.test("request cancel on a needs_clarification request also cancels its pending clarification wait state", async () => {
  const [before, cancel, after] = await runExactlSeededWorkspace(seed, [
    ["approval", "list", "--kind", "wait"],
    ["request", "cancel", CLARIFY_TRACE],
    ["approval", "list", "--kind", "wait"],
  ]);
  assertEquals(before.code, 0, before.stderr);
  assertStringIncludes(before.stdout, "wait:");
  assertEquals(cancel.code, 0, cancel.stderr);
  assertEquals(after.code, 0, after.stderr);
  assertNotMatch(after.stdout, /wait:/);
});

Deno.test("request cancel on a request file with a path in its trace id exits 2 and leaves the file", async () => {
  const hostile = "request-hostile.md";
  const original = requestFile("../outside", "pending");
  const [cancel, shown] = await runExactlSeededWorkspace(
    async (root) => {
      await Deno.mkdir(join(root, REQUESTS_DIR), { recursive: true });
      await Deno.writeTextFile(join(root, REQUESTS_DIR, hostile), original);
    },
    [["request", "cancel", hostile], ["request", "list", "--status", "pending"]],
  );
  assertEquals(cancel.code, EXIT_USAGE, cancel.stderr);
  assertStringIncludes(cancel.stderr, "no valid trace id");
  assertEquals(shown.code, 0, shown.stderr);
  assertStringIncludes(shown.stdout, "status: pending");
});

Deno.test("request cancel on a request file with an invalid status exits 6 and leaves the file", async () => {
  const [cancel] = await runExactlSeededWorkspace(
    async (root) => {
      await Deno.mkdir(join(root, REQUESTS_DIR), { recursive: true });
      await Deno.writeTextFile(join(root, REQUESTS_DIR, "request-bogus.md"), requestFile(PENDING_TRACE, "bogus"));
    },
    [["request", "cancel", "request-bogus.md"]],
  );
  assertEquals(cancel.code, EXIT_INVALID, cancel.stderr);
  assertStringIncludes(cancel.stderr, "no valid status");
});
