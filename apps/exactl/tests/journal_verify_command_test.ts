/**
 * @module JournalVerifyCommandTest
 * @path apps/exactl/tests/journal_verify_command_test.ts
 * @description Verifies `exactl journal verify`: exit 0 on an intact chain, exit 1 on a
 *   tampered row, and an integrity event journalled with a trace id.
 */

import { assert, assertEquals } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { createStubConfig, createStubContext, initTestDbService } from "@exaix/testing";
import { JournalCommands } from "../src/commands/journal_commands.ts";

Deno.test("security: journal verify exit code is 0 for an intact chain and 1 for a broken link", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const cmd = new JournalCommands(createStubContext({ config: createStubConfig(config), db }));

    await db.logActivity("a", "request.created", "target", { foo: "bar" }, "t1");
    await db.logActivity("b", "plan.created", "target", { foo: "bar" }, "t1");
    await db.waitForFlush();

    assertEquals(await cmd.verify(), 0, "an intact chain must exit 0");

    await db.waitForFlush();
    const verified = await db.queryActivity({ actionType: DomainEventType.JournalIntegrityVerified });
    assertEquals(verified.length, 1, "a verified event must be journalled");
    assert(verified[0].trace_id.length > 0, "the verified event must carry a trace id");

    await db.preparedRun("UPDATE activity SET payload = ? WHERE action_type = ?", [
      '{"foo":"tampered"}',
      "plan.created",
    ]);
    assertEquals(await cmd.verify(), 1, "a tampered chain must exit 1");
  } finally {
    await cleanup();
  }
});

Deno.test("security: journal verify reports an unhashed prefix without failing", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const cmd = new JournalCommands(createStubContext({ config: createStubConfig(config), db }));

    await db.preparedRun(
      "INSERT INTO activity (id, trace_id, actor, action_type, payload, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      ["legacy-1", "t-legacy", "user", "legacy.action", "{}", "2020-01-01T00:00:00.000Z"],
    );
    await db.logActivity("a", "request.created", "target", { foo: "bar" }, "t1");
    await db.waitForFlush();

    assertEquals(await cmd.verify(), 0, "an unhashed legacy prefix must not fail verification");
  } finally {
    await cleanup();
  }
});
