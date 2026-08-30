/**
 * @module DogfoodLeastPrivilegeCutoverTest
 * @path tests/integration/dogfood_least_privilege_cutover_test.ts
 * @description Phase 124 Step 5 — terminal cutover. Boots a real daemon via
 *   scripts/dogfood_daemon.ts in an isolated temp root with
 *   allow_net=["api.anthropic.com"], asserts it boots under narrowed flags
 *   (--allow-net=api.anthropic.com + scoped perms, NOT --allow-all), then verifies
 *   dogfood:clean removes the temp root after stop. This is the proof that the
 *   least-privilege flag set actually boots a working daemon (over-narrowing would
 *   fail here, not in a unit test).
 * @architectural-layer Integration
 * @dependencies [@std/assert, @std/path, @std/fs]
 */

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { assertDaemonPidIsDead, readDaemonPid, writeDaemonConfig } from "./helpers/daemon_config.ts";

async function runScript(
  script: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "-A", script, ...args],
    env: { ...env, EXA_TEST_MODE: "1" },
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

/** A minimal dogfood config with an explicit allow_net allowlist. */
function writeConfig(configPath: string, root: string): void {
  writeDaemonConfig(configPath, root, 'allow_net = ["api.anthropic.com"]');
}

/** Poll cadence while waiting for the daemon status to report running. */
const STATUS_POLL_INTERVAL_MS = 500;
/** Upper bound on the wait for `status` to report running; returns as soon as healthy, so this only matters on a cold/slow CI runner (a fixed 2s sleep previously raced daemon boot there). */
const STATUS_READY_CEILING_MS = 30_000;

/** Polls `dogfood_daemon.ts status` until it exits 0 with "running" in stdout or the ceiling elapses; always returns the last result so the caller can assert on real output. */
async function waitForStatusRunning(
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const deadline = Date.now() + STATUS_READY_CEILING_MS;
  let last = await runScript("scripts/dogfood_daemon.ts", ["status"], env);
  while (Date.now() < deadline) {
    if (last.code === 0 && last.stdout.toLowerCase().includes("running")) return last;
    await new Promise((r) => setTimeout(r, STATUS_POLL_INTERVAL_MS));
    last = await runScript("scripts/dogfood_daemon.ts", ["status"], env);
  }
  return last;
}

Deno.test({
  name:
    "[daemon_least_privilege] real daemon boots under narrowed --allow-net + scoped flags, then dogfood:clean removes the temp root after stop",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const root = await Deno.makeTempDir({ prefix: "dogfood-cutover-" });
    await Deno.mkdir(join(root, ".exa"), { recursive: true });
    const configPath = join(root, "exa.config.toml");
    writeConfig(configPath, root);
    const env = { DOGFOOD_ROOT: root, EXA_CONFIG_PATH: configPath };

    try {
      try {
        await t.step("daemon starts under narrowed flags (opt-in proof)", async () => {
          const start = await runScript("scripts/dogfood_daemon.ts", ["start"], env);
          assertEquals(start.code, 0, start.stderr);
          // Opt-in proof: the spawn flags contain exactly the configured host…
          assertStringIncludes(start.stdout, "--allow-net=api.anthropic.com");
          // …and the scoped perms, never blanket --allow-all.
          assertStringIncludes(start.stdout, "--allow-write=");
          assertStringIncludes(start.stdout, "--allow-run=");
          assertEquals(start.stdout.includes("--allow-all"), false, "must not spawn with --allow-all");
        });

        await t.step("daemon is healthy (status reports running)", async () => {
          // Poll status until the daemon reports running rather than sleeping a
          // fixed 2s — on cold CI boot took longer than the fixed budget, so status
          // still reported not-running (code 1) and the step flaked.
          const status = await waitForStatusRunning(env);
          assertEquals(status.code, 0, status.stderr);
          assertStringIncludes(status.stdout.toLowerCase(), "running");
        });

        await t.step("stop the daemon", async () => {
          const stop = await runScript("scripts/dogfood_daemon.ts", ["stop"], env);
          assertEquals(stop.code, 0, stop.stderr);
        });

        await t.step("dogfood:clean removes the temp root after stop", async () => {
          const clean = await runScript("scripts/dogfood_clean.ts", ["--force"], env);
          assertEquals(clean.code, 0, clean.stderr);
          assertEquals(await exists(root), false, "dogfood:clean must remove the configured root");
        });
      } finally {
        // Guarantee the daemon is stopped even if an assertion above throws — otherwise a
        // failing assertion leaks the daemon process past the temp root removal below.
        // Idempotent: a no-op if `stop` already succeeded, or if `start` never ran.
        await runScript("scripts/dogfood_daemon.ts", ["stop"], env).catch(() => {});
      }
    } finally {
      if (await exists(root)) await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name: "[daemon_least_privilege] a failing assertion between start and stop still stops the daemon (leak guard)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.makeTempDir({ prefix: "dogfood-cutover-leak-guard-" });
    await Deno.mkdir(join(root, ".exa"), { recursive: true });
    const configPath = join(root, "exa.config.toml");
    writeConfig(configPath, root);
    const env = { DOGFOOD_ROOT: root, EXA_CONFIG_PATH: configPath };
    const pidPath = join(root, ".exa", "daemon.pid");

    try {
      const start = await runScript("scripts/dogfood_daemon.ts", ["start"], env);
      assertEquals(start.code, 0, start.stderr);

      const pid = await readDaemonPid(pidPath);

      // Reproduces the exact leak this regression guards: a failing assertion
      // between start and the scripted stop must not leave the daemon running.
      await assertRejects(
        async () => {
          try {
            assert(false, "simulated assertion failure between start and stop");
          } finally {
            await runScript("scripts/dogfood_daemon.ts", ["stop"], env).catch(() => {});
          }
        },
      );

      assertDaemonPidIsDead(pid);
    } finally {
      if (await exists(root)) await Deno.remove(root, { recursive: true });
    }
  },
});
