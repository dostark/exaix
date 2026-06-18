/**
 * @module DogfoodDaemonTest
 * @path tests/integration/dogfood_daemon_test.ts
 * @description Integration test for the dogfood daemon lifecycle script
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";

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
  name: "dogfood daemon lifecycle: start → status → stop",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Start the daemon
    const startResult = await runScript(["start"]);
    assertEquals(startResult.code, 0, `start failed: ${startResult.stderr}`);

    // Verify PID file exists
    const pidPath = join(".dogfood", ".exa", "daemon.pid");
    let pidFile: Deno.FileInfo;
    try {
      pidFile = await Deno.stat(pidPath);
    } catch {
      throw new Error(`PID file not found at ${pidPath}. stdout: ${startResult.stdout}`);
    }
    assert(pidFile.isFile, "PID file should be a regular file");

    // Verify status reports running
    const statusResult = await runScript(["status"]);
    assertEquals(statusResult.code, 0, "status should exit 0 when running");
    assert(statusResult.stdout.includes("running"), `expected "running" in status output: ${statusResult.stdout}`);

    // Stop the daemon
    const stopResult = await runScript(["stop"]);
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
    const statusAfterResult = await runScript(["status"]);
    assertEquals(statusAfterResult.code, 1, "status should exit 1 when not running");
    assert(
      statusAfterResult.stdout.includes("not running"),
      `expected "not running" in status output: ${statusAfterResult.stdout}`,
    );
  },
});
