/**
 * @module JournalWaitCommandTest
 * @path apps/exactl/tests/journal_wait_command_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Tests for `exactl journal wait` — a readiness barrier that polls the activity
 *   journal until a matching event appears above a rowid baseline (or times out). Used by
 *   scenario steps to replace the framework's wait-for-journal-event step type.
 */

import { assertStringIncludes } from "@std/assert";
import { JournalCommands } from "../src/commands/journal_commands.ts";
import { initTestDbService } from "@exaix/testing";
import { createStubConfig, createStubContext } from "@exaix/testing";
import { captureConsoleOutput } from "./helpers/console_utils.ts";
import { expectExitWithLogs } from "./helpers/test_utils.ts";
import type { IJournalWaitOptions } from "../src/commands/journal_commands.ts";

function waitCommand(
  db: Awaited<ReturnType<typeof initTestDbService>>["db"],
  config: Awaited<ReturnType<typeof initTestDbService>>["config"],
): JournalCommands {
  return new JournalCommands(createStubContext({ config: createStubConfig(config), db }));
}

async function currentMaxRowid(db: Awaited<ReturnType<typeof initTestDbService>>["db"]): Promise<number> {
  const row = await db.preparedGet<{ m: number }>("SELECT MAX(rowid) AS m FROM activity");
  return row?.m ?? 0;
}

Deno.test({
  name: "journal wait returns when the event is present above the baseline",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, config, cleanup } = await initTestDbService();
    try {
      db.logActivity("system", "request.created", "", {}, "t-1");
      await db.waitForFlush();
      const since = await currentMaxRowid(db);
      db.logActivity("system", "daemon.ready", "", {}, "t-1");
      await db.waitForFlush();
      const out = await captureConsoleOutput(
        () => (waitCommand(db, config).wait({ event: "daemon.ready", sinceRowid: since, timeout: 2 })),
      );
      assertStringIncludes(out, "Journal event present: daemon.ready");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "journal wait --since (ISO timestamp) counts events timestamped after it",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, config, cleanup } = await initTestDbService();
    try {
      await db.preparedRun(
        "INSERT INTO activity (id, trace_id, actor, action_type, payload, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        ["a1", "t-1", "system", "daemon.ready", "{}", "2020-01-02T00:00:00.000Z"],
      );
      await db.waitForFlush();
      const out = await captureConsoleOutput(
        () => (waitCommand(db, config).wait({ event: "daemon.ready", since: "2020-01-01T00:00:00.000Z", timeout: 1 })),
      );
      assertStringIncludes(out, "Journal event present: daemon.ready");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "journal wait --since (ISO timestamp) ignores events timestamped at or before it",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, config, cleanup } = await initTestDbService();
    try {
      await db.preparedRun(
        "INSERT INTO activity (id, trace_id, actor, action_type, payload, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        ["a1", "t-1", "system", "daemon.ready", "{}", "2020-01-01T00:00:00.000Z"],
      );
      await db.waitForFlush();
      const result = await expectExitWithLogs(
        () => (waitCommand(db, config).wait({ event: "daemon.ready", since: "2020-01-01T00:00:00.000Z", timeout: 1 })),
      );
      assertStringIncludes(result.errors.join("\n"), "Timeout");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "journal wait ignores events at or below the sinceRowid baseline (times out)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, config, cleanup } = await initTestDbService();
    try {
      db.logActivity("system", "daemon.ready", "", {}, "t-1");
      await db.waitForFlush();
      const since = await currentMaxRowid(db);
      const result = await expectExitWithLogs(
        () => (waitCommand(db, config).wait({ event: "daemon.ready", sinceRowid: since, timeout: 1 })),
      );
      assertStringIncludes(result.errors.join("\n"), "Timeout");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "journal wait times out when the event never appears",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, config, cleanup } = await initTestDbService();
    try {
      db.logActivity("system", "request.created", "", {}, "t-1");
      await db.waitForFlush();
      const result = await expectExitWithLogs(
        () => (waitCommand(db, config).wait({ event: "daemon.ready", timeout: 1 })),
      );
      assertStringIncludes(result.errors.join("\n"), "Timeout");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "journal wait --event (repeated) matches on the first event that appears",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, config, cleanup } = await initTestDbService();
    try {
      db.logActivity("system", "request.created", "", {}, "t-1");
      await db.waitForFlush();
      const since = await currentMaxRowid(db);
      db.logActivity("system", "flow.failed", "", {}, "t-1");
      await db.waitForFlush();
      const out = await captureConsoleOutput(
        () => (
          waitCommand(db, config).wait({
            event: ["flow.completed", "flow.failed"],
            sinceRowid: since,
            timeout: 2,
          })
        ),
      );
      assertStringIncludes(out, "Journal event present: flow.failed");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "journal wait --event (repeated) times out when none of the events appear",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, config, cleanup } = await initTestDbService();
    try {
      db.logActivity("system", "request.created", "", {}, "t-1");
      await db.waitForFlush();
      const result = await expectExitWithLogs(
        () => (
          waitCommand(db, config).wait({
            event: ["flow.completed", "flow.failed"],
            timeout: 1,
          })
        ),
      );
      assertStringIncludes(result.errors.join("\n"), "Timeout");
      assertStringIncludes(result.errors.join("\n"), "flow.completed, flow.failed");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "journal wait without an event is rejected",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { db, config, cleanup } = await initTestDbService();
    try {
      const result = await expectExitWithLogs(
        () => (waitCommand(db, config).wait({ timeout: 1 } as IJournalWaitOptions)),
      );
      assertStringIncludes(result.errors.join("\n"), "requires --event");
    } finally {
      await cleanup();
    }
  },
});
