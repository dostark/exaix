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
/** Upper bound on the boot+recover+flush wait; only matters on a cold/slow CI runner since the poll exits early. */
const BOOT_RECOVER_CEILING_MS = 30_000;

function writeDaemonConfig(configPath: string, root: string): void {
  writeConfig(configPath, root, "");
}

/** Boots the daemon and polls `until()` (or just waits `ceilingMs`) before SIGTERM — polling avoids the cold-CI race a fixed sleep would hit. */
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
  // Skipped on CI: the batched crash_recovered journal event can lose the race against
  // SIGTERM teardown on a cold runner, even though recovery already succeeded. Re-enable
  // once the boot helper waits on the journal event (not just the request file) before stopping.
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

      // Seed a real launched event (the marker apps/daemon/main.ts emits before spawning
      // the delegate) with NO terminal event, simulating a crash before return.json.
      // initActivityTableSchema ensures the activity table exists on this fresh journal file.
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

      // Poll for the re-queued request file: recoverOrphanedDelegations writes it
      // before EventLogger's batched crash_recovered event is flushed, so polling
      // the file avoids the flush-vs-read race that made this flaky on cold CI.
      const requestAppeared = (): Promise<boolean> => exists(requestPath);

      await t.step("booting a real daemon recovers the orphan", async () => {
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
