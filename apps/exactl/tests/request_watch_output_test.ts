/**
 * @module RequestWatchOutputTest
 * @path apps/exactl/tests/request_watch_output_test.ts
 * @description Checks that request watch prints one JSON event per line with -o jsonl, from the stored events and from a streamed event.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/src/commands/watch.ts]
 * @related-files [apps/exactl/src/commands/watch.ts, apps/exactl/tests/watch_command_test.ts]
 */

import { assertEquals } from "@std/assert";
import { ActivityActor } from "@exaix/core";
import type { IStreamingEvent } from "@exaix/schemas/streaming_event.ts";
import { ExaCtlOutputFormat } from "@exaix/cli";
import { WatchCommand } from "../src/commands/watch.ts";
import { createTestRenderer } from "./helpers/captured_output.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

const TRACE_ID = "7b1d4e60-1c2a-4e3b-9f10-2a6c8d9e0f11";

Deno.test("request watch -o jsonl emits one event per line", async () => {
  const { context, db, cleanup } = await createCliTestContext();
  try {
    await db.logActivity(ActivityActor.SYSTEM, "daemon.starting", "main", { mode: "development" }, TRACE_ID);
    await db.logActivity(ActivityActor.SYSTEM, "config.loaded", "", { checksum: "abc123" }, TRACE_ID);
    await db.waitForFlush();
    const { renderer, text } = createTestRenderer(ExaCtlOutputFormat.JSONL);
    await new WatchCommand(context).watch(TRACE_ID, renderer);
    const events = text().trimEnd().split("\n").map((line) => JSON.parse(line) as { action_type: string });
    assertEquals(events.map((event) => event.action_type).sort(), ["config.loaded", "daemon.starting"]);
  } finally {
    await cleanup();
  }
});

Deno.test("a streamed event prints as one JSON line with -o jsonl and as one text line otherwise", async () => {
  const event: IStreamingEvent = {
    eventId: crypto.randomUUID(),
    traceId: TRACE_ID,
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "agent.heartbeat",
    payload: { step: "Step 1", elapsed_ms: 5000 },
  };
  const machine = createTestRenderer(ExaCtlOutputFormat.JSONL);
  await WatchCommand.emitSseEvent(event, machine.renderer);
  assertEquals((JSON.parse(machine.text()) as { type: string }).type, "agent.heartbeat");
  const human = createTestRenderer(ExaCtlOutputFormat.TEXT);
  await WatchCommand.emitSseEvent(event, human.renderer);
  assertEquals(human.text().trimEnd().split("\n").length, 1);
});
