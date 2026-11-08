/**
 * @module ApprovalCommandsTest
 * @path apps/exactl/tests/approval_commands_test.ts
 * @description Verifies ApprovalCommands over wait states and tool confirmations: typed ids, bare ids, verbs, journal rows and usage errors.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, apps/exactl/src/commands/approval_commands.ts, apps/exactl/tests/helpers/test_setup.ts]
 * @related-files [apps/exactl/src/commands/approval_commands.ts, apps/exactl/src/commands/wait_state_commands.ts, apps/exactl/src/commands/tool_commands.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { IWaitState } from "@exaix/flow";
import type { ToolConfirmationRequest } from "@exaix/schemas/tool_confirmation.ts";
import { createStubGit } from "@exaix/testing";
import { stub } from "@std/testing/mock";
import { DomainEventType } from "@exaix/core/events";
import { ApprovalCommands } from "../src/commands/approval_commands.ts";
import { toolApprovalSource, waitApprovalSource } from "../src/commands/approval_sources.ts";
import { ToolCommands } from "../src/commands/tool_commands.ts";
import { WaitStateCommands } from "../src/commands/wait_state_commands.ts";
import { ExaCtlError, ExaCtlExitCode } from "../src/exactl_errors.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

const TOKEN = "550e8400-e29b-41d4-a716-446655440001";
const OTHER_TOKEN = "550e8400-e29b-41d4-a716-446655440002";
const WAIT_ID = "550e8400-e29b-41d4-a716-446655440000";
const TOOL_ID = "123e4567-e89b-42d3-a456-426614174000";
const TRACE = "trace-001";
const CLI_USER = "cli-user";

type CliContext = Awaited<ReturnType<typeof createCliTestContext>>;

function makeWaitState(resumeToken: string, overrides: Partial<IWaitState> = {}): IWaitState {
  return {
    waitStateId: WAIT_ID,
    traceId: TRACE,
    kind: "plan_approval",
    status: "pending",
    artifactPath: "Workspace/Active/test-flow",
    resumeToken,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 86_400_000).toISOString(),
    metadata: {},
    ...overrides,
  };
}

function makeToolRequest(id: string): ToolConfirmationRequest {
  return {
    id,
    toolName: "exaix_request_create",
    args: { title: "Create request" },
    stepId: "step-1",
    traceId: "tool-trace-1",
    requestedAt: "2026-05-18T10:00:00.000Z",
    expiresAt: "2099-05-18T10:02:00.000Z",
  };
}

async function seedWaitState(env: CliContext, waitState: IWaitState): Promise<string> {
  const config = env.context.config.getAll();
  const dir = join(env.tempDir, config.paths.workspace!, config.paths.waitStates!, waitState.traceId);
  await Deno.mkdir(dir, { recursive: true });
  const path = join(dir, `${waitState.waitStateId}.json`);
  await Deno.writeTextFile(path, JSON.stringify(waitState, null, 2));
  return path;
}

function makeCommands(env: CliContext): ApprovalCommands {
  env.context.git = createStubGit({ getCurrentBranch: () => Promise.resolve("main") });
  const waitStates = new WaitStateCommands(env.context);
  const tools = new ToolCommands(env.context);
  return new ApprovalCommands(env.context, waitStates, tools, [
    waitApprovalSource(waitStates),
    toolApprovalSource(tools),
  ]);
}

async function usageError<T>(run: () => Promise<T>): Promise<ExaCtlError> {
  const error = await assertRejects(run, ExaCtlError);
  assertEquals(error.code, ExaCtlExitCode.USAGE);
  return error;
}

Deno.test("approve wait:<token> resolves the wait state with resolvedBy", async () => {
  const env = await createCliTestContext();
  try {
    const path = await seedWaitState(env, makeWaitState(TOKEN));
    const decision = await makeCommands(env).approve(`wait:${TOKEN}`, { resolvedBy: "user-simulator:cooperative" });
    assertEquals(decision.status, "fulfilled");
    const stored = JSON.parse(await Deno.readTextFile(path));
    assertEquals(stored.status, "fulfilled");
    assertEquals(stored.metadata.resolvedBy, "user-simulator:cooperative");
  } finally {
    await env.cleanup();
  }
});

Deno.test("approve wait:<token> without --resolved-by journals wait_state.command_resolved with the user identity", async () => {
  const env = await createCliTestContext();
  try {
    await seedWaitState(env, makeWaitState(TOKEN));
    await makeCommands(env).approve(`wait:${TOKEN}`, { message: "Looks good" });
    await env.db.waitForFlush();
    const rows = env.db.instance.prepare("SELECT * FROM activity WHERE action_type = ?").all(
      DomainEventType.WaitStateCommandResolved,
    ) as Array<{ target: string; trace_id: string; payload: string }>;
    assertEquals(rows.length, 1);
    assertEquals(rows[0].target, CLI_USER);
    assertEquals(rows[0].trace_id, TRACE);
    assertEquals(JSON.parse(rows[0].payload).resolvedBy, CLI_USER);
  } finally {
    await env.cleanup();
  }
});

Deno.test("approve tool:<id> writes an approved decision and emits tool_confirmation.decided", async () => {
  const env = await createCliTestContext();
  try {
    const request = makeToolRequest(TOOL_ID);
    await env.db.insertToolConfirmationRequest(request);
    await makeCommands(env).approve(`tool:${TOOL_ID}`, {});
    await env.db.waitForFlush();
    const decision = await env.db.getToolConfirmationDecision(TOOL_ID);
    assertEquals(decision?.approved, true);
    assertEquals(decision?.decidedBy, CLI_USER);
    const rows = env.db.instance.prepare("SELECT * FROM activity WHERE action_type = ?").all(
      DomainEventType.ToolConfirmationDecided,
    ) as Array<{ target: string; trace_id: string; payload: string }>;
    assertEquals(rows.length, 1);
    assertEquals(rows[0].trace_id, request.traceId);
    const payload = JSON.parse(rows[0].payload);
    assertEquals(payload.confirmation_id, TOOL_ID);
    assertEquals(payload.tool_name, request.toolName);
    assertEquals(payload.step_id, request.stepId);
    assertEquals(payload.approved, true);
    assertEquals(payload.decided_by, CLI_USER);
  } finally {
    await env.cleanup();
  }
});

Deno.test("reject tool:<id> denies with the default reason and journals approved false", async () => {
  const env = await createCliTestContext();
  try {
    await env.db.insertToolConfirmationRequest(makeToolRequest(TOOL_ID));
    await makeCommands(env).reject(`tool:${TOOL_ID}`, {});
    await env.db.waitForFlush();
    const decision = await env.db.getToolConfirmationDecision(TOOL_ID);
    assertEquals(decision?.approved, false);
    assertEquals(decision?.reason, "User declined");
    const rows = env.db.instance.prepare("SELECT payload FROM activity WHERE action_type = ?").all(
      DomainEventType.ToolConfirmationDecided,
    ) as Array<{ payload: string }>;
    assertEquals(JSON.parse(rows[0].payload).approved, false);
    assertEquals(JSON.parse(rows[0].payload).reason, "User declined");
  } finally {
    await env.cleanup();
  }
});

Deno.test("reject wait:<token> --reason moves the wait state to rejected", async () => {
  const env = await createCliTestContext();
  try {
    const path = await seedWaitState(env, makeWaitState(TOKEN));
    const decision = await makeCommands(env).reject(`wait:${TOKEN}`, { reason: "x" });
    assertEquals(decision.status, "rejected");
    const stored = JSON.parse(await Deno.readTextFile(path));
    assertEquals(stored.status, "rejected");
    assertEquals(stored.resolutionSummary, "x");
  } finally {
    await env.cleanup();
  }
});

Deno.test("amend, expire and cancel act on wait refs", async () => {
  const env = await createCliTestContext();
  try {
    const commands = makeCommands(env);
    const verbs = [["amend", "amended"], ["expire", "expired"], ["cancel", "cancelled"]] as const;
    for (const [index, [verb, status]] of verbs.entries()) {
      const token = `550e8400-e29b-41d4-a716-44665544010${index}`;
      await seedWaitState(env, makeWaitState(token, { waitStateId: `550e8400-e29b-41d4-a716-44665544020${index}` }));
      const decision = await commands[verb](`wait:${token}`, {});
      assertEquals(decision.status, status, verb);
    }
  } finally {
    await env.cleanup();
  }
});

Deno.test("a bare id matching both kinds is a usage error listing both refs", async () => {
  const env = await createCliTestContext();
  try {
    await seedWaitState(env, makeWaitState(TOOL_ID));
    await env.db.insertToolConfirmationRequest(makeToolRequest(TOOL_ID));
    const error = await usageError(() => makeCommands(env).approve(TOOL_ID, {}));
    assertStringIncludes(error.message, `wait:${TOOL_ID}`);
    assertStringIncludes(error.message, `tool:${TOOL_ID}`);
  } finally {
    await env.cleanup();
  }
});

Deno.test("a bare id resolves when exactly one source matches and exits 3 when none does", async () => {
  const env = await createCliTestContext();
  try {
    await seedWaitState(env, makeWaitState(TOKEN));
    await env.db.insertToolConfirmationRequest(makeToolRequest(TOOL_ID));
    const commands = makeCommands(env);
    assertEquals((await commands.approve(TOKEN, {})).status, "fulfilled");
    assertEquals((await commands.approve(TOOL_ID, {})).kind, "tool");
    const missing = await assertRejects(() => commands.approve(OTHER_TOKEN, {}), ExaCtlError);
    assertEquals(missing.code, ExaCtlExitCode.NOT_FOUND);
  } finally {
    await env.cleanup();
  }
});

Deno.test("amend on a tool ref exits 2", async () => {
  const env = await createCliTestContext();
  try {
    await env.db.insertToolConfirmationRequest(makeToolRequest(TOOL_ID));
    const commands = makeCommands(env);
    for (const verb of ["amend", "expire", "cancel"] as const) {
      const error = await usageError(() => commands[verb](`tool:${TOOL_ID}`, {}));
      assertStringIncludes(error.message, verb);
    }
    assertEquals(await env.db.getToolConfirmationDecision(TOOL_ID), null);
  } finally {
    await env.cleanup();
  }
});

Deno.test("approve plan:<id> exits 2 naming exactl plan approve <id>", async () => {
  const env = await createCliTestContext();
  try {
    const commands = makeCommands(env);
    const approve = await usageError(() => commands.approve("plan:p-42", {}));
    assertStringIncludes(approve.message, "exactl plan approve p-42");
    const reject = await usageError(() => commands.reject("review:r-7", {}));
    assertStringIncludes(reject.message, "exactl review reject r-7");
    const clarify = await usageError(() => commands.approve("clarification:request-abcd1234", {}));
    assertStringIncludes(clarify.message, "exactl request clarify request-abcd1234");
  } finally {
    await env.cleanup();
  }
});

Deno.test("list returns the pending wait states and tool confirmations with typed refs", async () => {
  const env = await createCliTestContext();
  try {
    await seedWaitState(env, makeWaitState(TOKEN));
    await seedWaitState(
      env,
      makeWaitState(OTHER_TOKEN, { waitStateId: "550e8400-e29b-41d4-a716-446655440003", status: "fulfilled" }),
    );
    await env.db.insertToolConfirmationRequest(makeToolRequest(TOOL_ID));
    const entries = await makeCommands(env).list({});
    assertEquals(entries.map((entry) => entry.ref).sort(), [`tool:${TOOL_ID}`, `wait:${TOKEN}`]);
    const tool = entries.find((entry) => entry.kind === "tool");
    assertStringIncludes(tool?.summary ?? "", "exaix_request_create");
    assertStringIncludes(tool?.summary ?? "", "step-1");
    assertEquals(tool?.act, `exactl approval approve tool:${TOOL_ID}`);
  } finally {
    await env.cleanup();
  }
});

Deno.test("show prints the fields of a wait state and of a tool confirmation", async () => {
  const env = await createCliTestContext();
  try {
    await seedWaitState(env, makeWaitState(TOKEN));
    await env.db.insertToolConfirmationRequest(makeToolRequest(TOOL_ID));
    const commands = makeCommands(env);
    const wait = await commands.show(`wait:${TOKEN}`);
    assertEquals(wait.kind, "wait");
    assertEquals(wait.fields.status, "pending");
    const tool = await commands.show(TOOL_ID);
    assertEquals(tool.kind, "tool");
    assertEquals(tool.fields.toolName, "exaix_request_create");
  } finally {
    await env.cleanup();
  }
});

Deno.test("a failing tool source prints a stderr notice and the wait rows still list", async () => {
  const env = await createCliTestContext();
  const notices: string[] = [];
  const consoleError = stub(console, "error", (...parts: string[]) => {
    notices.push(parts.join(" "));
  });
  try {
    await seedWaitState(env, makeWaitState(TOKEN));
    const tools = new ToolCommands(env.context);
    tools.listPending = () => Promise.reject(new Error("no such table: pending_tool_confirmations"));
    const waitStates = new WaitStateCommands(env.context);
    const commands = new ApprovalCommands(env.context, waitStates, tools, [
      waitApprovalSource(waitStates),
      toolApprovalSource(tools),
    ]);
    const entries = await commands.list({});
    assertEquals(entries.map((entry) => entry.ref), [`wait:${TOKEN}`]);
    assertEquals(notices.length, 1);
    assertStringIncludes(notices[0], "tool");
    assertStringIncludes(notices[0], "no such table");
  } finally {
    consoleError.restore();
    await env.cleanup();
  }
});

Deno.test("a second decision on one tool confirmation is refused and journals one decided event", async () => {
  const env = await createCliTestContext();
  try {
    const request = makeToolRequest(TOOL_ID);
    await env.db.insertToolConfirmationRequest(request);
    const commands = makeCommands(env);
    await commands.reject(`tool:${TOOL_ID}`, { reason: "first" });
    const stalePending = stub(env.db, "listPendingToolConfirmations", () => Promise.resolve([request]));
    try {
      const error = await assertRejects(() => commands.approve(`tool:${TOOL_ID}`, {}), ExaCtlError);
      assertEquals(error.code, ExaCtlExitCode.STATE_CONFLICT);
    } finally {
      stalePending.restore();
    }
    await env.db.waitForFlush();
    assertEquals((await env.db.getToolConfirmationDecision(TOOL_ID))?.approved, false);
    const rows = env.db.instance.prepare("SELECT payload FROM activity WHERE action_type = ?").all(
      DomainEventType.ToolConfirmationDecided,
    );
    assertEquals(rows.length, 1);
  } finally {
    await env.cleanup();
  }
});

Deno.test("approve after reject exits 4 and the stored decision stays denied", async () => {
  const env = await createCliTestContext();
  try {
    await env.db.insertToolConfirmationRequest(makeToolRequest(TOOL_ID));
    const commands = makeCommands(env);
    await commands.reject(`tool:${TOOL_ID}`, { reason: "first" });
    const error = await assertRejects(() => commands.approve(`tool:${TOOL_ID}`, {}), ExaCtlError);
    assertEquals(error.code, ExaCtlExitCode.STATE_CONFLICT);
    assertStringIncludes(error.message, "already");
    assertEquals((await env.db.getToolConfirmationDecision(TOOL_ID))?.approved, false);
  } finally {
    await env.cleanup();
  }
});

Deno.test("an unknown or malformed tool confirmation id exits 3 or 2", async () => {
  const env = await createCliTestContext();
  try {
    const commands = makeCommands(env);
    const unknown = await assertRejects(() => commands.approve(`tool:${TOOL_ID}`, {}), ExaCtlError);
    assertEquals(unknown.code, ExaCtlExitCode.NOT_FOUND);
    const malformed = await assertRejects(() => commands.approve("tool:not-a-uuid", {}), ExaCtlError);
    assertEquals(malformed.code, ExaCtlExitCode.USAGE);
  } finally {
    await env.cleanup();
  }
});
