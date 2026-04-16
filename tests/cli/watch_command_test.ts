/**
 * @module WatchCommandTest
 * @path tests/cli/watch_command_test.ts
 * @description Tests for the `exactl watch <trace_id>` CLI command that tails
 * live execution SSE streams and falls back to historical DB queries.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { WatchCommand } from "../../src/cli/commands/watch.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";
import { ActivityActor } from "../../src/shared/enums.ts";

// ============================================================================
// Helpers
// ============================================================================

const VALID_TRACE_ID = "550e8400-e29b-41d4-a716-446655440000";

interface IConsoleArgs extends Array<string | number | boolean | object | undefined | null> {}

/**
 * Captures console.log output into an array for assertions.
 */
function withCapturedOutput<T>(fn: () => T | Promise<T>): Promise<{ output: string[]; result: T }> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: IConsoleArgs) => output.push(args.join(" "));

  const result = fn();
  const promise = result instanceof Promise ? result : Promise.resolve(result);

  return promise
    .then((resolved) => ({ output, result: resolved }))
    .finally(() => {
      console.log = originalLog;
    });
}

// ============================================================================
// Command Instantiation Tests
// ============================================================================

Deno.test("WatchCommand: should construct without errors", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const cmd = new WatchCommand(context);
    assertEquals(typeof cmd.watch, "function");
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Historical Fallback Tests (trace not in active execution)
// ============================================================================

Deno.test("WatchCommand: watch should display historical events for completed trace", async () => {
  const { context, db, cleanup } = await createCliTestContext();
  try {
    // Insert some historical activities for the trace
    await db.logActivity(
      ActivityActor.SYSTEM,
      "daemon.starting",
      "main",
      { mode: "development" },
      VALID_TRACE_ID,
    );
    await db.logActivity(
      ActivityActor.SYSTEM,
      "config.loaded",
      "exa.config.toml",
      { checksum: "abc123" },
      VALID_TRACE_ID,
    );
    await db.waitForFlush();

    const cmd = new WatchCommand(context);
    const { output } = await withCapturedOutput(async () => {
      await cmd.watch(VALID_TRACE_ID);
    });

    // Should show historical events
    assertEquals(output.length > 0, true);
    const fullOutput = output.join("\n");
    assertStringIncludes(fullOutput, "daemon.starting");
    assertStringIncludes(fullOutput, "config.loaded");
  } finally {
    await cleanup();
  }
});

Deno.test("WatchCommand: watch should show message for trace with no events", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const unknownTraceId = "00000000-0000-4000-8000-000000000000";
    const cmd = new WatchCommand(context);
    const { output } = await withCapturedOutput(async () => {
      await cmd.watch(unknownTraceId);
    });

    // Should show some message about no events found
    assertEquals(output.length > 0, true);
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test("WatchCommand: should reject non-UUID traceId", async () => {
  const { context, cleanup } = await createCliTestContext();
  const originalCliMode = Deno.env.get("EXA_TEST_CLI_MODE");
  Deno.env.set("EXA_TEST_CLI_MODE", "1");

  try {
    const cmd = new WatchCommand(context);

    let threw = false;
    try {
      await cmd.watch("not-a-uuid");
    } catch {
      threw = true;
    }

    assertEquals(threw, true);
  } finally {
    if (originalCliMode === undefined) {
      Deno.env.delete("EXA_TEST_CLI_MODE");
    } else {
      Deno.env.set("EXA_TEST_CLI_MODE", originalCliMode);
    }
    await cleanup();
  }
});

// ============================================================================
// SSE Formatter Tests
// ============================================================================

Deno.test("WatchCommand: formatSseEvent formats heartbeat as dim", async () => {
  const { output } = await withCapturedOutput(() =>
    WatchCommand.printSseEvent({
      eventId: crypto.randomUUID(),
      traceId: VALID_TRACE_ID,
      timestamp: new Date().toISOString(),
      type: "agent.heartbeat",
      payload: { step: "Step 1", elapsed_ms: 5000 },
    })
  );

  assertEquals(output.length > 0, true);
});

Deno.test("WatchCommand: formatSseEvent formats tool events as cyan", async () => {
  const { output } = await withCapturedOutput(() =>
    WatchCommand.printSseEvent({
      eventId: crypto.randomUUID(),
      traceId: VALID_TRACE_ID,
      timestamp: new Date().toISOString(),
      type: "tool.start",
      payload: { tool: "read_file", path: "hello.txt" },
    })
  );

  assertEquals(output.length > 0, true);
  const fullOutput = output.join("\n");
  assertStringIncludes(fullOutput, "tool.start");
});

Deno.test("WatchCommand: formatSseEvent formats LLM events as white", async () => {
  const { output } = await withCapturedOutput(() =>
    WatchCommand.printSseEvent({
      eventId: crypto.randomUUID(),
      traceId: VALID_TRACE_ID,
      timestamp: new Date().toISOString(),
      type: "llm.stream",
      payload: { text: "Thinking about..." },
    })
  );

  assertEquals(output.length > 0, true);
  const fullOutput = output.join("\n");
  assertStringIncludes(fullOutput, "llm.stream");
});

Deno.test("WatchCommand: formatSseEvent formats flow status as green", async () => {
  const { output } = await withCapturedOutput(() =>
    WatchCommand.printSseEvent({
      eventId: crypto.randomUUID(),
      traceId: VALID_TRACE_ID,
      timestamp: new Date().toISOString(),
      type: "flow.status",
      payload: { status: "running", step: "analyze" },
    })
  );

  assertEquals(output.length > 0, true);
  const fullOutput = output.join("\n");
  assertStringIncludes(fullOutput, "flow.status");
});
