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

function writeDaemonConfig(configPath: string, root: string): void {
  writeConfig(configPath, root);
}

/** Boot the real daemon, wait for it to settle, then stop it. Returns once stopped. */
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

      await t.step("booting a real daemon recovers the orphan", async () => {
        await bootDaemonOnce(configPath, 4000);
      });

      await t.step("journal has crash_recovered + a re-queued request file exists", async () => {
        const configService = new ConfigService(configPath);
        const db = new DatabaseService(configService.getAll());
        try {
          const events = await db.getActivitiesByTraceSafe(traceId);
          const hasRecovered = events.some(
            (e) => e.action_type === DomainEventType.SessionDelegateCrashRecovered,
          );
          assert(hasRecovered, "daemon startup must emit session.delegate.crash_recovered");
          assertEquals(await exists(requestPath), true, "a re-queued crash-recovery request must be written");
        } finally {
          await db.close();
        }
      });
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});
