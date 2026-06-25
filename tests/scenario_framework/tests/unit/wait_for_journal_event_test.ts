/**
 * @module ScenarioFrameworkWaitForJournalEventTest
 * @path tests/scenario_framework/tests/unit/wait_for_journal_event_test.ts
 * @description Phase 127 Step 8 (LIVE-RT) — RED-first tests for the `wait-for-journal-event`
 *   readiness barrier. After `daemon restart` the CLI returns as soon as the process is alive,
 *   NOT when its file-watchers are listening — so a request submitted immediately races the
 *   watcher and is missed. The scenario waits for the journalled `watcher.started` event (emitted
 *   only once a watch is active) before submitting. `journalHasEvent` is the pure poll predicate:
 *   true once an event of the given action_type exists in the workspace journal DB.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/step_executor.ts, apps/daemon/src/watcher.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { currentMaxRowid, journalHasEvent } from "../../runner/step_executor.ts";

/** Build a minimal journal DB with an `activity(action_type)` table and seed the given events. */
async function makeJournal(events: string[]): Promise<string> {
  const ws = await Deno.makeTempDir({ prefix: "wait-journal-" });
  const exaDir = join(ws, ".exa");
  await Deno.mkdir(exaDir, { recursive: true });
  const db = new Database(join(exaDir, "journal.db"));
  db.exec("CREATE TABLE activity (action_type TEXT)");
  for (const e of events) db.exec("INSERT INTO activity (action_type) VALUES (?)", e);
  db.close();
  return ws;
}

Deno.test("[wait_for_journal_event] journalHasEvent is true once the event type is present", async () => {
  const ws = await makeJournal(["daemon.starting", "watcher.started", "config.loaded"]);
  try {
    assertEquals(await journalHasEvent(ws, "watcher.started"), true);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[wait_for_journal_event] journalHasEvent is false when the event type is absent", async () => {
  const ws = await makeJournal(["daemon.starting", "config.loaded"]);
  try {
    assertEquals(await journalHasEvent(ws, "watcher.started"), false);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[wait_for_journal_event] journalHasEvent is false (not throwing) when the journal DB does not exist yet", async () => {
  const ws = await Deno.makeTempDir({ prefix: "wait-journal-none-" });
  try {
    // No .exa/journal.db — the daemon hasn't initialized; must be a clean false, not an error.
    assertEquals(await journalHasEvent(ws, "watcher.started"), false);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[wait_for_journal_event] journalHasEvent tolerates a journal with no activity table (fresh DB)", async () => {
  const ws = await Deno.makeTempDir({ prefix: "wait-journal-empty-" });
  const exaDir = join(ws, ".exa");
  await Deno.mkdir(exaDir, { recursive: true });
  const db = new Database(join(exaDir, "journal.db"));
  db.close();
  try {
    assert((await journalHasEvent(ws, "watcher.started")) === false);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

// --- since/baseline: ignore events older than a captured rowid (the stale-daemon.ready fix) ---

Deno.test("[wait_for_journal_event] currentMaxRowid returns the highest rowid (the baseline a wait captures)", async () => {
  const ws = await makeJournal(["a", "b", "c"]);
  try {
    assertEquals(await currentMaxRowid(ws), 3);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[wait_for_journal_event] currentMaxRowid is 0 for a missing/empty journal", async () => {
  const empty = await makeJournal([]);
  const none = await Deno.makeTempDir({ prefix: "wait-journal-none2-" });
  try {
    assertEquals(await currentMaxRowid(empty), 0);
    assertEquals(await currentMaxRowid(none), 0);
  } finally {
    await Deno.remove(empty, { recursive: true });
    await Deno.remove(none, { recursive: true });
  }
});

Deno.test("[wait_for_journal_event] with sinceRowid, a PRE-baseline event of the type is ignored (the stale daemon.ready)", async () => {
  // Simulate: daemon #1 emitted daemon.ready (rowid 1), then restart noise (2-3). The wait captures
  // baseline=3, so the OLD daemon.ready (rowid 1) must NOT satisfy it.
  const ws = await makeJournal(["daemon.ready", "daemon.stopping", "daemon.restarted"]);
  try {
    assertEquals(await journalHasEvent(ws, "daemon.ready", 3), false);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[wait_for_journal_event] with sinceRowid, a POST-baseline event of the type IS matched (daemon #2 ready)", async () => {
  const ws = await makeJournal(["daemon.ready", "daemon.restarted"]);
  try {
    // baseline = 2 (the restarted marker). Now daemon #2 emits its daemon.ready → rowid 3.
    const db = new Database(join(ws, ".exa", "journal.db"));
    db.exec("INSERT INTO activity (action_type) VALUES (?)", "daemon.ready");
    db.close();
    assertEquals(await journalHasEvent(ws, "daemon.ready", 2), true);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[wait_for_journal_event] sinceRowid=0 (or omitted) matches any event of the type (backward-compat)", async () => {
  const ws = await makeJournal(["daemon.ready"]);
  try {
    assertEquals(await journalHasEvent(ws, "daemon.ready", 0), true);
    assertEquals(await journalHasEvent(ws, "daemon.ready"), true);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});
