/**
 * @module ToolLoggingSecurityTest
 * @path tests/security/tool_logging_security_test.ts
 * @related-files ["packages/tool-runtime/src/tool_registry.ts", "packages/core/src/logger/event_logger.ts"]
 * @architectural-layer Tests
 * @description Security regression for audit item R07. A secret inside tool parameters must reach
 *   no log sink: console, configured outputs, the event bus or the activity journal.
 *   The journaled entry must still carry the tool, the outcome, the duration and the path.
 */

import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { ToolName } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import type { ILogEvent } from "@exaix/core/types";
import type { IEventBusService } from "@exaix/core/observability";
import type { IStreamingEvent } from "@exaix/schemas";
import { initTestDbService } from "@exaix/testing";
import { ToolRegistry } from "@exaix/tool-runtime";

const SECRET_SENTINEL = "sk-test-SENTINEL-4f9c2a7e91b3";
const TRACE_ID = "tool-logging-security-trace";
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

Deno.test("[security] tool parameters do not reach console, outputs, event bus or journal", async () => {
  const { db, config, tempDir, cleanup } = await initTestDbService();
  const outputEvents: ILogEvent[] = [];
  const busEvents: IStreamingEvent[] = [];
  const consoleLines: string[] = [];
  const eventBus: IEventBusService = {
    publish: (event) => {
      busEvents.push(event);
    },
    subscribe: () => () => {},
    close: () => {},
  };
  const consoleStubs = CONSOLE_METHODS.map((method) =>
    stub(console, method, (...args: unknown[]) => {
      consoleLines.push(args.map(String).join(" "));
    })
  );
  try {
    const logger = new EventLogger({
      db,
      eventBus,
      outputs: [{
        write: (event) => {
          outputEvents.push(event);
        },
      }],
    });
    const registry = new ToolRegistry({ config, logger, traceId: TRACE_ID, baseDir: tempDir });

    const write = await registry.execute(ToolName.WRITE_FILE, {
      path: "notes.txt",
      content: `token=${SECRET_SENTINEL}`,
    });
    assert(write.success, write.error);
    const denied = await registry.execute(ToolName.RUN_COMMAND, {
      command: "grep",
      args: [`--token=${SECRET_SENTINEL}`, "notes.txt"],
    });
    assert(!denied.success, "the unsafe grep option must be rejected");
    await db.waitForFlush();

    const activities = await db.getActivitiesByTrace(TRACE_ID);
    const sinks: Record<string, string> = {
      console: consoleLines.join("\n"),
      outputs: JSON.stringify(outputEvents),
      eventBus: JSON.stringify(busEvents),
      journal: JSON.stringify(activities),
    };
    for (const [sink, text] of Object.entries(sinks)) {
      assert(!text.includes(SECRET_SENTINEL), `the secret reached the ${sink} sink`);
    }

    const writeEntry = activities.find((activity) => activity.action_type === `tool.${ToolName.WRITE_FILE}`);
    assert(writeEntry, "the write_file call must still be journaled");
    assertEquals(writeEntry.target, "notes.txt");
    const payload = JSON.parse(String(writeEntry.payload));
    assertEquals(payload.success, true);
    assertEquals(typeof payload.duration_ms, "number");
    assertEquals(await Deno.readTextFile(join(tempDir, "notes.txt")), `token=${SECRET_SENTINEL}`);
  } finally {
    for (const consoleStub of consoleStubs) consoleStub.restore();
    await cleanup();
  }
});
