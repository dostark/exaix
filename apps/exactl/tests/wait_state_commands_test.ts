/**
 * @module WaitStateCommandsTest
 * @path apps/exactl/tests/wait_state_commands_test.ts
 * @related-files [apps/exactl/src/commands/wait_state_commands.ts]
 * @architectural-layer CLI
 * @description Verifies CLI commands for durable wait state management.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { WaitStateCommands } from "../src/commands/wait_state_commands.ts";
import type { IWaitState } from "@exaix/flow";
import { join } from "@std/path";
import { createCliTestContext } from "./helpers/test_setup.ts";

const TEST_TRACE = "trace-001";
const TEST_WAIT_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEST_TOKEN = "550e8400-e29b-41d4-a716-446655440001";

function makeWaitState(
  overrides: Partial<IWaitState> = {},
): IWaitState {
  const base: IWaitState = {
    waitStateId: TEST_WAIT_ID,
    traceId: TEST_TRACE,
    kind: "plan_approval",
    status: "pending",
    artifactPath: "Workspace/Active/test-flow",
    resumeToken: TEST_TOKEN,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 86_400_000).toISOString(),
    metadata: {},
  };
  return { ...base, ...overrides };
}

async function writeWaitState(
  waitStatesDir: string,
  waitState: IWaitState,
): Promise<string> {
  const traceDir = join(waitStatesDir, waitState.traceId);
  await Deno.mkdir(traceDir, { recursive: true });
  const filePath = join(traceDir, `${waitState.waitStateId}.json`);
  await Deno.writeTextFile(filePath, JSON.stringify(waitState, null, 2));
  return filePath;
}

Deno.test("WaitStateCommands: list returns empty when no wait states", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const commands = new WaitStateCommands(context);
    const result = await commands.list();
    assertEquals(result, []);
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: list returns pending wait states", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(
      waitStatesDir,
      makeWaitState({
        waitStateId: "550e8400-e29b-41d4-a716-446655440010",
        resumeToken: "550e8400-e29b-41d4-a716-446655440020",
      }),
    );
    await writeWaitState(
      waitStatesDir,
      makeWaitState({
        waitStateId: "550e8400-e29b-41d4-a716-446655440011",
        resumeToken: "550e8400-e29b-41d4-a716-446655440021",
      }),
    );

    const commands = new WaitStateCommands(context);
    const result = await commands.list();
    assertEquals(result.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: list filters by status", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(
      waitStatesDir,
      makeWaitState({
        waitStateId: "550e8400-e29b-41d4-a716-446655440010",
        resumeToken: "550e8400-e29b-41d4-a716-446655440020",
      }),
    );
    await writeWaitState(
      waitStatesDir,
      makeWaitState({
        waitStateId: "550e8400-e29b-41d4-a716-446655440011",
        resumeToken: "550e8400-e29b-41d4-a716-446655440021",
        status: "fulfilled",
      }),
    );

    const commands = new WaitStateCommands(context);
    const pending = await commands.list("pending");
    assertEquals(pending.length, 1);
    assertEquals(pending[0].resumeToken, "550e8400-e29b-41d4-a716-446655440020");

    const fulfilled = await commands.list("fulfilled");
    assertEquals(fulfilled.length, 1);
    assertEquals(fulfilled[0].resumeToken, "550e8400-e29b-41d4-a716-446655440021");
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: approve transitions pending to fulfilled", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(waitStatesDir, makeWaitState());

    const commands = new WaitStateCommands(context);
    const updated = await commands.approve(TEST_TOKEN, "Looks good");
    assertEquals(updated.status, "fulfilled");
    assertEquals(updated.resolutionSummary, "Looks good");
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: reject transitions pending to rejected", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(waitStatesDir, makeWaitState());

    const commands = new WaitStateCommands(context);
    const updated = await commands.reject(TEST_TOKEN, "Not approved");
    assertEquals(updated.status, "rejected");
    assertEquals(updated.resolutionSummary, "Not approved");
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: amend transitions pending to amended", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(waitStatesDir, makeWaitState());

    const commands = new WaitStateCommands(context);
    const updated = await commands.amend(TEST_TOKEN, "Needs revision");
    assertEquals(updated.status, "amended");
    assertEquals(updated.resolutionSummary, "Needs revision");
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: expire transitions pending to expired", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(waitStatesDir, makeWaitState());

    const commands = new WaitStateCommands(context);
    const updated = await commands.expire(TEST_TOKEN, "Timed out");
    assertEquals(updated.status, "expired");
    assertEquals(updated.resolutionSummary, "Timed out");
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: transition on non-pending wait state errors", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(waitStatesDir, makeWaitState({ status: "fulfilled" }));

    const commands = new WaitStateCommands(context);
    await assertRejects(
      () => commands.approve(TEST_TOKEN),
      Error,
      "Transition fulfilled → approve is not allowed",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: unknown resume token throws error", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const commands = new WaitStateCommands(context);
    await assertRejects(
      () => commands.approve("nonexistent"),
      Error,
      "wait state not found for resume token: nonexistent",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: cancel transitions pending to cancelled", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(waitStatesDir, makeWaitState());

    const commands = new WaitStateCommands(context);
    const updated = await commands.cancel(TEST_TOKEN, "No longer needed");
    assertEquals(updated.status, "cancelled");
    assertEquals(updated.resolutionSummary, "No longer needed");
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: amend on fulfilled wait state throws policy error", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(waitStatesDir, makeWaitState({ status: "fulfilled" }));

    const commands = new WaitStateCommands(context);
    await assertRejects(
      () => commands.amend(TEST_TOKEN, "Too late"),
      Error,
      "Transition fulfilled → amend is not allowed",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: approve with resolvedBy merges it into metadata", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(waitStatesDir, makeWaitState({ metadata: { existingKey: "kept" } }));

    const commands = new WaitStateCommands(context);
    const updated = await commands.approve(TEST_TOKEN, "Looks good", "user-simulator:cooperative");
    assertEquals(updated.status, "fulfilled");
    assertEquals(updated.metadata, { existingKey: "kept", resolvedBy: "user-simulator:cooperative" });
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: approve without resolvedBy leaves metadata unchanged (backward compat)", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(waitStatesDir, makeWaitState({ metadata: { existingKey: "kept" } }));

    const commands = new WaitStateCommands(context);
    const updated = await commands.approve(TEST_TOKEN, "Looks good");
    assertEquals(updated.status, "fulfilled");
    assertEquals(updated.metadata, { existingKey: "kept" });
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: reject with resolvedBy merges it into metadata", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    await writeWaitState(waitStatesDir, makeWaitState());

    const commands = new WaitStateCommands(context);
    const updated = await commands.reject(TEST_TOKEN, "Not approved", "user-simulator:adversarial");
    assertEquals(updated.status, "rejected");
    assertEquals(updated.metadata, { resolvedBy: "user-simulator:adversarial" });
  } finally {
    await cleanup();
  }
});

Deno.test("WaitStateCommands: list returns entries sorted by createdAt descending", async () => {
  const { context, tempDir, cleanup } = await createCliTestContext();
  try {
    const config = context.config.getAll();
    const waitStatesDir = join(tempDir, config.paths.workspace!, config.paths.waitStates!);
    const now = Date.now();
    await writeWaitState(
      waitStatesDir,
      makeWaitState({
        waitStateId: "550e8400-e29b-41d4-a716-446655440010",
        resumeToken: "550e8400-e29b-41d4-a716-446655440020",
        createdAt: new Date(now - 10_000).toISOString(),
      }),
    );
    await writeWaitState(
      waitStatesDir,
      makeWaitState({
        waitStateId: "550e8400-e29b-41d4-a716-446655440011",
        resumeToken: "550e8400-e29b-41d4-a716-446655440021",
        createdAt: new Date(now).toISOString(),
      }),
    );

    const commands = new WaitStateCommands(context);
    const result = await commands.list();
    assertEquals(result.length, 2);
    assertEquals(result[0].resumeToken, "550e8400-e29b-41d4-a716-446655440021");
    assertEquals(result[1].resumeToken, "550e8400-e29b-41d4-a716-446655440020");
  } finally {
    await cleanup();
  }
});
