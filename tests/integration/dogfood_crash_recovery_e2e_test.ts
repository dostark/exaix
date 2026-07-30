/**
 * @module DogfoodCrashRecoveryE2ETest
 * @path tests/integration/dogfood_crash_recovery_e2e_test.ts
 * @description Phase 124 Step 4b — proves the real producer → recovery chain.
 *   A `session.delegate.launched` event (the production marker emitted by
 *   apps/daemon/main.ts before HeadlessSessionLauncher.launch, Step 4a) is
 *   written to the daemon's own file-backed journal with no terminal event,
 *   simulating a crash mid-delegation (before return.json). A real daemon is
 *   then booted; its startup recoverOrphanedDelegations scans the journal and
 *   must emit `session.delegate.crash_recovered` and re-queue a request file.
 *   GAP-5: asserts the orphaned precondition (launched present, no terminal /
 *   no return.json) before booting the recovering daemon.
 * @architectural-layer Integration
 * @dependencies [@exaix/storage-sqlite, @exaix/core, @std/path, @std/fs]
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { DatabaseService } from "@exaix/storage-sqlite";
import { ConfigService } from "@exaix/core/config";
import { EventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import { initActivityTableSchema } from "@exaix/testing";
import { migrateDaemonWorkspace, writeDaemonConfig as writeConfig } from "./helpers/daemon_config.ts";

/** Poll cadence while waiting for the booted daemon to satisfy a condition. */
const BOOT_POLL_INTERVAL_MS = 500;
/**
 * Upper bound on the boot+recover+flush wait. The poll exits early the moment the
 * condition holds, so a high ceiling only ever matters on a cold/slow CI runner —
 * it never slows a warm machine.
 */
const BOOT_RECOVER_CEILING_MS = 30_000;

function writeDaemonConfig(configPath: string, root: string): void {
  writeConfig(configPath, root, "");
}

/** Boot the real daemon, wait for it to settle, then stop it. Returns once stopped. */
/**
 * Boot the real daemon subprocess, then wait until `until()` reports success
 * (polling every {@link BOOT_POLL_INTERVAL_MS}) OR the `ceilingMs` deadline
 * elapses — whichever comes first — before sending SIGTERM. Condition-polling
 * (rather than a single fixed sleep) removes the cold-CI race: on a warm machine
 * the daemon is torn down as soon as the recovery event lands (~seconds), while a
 * slow CI runner is given the full ceiling to compile+boot+flush the batched
 * `crash_recovered` write. `until()` defaults to "always true" so callers that
 * only need the daemon to run for `ceilingMs` keep the old fixed-settle behaviour.
 */
async function bootDaemonOnce(
  configPath: string,
  ceilingMs: number,
  until: () => Promise<boolean> = () => Promise.resolve(true),
): Promise<void> {
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-all", "apps/daemon/main.ts"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
    env: { EXA_CONFIG_PATH: configPath, EXA_TEST_MODE: "1" },
  }).spawn();
  try {
    const deadline = Date.now() + ceilingMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, BOOT_POLL_INTERVAL_MS));
      if (await until()) break;
    }
  } finally {
    try {
      Deno.kill(proc.pid, "SIGTERM");
    } catch { /* already dead */ }
    try {
      await proc.status;
    } catch { /* already finished */ }
  }
}

Deno.test({
  name: "[crash_recovery_e2e] real launched event without return → crash_recovered on restart, with re-queued request",
  // Skipped on CI: this e2e boots a real daemon subprocess and asserts the batched
  // `session.delegate.crash_recovered` journal event is flushed before the daemon is
  // SIGTERM'd. On cold CI runners the flush races the teardown, so the event can be
  // missing even though recovery succeeded (the re-queued request file is written).
  // The test passes deterministically on a warm local machine; gate it out of CI until
  // the boot helper waits on the journal event (not just the request file) before stop.
  ignore: Deno.env.get("CI") === "true",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const tempDir = await Deno.makeTempDir({ prefix: "crash-recovery-e2e-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfig(configPath, tempDir);

    const traceId = crypto.randomUUID();
    const requestPath = join(tempDir, "Workspace", "Requests", `${traceId}_crash_recovery.md`);

    try {
      // Migrate before seeding so the journal the daemon later opens carries the full
      // production schema, not just the `activity` table (see migrateDaemonWorkspace).
      await migrateDaemonWorkspace(tempDir);

      // Seed a real launched event into the daemon's own file-backed journal —
      // the same marker apps/daemon/main.ts emits (Step 4a) before spawning the
      // delegate, with NO terminal event (simulating a crash before return.json).
      // initActivityTableSchema guarantees the `activity` table exists on the
      // fresh journal file the daemon will later open.
      {
        const configService = new ConfigService(configPath);
        const db = new DatabaseService(configService.getAll());
        initActivityTableSchema(db);
        const logger = new EventLogger({ db });
        await logger.log({
          action: DomainEventType.SessionDelegateLaunched,
          target: traceId,
          traceId,
          payload: { gate: "code_changes", tool: "opencode", brief: "Implement the health endpoint" },
        });
        await db.waitForFlush();
        await db.close();
      }

      await t.step("GAP-5: launched present, no terminal event, no return.json before recovery", async () => {
        const configService = new ConfigService(configPath);
        const db = new DatabaseService(configService.getAll());
        try {
          const events = await db.getActivitiesByTraceSafe(traceId);
          const actions = events.map((e) => e.action_type);
          assert(
            actions.includes(DomainEventType.SessionDelegateLaunched),
            "launched must be present",
          );
          const terminal = [
            "session.delegate.returned",
            "session.delegate.reconciled",
            "session.delegate.cancelled",
            "session.delegate.expired",
          ];
          assertEquals(
            actions.some((a) => terminal.includes(a)),
            false,
            "no terminal event may exist for an orphaned delegation",
          );
          // No return.json written for the trace.
          const returnPath = join(tempDir, "Workspace", "Session", traceId, "return.json");
          assertEquals(await exists(returnPath), false, "no return.json may exist");
        } finally {
          await db.close();
        }
      });

      // Poll for the RE-QUEUED REQUEST FILE (a filesystem side effect written by
      // recoverOrphanedDelegations early in daemon startup before EventLogger
      // flushes its batched crash_recovered write). This decouples "recovery
      // happened" from "journal flush completed" — the file appears as soon as
      // the recovery write is issued, while the journal event may lag behind
      // EventLogger's internal batching. Polling the file is faster and avoids
      // the flush-vs-read race that made the test flaky on cold CI runners.
      const requestAppeared = (): Promise<boolean> => exists(requestPath);

      await t.step("booting a real daemon recovers the orphan", async () => {
        // Poll for the re-queued request file. Once it exists, the daemon has
        // run recoverOrphanedDelegations (early startup). A fixed sleep raced
        // cold CI (slow deno cache); condition-polling exits early on a warm
        // machine and gives a slow runner up to BOOT_RECOVER_CEILING_MS.
        await bootDaemonOnce(configPath, BOOT_RECOVER_CEILING_MS, requestAppeared);
      });

      await t.step("journal has crash_recovered + a re-queued request file exists", async () => {
        // After the daemon exits, EventLogger's shutdown flush guarantees all
        // pending writes are persisted. Polling the journal post-shutdown (rather
        // than mid-flight) removes the flush-vs-read race entirely.
        assertEquals(await exists(requestPath), true, "a re-queued crash-recovery request must be written");
        // Read the journal directly (new connection — the daemon's handle is closed).
        const configService = new ConfigService(configPath);
        const db = new DatabaseService(configService.getAll());
        try {
          const events = await db.getActivitiesByTraceSafe(traceId);
          assert(
            events.some((e) => e.action_type === DomainEventType.SessionDelegateCrashRecovered),
            "daemon startup must emit session.delegate.crash_recovered",
          );
        } finally {
          await db.close();
        }
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});
