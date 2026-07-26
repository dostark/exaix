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
import { currentMaxRowid, executeScenarioStep, journalHasEvent } from "../../runner/step_executor.ts";
import type { CriterionPhase as _CriterionPhase } from "../../schema/step_schema.ts";
import { ScenarioStepType } from "../../schema/step_schema.ts";

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

// --- where the baseline is captured (Phase 142 Step 17) ---
//
// A barrier step capturing its OWN baseline at the moment it starts cannot see an event the
// step before it already produced. `exactl daemon start` now blocks until `daemon.ready` is
// journalled, so by the time the following `wait-for-daemon-ready` step runs, the event it is
// waiting for is already below its self-captured baseline — and it waits out its full timeout
// for a second `daemon.ready` that will never come. 30 scenarios carry that barrier.
//
// The baseline must therefore come from BEFORE the producing step ran, which the runner
// already records per step. Stale-event protection is unaffected: a `daemon.ready` from a
// daemon that an earlier step killed still sits below that rowid.

function waitStep(id: string, eventType: string) {
  return {
    id,
    type: ScenarioStepType.WAIT_FOR_JOURNAL_EVENT,
    event_type: eventType,
    timeout_sec: 2,
    continue_on_failure: false,
    input_criteria: [],
    output_criteria: [],
  };
}

Deno.test("[wait_for_journal_event] an event the PRECEDING step produced satisfies the barrier", async () => {
  // rowid 1-2 are the preceding `daemon start` step's own output; the runner captured
  // baseline=0 before that step ran.
  const ws = await makeJournal(["daemon.starting", "daemon.ready"]);
  try {
    const result = await executeScenarioStep({
      step: waitStep("wait-for-daemon-ready", "daemon.ready"),
      cwd: ws,
      journalBaselineRowid: 0,
    });
    assertEquals(result.exitCode, 0, result.stderr);
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});

Deno.test("[wait_for_journal_event] a stale event from before the preceding step is still rejected", async () => {
  // daemon #1's ready (rowid 1) predates the restart step, whose baseline is 3.
  const ws = await makeJournal(["daemon.ready", "daemon.stopping", "daemon.stopped"]);
  try {
    const result = await executeScenarioStep({
      step: waitStep("wait-for-daemon-ready", "daemon.ready"),
      cwd: ws,
      journalBaselineRowid: 3,
    });
    assertEquals(result.exitCode, 1, "a pre-baseline event must not satisfy the barrier");
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
});
