/**
 * @module DogfoodDaemonTest
 * @path tests/integration/dogfood_daemon_test.ts
 * @description Integration test for the dogfood daemon lifecycle script, operating
 * in an isolated temp directory via DOGFOOD_ROOT to avoid touching real .dogfood/.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { assertDaemonPidIsDead, readDaemonPid } from "./helpers/daemon_config.ts";

const DAEMON_SCRIPT = "scripts/dogfood_daemon.ts";

async function runScript(
  args: string[],
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "-A", DAEMON_SCRIPT, ...args],
    env: {
      ...env,
      EXA_TEST_MODE: "1",
    },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

Deno.test({
  name: "dogfood daemon lifecycle: start → status → stop (isolated temp dir)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const sandboxRoot = await Deno.makeTempDir({ prefix: "dogfood-daemon-test-" });
    const pidPath = join(sandboxRoot, ".exa", "daemon.pid");

    // Set DOGFOOD_ROOT to point at temp dir (prevents touching real .dogfood/)
    const env = { DOGFOOD_ROOT: sandboxRoot };

    try {
      // Start the daemon
      const startResult = await runScript(["start"], env);
      assertEquals(startResult.code, 0, `start failed: ${startResult.stderr}`);

      try {
        // Verify PID file exists in the temp sandbox
        let pidFile: Deno.FileInfo;
        try {
          pidFile = await Deno.stat(pidPath);
        } catch {
          throw new Error(
            `PID file not found at ${pidPath}. stdout: ${startResult.stdout}`,
          );
        }
        assert(pidFile.isFile, "PID file should be a regular file");

        // Verify status reports running
        const statusResult = await runScript(["status"], env);
        assertEquals(statusResult.code, 0, "status should exit 0 when running");
        assert(
          statusResult.stdout.includes("running"),
          `expected "running" in status output: ${statusResult.stdout}`,
        );

        // Stop the daemon
        const stopResult = await runScript(["stop"], env);
        assertEquals(stopResult.code, 0, `stop failed: ${stopResult.stderr}`);

        // Verify PID file is cleaned up
        try {
          await Deno.stat(pidPath);
          throw new Error("PID file should have been removed after stop");
        } catch (e) {
          if (e instanceof Deno.errors.NotFound) {
            // Expected — PID file removed
          } else {
            throw e;
          }
        }

        // Verify status reports not running
        const statusAfterResult = await runScript(["status"], env);
        assertEquals(statusAfterResult.code, 1, "status should exit 1 when not running");
        assert(
          statusAfterResult.stdout.includes("not running"),
          `expected "not running" in status output: ${statusAfterResult.stdout}`,
        );
      } finally {
        // Guarantee the daemon is stopped even if an assertion above throws before the
        // scripted stop runs — otherwise the process leaks past the temp sandbox removal
        // below. Idempotent: a no-op if `stop` already succeeded in the try block.
        await runScript(["stop"], env).catch(() => {});
      }
    } finally {
      // Clean up temp sandbox
      try {
        await Deno.remove(sandboxRoot, { recursive: true });
      } catch {
        // ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "dogfood daemon lifecycle: a failing assertion between start and stop still stops the daemon (leak guard)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const sandboxRoot = await Deno.makeTempDir({ prefix: "dogfood-daemon-leak-guard-" });
    const pidPath = join(sandboxRoot, ".exa", "daemon.pid");
    const env = { DOGFOOD_ROOT: sandboxRoot };

    try {
      const startResult = await runScript(["start"], env);
      assertEquals(startResult.code, 0, `start failed: ${startResult.stderr}`);

      const pid = await readDaemonPid(pidPath);

      // Reproduces the exact leak this regression guards: a failing assertion
      // between start and the scripted stop must not leave the daemon running.
      await assertRejects(
        async () => {
          try {
            assert(false, "simulated assertion failure between start and stop");
          } finally {
            await runScript(["stop"], env).catch(() => {});
          }
        },
      );

      assertDaemonPidIsDead(pid);
    } finally {
      try {
        await Deno.remove(sandboxRoot, { recursive: true });
      } catch {
        // ignore cleanup errors
      }
    }
  },
});
