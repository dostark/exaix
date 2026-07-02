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

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { writeDaemonConfig } from "./helpers/daemon_config.ts";

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
        // Give the daemon a moment to come up.
        await new Promise((r) => setTimeout(r, 2000));
        const status = await runScript("scripts/dogfood_daemon.ts", ["status"], env);
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
      if (await exists(root)) await Deno.remove(root, { recursive: true });
    }
  },
});
