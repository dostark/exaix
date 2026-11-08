/**
 * @module RequestCancelCommandsTest
 * @path apps/exactl/tests/request_cancel_commands_test.ts
 * @description Verifies RequestCommands cancel for a clarification request: the wait transition is journaled, a failing wait cancel is reported, and the TUI adapter path cancels the wait state too.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @std/testing/mock, apps/exactl/src/commands/request_commands.ts, apps/exactl/tests/helpers/test_setup.ts]
 * @related-files [apps/exactl/src/commands/request_commands.ts, apps/common/adapters/request_adapter.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import { DomainEventType } from "@exaix/core/events";
import { RequestAdapter } from "../../common/adapters/request_adapter.ts";
import { RequestCommands } from "../src/commands/request_commands.ts";
import { WaitStateCommands } from "../src/commands/wait_state_commands.ts";
import { ExaCtlError, ExaCtlExitCode } from "../src/exactl_errors.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

const TRACE = "trace-cancel-wait-1";
const TOKEN = "550e8400-e29b-41d4-a716-446655440031";
const WAIT_ID = "550e8400-e29b-41d4-a716-446655440030";
const CLI_USER = "cli-user";

type CliContext = Awaited<ReturnType<typeof createCliTestContext>>;

async function seedClarification(env: CliContext): Promise<string> {
  const config = env.context.config.getAll();
  const requests = join(env.tempDir, config.paths.workspace!, config.paths.requests!);
  await Deno.mkdir(requests, { recursive: true });
  const requestPath = join(requests, "request-cancelwait.md");
  await Deno.writeTextFile(
    requestPath,
    `---\ntrace_id: ${TRACE}\nstatus: needs_clarification\ncreated: 2026-01-01T00:00:00.000Z\ncreated_by: tester\nsource: cli\nsubject: s\n---\nbody\n`,
  );
  const waitDir = join(env.tempDir, config.paths.workspace!, config.paths.waitStates!, TRACE);
  await Deno.mkdir(waitDir, { recursive: true });
  await Deno.writeTextFile(
    join(waitDir, `${WAIT_ID}.json`),
    JSON.stringify({
      waitStateId: WAIT_ID,
      traceId: TRACE,
      kind: "clarification",
      status: "pending",
      artifactPath: "Workspace/Requests/request-cancelwait.md",
      resumeToken: TOKEN,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    }),
  );
  return join(waitDir, `${WAIT_ID}.json`);
}

async function journalRows(env: CliContext, action: string): Promise<Array<{ trace_id: string; payload: string }>> {
  await env.db.waitForFlush();
  return env.db.instance.prepare("SELECT trace_id, payload FROM activity WHERE action_type = ?").all(action) as Array<
    { trace_id: string; payload: string }
  >;
}

Deno.test("request cancel journals wait_state.command_resolved for the clarification wait state", async () => {
  const env = await createCliTestContext();
  try {
    const waitPath = await seedClarification(env);
    await new RequestCommands(env.context).cancel(TRACE, "no longer needed");
    assertEquals(JSON.parse(await Deno.readTextFile(waitPath)).status, "cancelled");
    const resolved = await journalRows(env, DomainEventType.WaitStateCommandResolved);
    assertEquals(resolved.length, 1);
    assertEquals(resolved[0].trace_id, TRACE);
    assertEquals(JSON.parse(resolved[0].payload).resolvedBy, CLI_USER);
    assertEquals((await journalRows(env, DomainEventType.RequestCancelled)).length, 1);
  } finally {
    await env.cleanup();
  }
});

Deno.test("a failing wait cancel is reported with its approval command and the request stays cancelled", async () => {
  const env = await createCliTestContext();
  const failing = stub(WaitStateCommands.prototype, "cancel", () => Promise.reject(new Error("boom")));
  try {
    await seedClarification(env);
    const error = await assertRejects(() => new RequestCommands(env.context).cancel(TRACE, undefined), ExaCtlError);
    assertEquals(error.code, ExaCtlExitCode.FAILURE);
    assertStringIncludes(error.message, `exactl approval cancel wait:${TOKEN}`);
    const requests = join(
      env.tempDir,
      env.context.config.getAll().paths.workspace!,
      env.context.config.getAll().paths.requests!,
    );
    assertStringIncludes(await Deno.readTextFile(join(requests, "request-cancelwait.md")), "status: cancelled");
  } finally {
    failing.restore();
    await env.cleanup();
  }
});

Deno.test("the TUI adapter path cancels the request and its clarification wait state", async () => {
  const env = await createCliTestContext();
  try {
    const waitPath = await seedClarification(env);
    const result = await new RequestAdapter(new RequestCommands(env.context)).cancelRequest(TRACE, undefined);
    assertEquals(result.trace_id, TRACE);
    assertEquals(JSON.parse(await Deno.readTextFile(waitPath)).status, "cancelled");
  } finally {
    await env.cleanup();
  }
});

Deno.test("a wait scan that fails is reported with the command that lists wait states and the request stays cancelled", async () => {
  const env = await createCliTestContext();
  try {
    const waitPath = await seedClarification(env);
    await Deno.remove(join(waitPath, ".."), { recursive: true });
    await Deno.writeTextFile(join(waitPath, ".."), "not a directory");
    const error = await assertRejects(() => new RequestCommands(env.context).cancel(TRACE, undefined), ExaCtlError);
    assertEquals(error.code, ExaCtlExitCode.FAILURE);
    assertStringIncludes(error.message, "exactl approval list --kind wait");
    const requests = join(
      env.tempDir,
      env.context.config.getAll().paths.workspace!,
      env.context.config.getAll().paths.requests!,
    );
    assertStringIncludes(await Deno.readTextFile(join(requests, "request-cancelwait.md")), "status: cancelled");
  } finally {
    await env.cleanup();
  }
});

Deno.test("a wait cancel that rejects with a plain value is reported with that value", async () => {
  const env = await createCliTestContext();
  const failing = stub(WaitStateCommands.prototype, "cancel", () => Promise.reject("plain failure"));
  try {
    await seedClarification(env);
    const error = await assertRejects(() => new RequestCommands(env.context).cancel(TRACE, undefined), ExaCtlError);
    assertStringIncludes(error.message, "plain failure");
    assertStringIncludes(error.message, `exactl approval cancel wait:${TOKEN}`);
  } finally {
    failing.restore();
    await env.cleanup();
  }
});
