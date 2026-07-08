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
import { writeDaemonConfig as writeConfig } from "./helpers/daemon_config.ts";

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
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const tempDir = await Deno.makeTempDir({ prefix: "crash-recovery-e2e-" });
    const configPath = join(tempDir, "exa.config.toml");
    writeDaemonConfig(configPath, tempDir);

    const traceId = crypto.randomUUID();
    const requestPath = join(tempDir, "Workspace", "Requests", `${traceId}_crash_recovery.md`);

    try {
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

      // Read the journal for this trace and report whether the daemon has emitted
      // the crash_recovered event yet. Used both as the boot poll predicate and by
      // the final assertion, so "booted enough" means exactly "event is present".
      const hasRecoveredEvent = async (): Promise<boolean> => {
        const configService = new ConfigService(configPath);
        const db = new DatabaseService(configService.getAll());
        try {
          const events = await db.getActivitiesByTraceSafe(traceId);
          return events.some(
            (e) => e.action_type === DomainEventType.SessionDelegateCrashRecovered,
          );
        } finally {
          await db.close();
        }
      };

      await t.step("booting a real daemon recovers the orphan", async () => {
        // Poll the journal until the daemon has compiled apps/daemon/main.ts, run
        // recoverOrphanedDelegations (early in startup), written the re-queued
        // request file, AND flushed EventLogger's batched crash_recovered write —
        // then SIGTERM immediately. A fixed sleep raced cold CI (slow deno cache);
        // condition-polling exits early on a warm machine and gives a slow runner
        // up to BOOT_RECOVER_CEILING_MS instead of a fixed marginal budget.
        await bootDaemonOnce(configPath, BOOT_RECOVER_CEILING_MS, hasRecoveredEvent);
      });

      await t.step("journal has crash_recovered + a re-queued request file exists", async () => {
        assert(await hasRecoveredEvent(), "daemon startup must emit session.delegate.crash_recovered");
        assertEquals(await exists(requestPath), true, "a re-queued crash-recovery request must be written");
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});
