/**
 * @module OpenAiCompatibleRemotePermissionTest
 * @path tests/integration/openai_compatible_remote_permission_test.ts
 * @description Proves the real openai-chat/deepseek-chat presets fail safely, before any
 *   network attempt, when the daemon is not spawned with that host's network permission.
 *   The daemon eagerly creates its configured default provider at boot
 *   (apps/daemon/main.ts:ProviderFactory.createByName), so a missing net grant for these
 *   presets' default model crashes daemon startup with a typed, redacted fatal error rather
 *   than reaching request processing — the qualified endpoint pin (GAP-155-07) and the
 *   factory's permission pre-flight (GAP-155-23) hold under a real restricted boot, not only
 *   a stubbed unit test.
 * @architectural-layer Integration
 * @related-files [packages/ai-openai/src/compatible_factory.ts, apps/daemon/main.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { migrateDaemonWorkspace } from "./helpers/daemon_config.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");
const DOGFOOD_ROOT_SENTINEL = "__DOGFOOD_ROOT__";
const BOOT_TIMEOUT_MS = 15000;

const CASES = [
  { preset: "configs/openai-chat.toml", credentialEnv: "OPENAI_API_KEY", host: "api.openai.com" },
  { preset: "configs/deepseek-chat.toml", credentialEnv: "DEEPSEEK_API_KEY", host: "api.deepseek.com" },
] as const;

for (const { preset, credentialEnv, host } of CASES) {
  Deno.test({
    name: `[phase155] real ${preset} daemon refuses to boot without a net grant for ${host}`,
    ignore: Deno.env.get("CI") === "true",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const root = await Deno.makeTempDir({ prefix: "phase155-remote-permission-" });
      const configPath = join(root, "exa.config.toml");
      const fixtureKey = "unused-fixture-key-must-not-leak";
      try {
        const presetText = await Deno.readTextFile(join(REPO_ROOT, preset));
        await Deno.writeTextFile(configPath, presetText.replaceAll(DOGFOOD_ROOT_SENTINEL, root));
        await migrateDaemonWorkspace(root);

        const started = performance.now();
        const proc = new Deno.Command("deno", {
          // Omits the preset's required host: Deno denies the query before any connection.
          args: [
            "run",
            "--allow-read",
            "--allow-write",
            "--allow-env",
            "--allow-run",
            "--allow-sys",
            "--allow-ffi",
            "--allow-net=127.0.0.1",
            join(REPO_ROOT, "apps", "daemon", "main.ts"),
          ],
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
          env: { EXA_CONFIG_PATH: configPath, EXA_TEST_MODE: "1", [credentialEnv]: fixtureKey },
        }).spawn();

        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("daemon did not exit within the boot timeout")), BOOT_TIMEOUT_MS);
        });
        const status = await Promise.race([proc.status, timeout]);
        const elapsedMs = performance.now() - started;
        const stderrText = await new Response(proc.stderr).text();
        void new Response(proc.stdout).text().catch(() => "");

        assertEquals(status.success, false, stderrText);
        assert(stderrText.includes("net_permission_denied"), stderrText);
        assertEquals(stderrText.includes(fixtureKey), false, "the credential value must never reach a crash log");
        // A denied permission query fails fast, unlike a real network attempt.
        assert(elapsedMs < BOOT_TIMEOUT_MS, `boot took ${elapsedMs}ms — too slow for a permission-only failure`);
      } finally {
        await Deno.remove(root, { recursive: true }).catch(() => {});
      }
    },
  });
}
