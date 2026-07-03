/**
 * @module DaemonWatcherReadinessTest
 * @path tests/integration/daemon_watcher_readiness_test.ts
 * @description Phase 127 Step 8 — RED-first integration tests for two daemon-startup bugs the
 *   live delegate matrix surfaced:
 *     Bug 1: the request/plan/config FileWatchers were constructed WITHOUT `db`, so their events
 *            (notably `watcher.started`) went console-only and never reached the journal DB — a
 *            consumer polling the journal for daemon readiness could never observe it.
 *     Bug 2: `daemon.started` was journalled BEFORE the watchers were started, so it was not a
 *            true "fully up" signal — a request submitted right after it could race the watcher.
 *   These boot the real daemon (apps/daemon/main.ts) and assert the journal shows `watcher.started`
 *   AND that `daemon.started` is journalled at or after it (readiness ordering).
 * @architectural-layer Test
 * @related-files [apps/daemon/main.ts, apps/daemon/src/watcher.ts]
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { daemonConfigSections } from "./helpers/daemon_config.ts";

// The daemon boots with EXA_TEST_MODE=1, so DatabaseService auto-ensures the `activity` table
// (mirroring a migrated production workspace) — no manual schema seeding needed here.

function writeDaemonConfig(configPath: string, root: string): void {
  const cfg = [
    ...daemonConfigSections(root, ""),
    "",
    "[ai]",
    'provider = "mock"',
    'model = "test"',
    "",
    "[ai.mock]",
    "timeout_ms = 30000",
    "",
  ].join("\n");
  Deno.writeTextFileSync(configPath, cfg);
}

/** Boot the real daemon, let it settle so its watchers come up, then SIGTERM it. */
async function bootDaemonOnce(configPath: string, settleMs: number): Promise<void> {
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", "apps/daemon/main.ts"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
    env: { EXA_CONFIG_PATH: configPath, EXA_TEST_MODE: "1" },
  }).spawn();
  try {
    await new Promise((r) => setTimeout(r, settleMs));
  } finally {
    try {
      Deno.kill(proc.pid, "SIGTERM");
    } catch { /* already dead */ }
    try {
      await proc.status;
    } catch { /* already finished */ }
  }
}

interface IOrderedEvent {
  seq: number;
  action_type: string;
}

/**
 * Read the daemon's journal in insertion order. The `id` column is a TEXT UUID, so order by
 * SQLite's implicit integer `rowid` (monotonic with insertion) — the timestamp column is
 * unreliable here (default datetime granularity collides for same-second boot events).
 */
async function readJournalOrdered(configPath: string): Promise<IOrderedEvent[]> {
  const configService = new ConfigService(configPath);
  const db = new DatabaseService(configService.getAll());
  try {
    return await db.preparedAll<IOrderedEvent>(
      "SELECT rowid AS seq, action_type FROM activity ORDER BY rowid ASC",
    );
  } catch {
    // No activity table yet (daemon never got far enough) — treat as no events so the test
    // fails on the missing-watcher.started assertion, not on a raw SQL error.
    return [];
  } finally {
    await db.close();
  }
}

Deno.test({
  name: "[daemon_readiness] watcher.started is persisted to the journal DB (Bug 1)",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "daemon-readiness-b1-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfig(configPath, tempDir);
    try {
      await bootDaemonOnce(configPath, 5000);
      const events = await readJournalOrdered(configPath);
      const types = events.map((e) => e.action_type);
      assert(
        types.includes("watcher.started"),
        `journal must contain watcher.started (Bug 1: watchers built without db). got: ${
          [...new Set(types)].join(", ")
        }`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name:
    "[daemon_readiness] the daemon emits daemon.ready (not daemon.started) AFTER watcher.started — a true readiness signal (Bug 2)",
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: "daemon-readiness-b2-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfig(configPath, tempDir);
    try {
      // bootDaemonOnce runs apps/daemon/main.ts directly (no CLI), so the journal here carries only
      // the daemon-process emissions — which must be daemon.ready, never the CLI's daemon.started.
      await bootDaemonOnce(configPath, 5000);
      const events = await readJournalOrdered(configPath);
      const firstWatcherStarted = events.find((e) => e.action_type === "watcher.started")?.seq;
      const daemonReadyRows = events.filter((e) => e.action_type === "daemon.ready").map((e) => e.seq);
      const lastDaemonReady = daemonReadyRows.length > 0 ? Math.max(...daemonReadyRows) : undefined;

      assert(firstWatcherStarted !== undefined, "watcher.started must be present (Bug 1 precondition)");
      assert(lastDaemonReady !== undefined, "daemon.ready must be present (the daemon's readiness signal)");
      assert(
        lastDaemonReady >= firstWatcherStarted,
        `daemon.ready (seq ${lastDaemonReady}) must be journalled at/after watcher.started ` +
          `(seq ${firstWatcherStarted}) so it signals a fully-up daemon (Bug 2)`,
      );
      // The daemon PROCESS must not emit daemon.started — that name belongs to the CLI's
      // process-alive signal. Two same-named events were the restart-race root cause.
      assert(
        !events.some((e) => e.action_type === "daemon.started"),
        "the daemon process must emit daemon.ready, never daemon.started (avoid the duplicate-event race)",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
  },
});
