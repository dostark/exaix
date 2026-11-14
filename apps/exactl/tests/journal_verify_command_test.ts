/**
 * @module JournalVerifyCommandTest
 * @path apps/exactl/tests/journal_verify_command_test.ts
 * @description Verifies `exactl log verify`: exit 0 on an intact chain, exit 1 on a
 *   tampered row, and an integrity event journalled with a trace id.
 */

import { assert, assertEquals } from "@std/assert";
import { DomainEventType } from "@exaix/core/events";
import { createStubConfig, createStubContext, initTestDbService } from "@exaix/testing";
import { JournalCommands } from "../src/commands/journal_commands.ts";

Deno.test("security: log verify reports an intact chain as ok and a broken link as failed", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const cmd = new JournalCommands(createStubContext({ config: createStubConfig(config), db }));

    await db.logActivity("a", "request.created", "target", { foo: "bar" }, "t1");
    await db.logActivity("b", "plan.created", "target", { foo: "bar" }, "t1");
    await db.waitForFlush();

    assertEquals((await cmd.verify()).ok, true, "an intact chain must verify");

    await db.waitForFlush();
    const verified = await db.queryActivity({ actionType: DomainEventType.JournalIntegrityVerified });
    assertEquals(verified.length, 1, "a verified event must be journalled");
    assert(verified[0].trace_id.length > 0, "the verified event must carry a trace id");

    await db.preparedRun("UPDATE activity SET payload = ? WHERE action_type = ?", [
      '{"foo":"tampered"}',
      "plan.created",
    ]);
    const broken = await cmd.verify();
    assertEquals(broken.ok, false, "a tampered chain must fail");
    assert(broken.first_broken_id !== null, "the report names the first broken row");
  } finally {
    await cleanup();
  }
});

Deno.test("security: log verify reports an unhashed prefix without failing", async () => {
  const { db, config, cleanup } = await initTestDbService();
  try {
    const cmd = new JournalCommands(createStubContext({ config: createStubConfig(config), db }));

    await db.preparedRun(
      "INSERT INTO activity (id, trace_id, actor, action_type, payload, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      ["legacy-1", "t-legacy", "user", "legacy.action", "{}", "2020-01-01T00:00:00.000Z"],
    );
    await db.logActivity("a", "request.created", "target", { foo: "bar" }, "t1");
    await db.waitForFlush();

    const report = await cmd.verify();
    assertEquals(report.ok, true, "an unhashed legacy prefix must not fail verification");
    assert(report.unhashed_prefix > 0, "the report counts the unverifiable prefix");
  } finally {
    await cleanup();
  }
});
