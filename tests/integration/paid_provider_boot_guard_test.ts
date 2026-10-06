/**
 * @module PaidProviderBootGuardTest
 * @path tests/integration/paid_provider_boot_guard_test.ts
 * @description A test/CI daemon whose boot provider is billable must fail closed.
 * Here the `[ai]`-only Google config would otherwise spend money.
 * EXA_TEST_ENABLE_PAID_LLM=1 opts in.
 * @architectural-layer Test
 * @dependencies [@exaix/testing]
 * @related-files [apps/daemon/main.ts, packages/ai/src/provider_factory.ts, packages/schemas/src/config.ts]
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { daemonConfigSections, migrateDaemonWorkspace } from "./helpers/daemon_config.ts";

const REPO_ROOT = join(import.meta.dirname!, "..", "..");

async function bootPaidDaemon(
  root: string,
  extraEnv: Record<string, string>,
): Promise<{ code: number; stderr: string }> {
  const configPath = join(root, "exa.config.toml");
  Deno.writeTextFileSync(
    configPath,
    [...daemonConfigSections(root, ""), "", "[ai]", 'provider = "google"', ""].join("\n"),
  );
  const result = await new Deno.Command("deno", {
    args: ["run", "--allow-all", "apps/daemon/main.ts"],
    cwd: REPO_ROOT,
    stdin: "null",
    stdout: "null",
    stderr: "piped",
    env: { EXA_CONFIG_PATH: configPath, EXA_TEST_MODE: "1", EXA_TEST_ENABLE_PAID_LLM: "", ...extraEnv },
  }).output();
  return { code: result.code, stderr: new TextDecoder().decode(result.stderr) };
}

Deno.test("[phase206.paid-boot-guard] an [ai]-only Google config fails closed in test mode", async () => {
  const root = await Deno.makeTempDir({ prefix: "paid-boot-guard-" });
  try {
    await migrateDaemonWorkspace(root);
    const { code, stderr } = await bootPaidDaemon(root, {});
    assertEquals(code, 1, `daemon must exit non-zero; stderr:\n${stderr}`);
    assert(
      stderr.includes("blocked in test/CI mode"),
      `stderr must name the paid-provider guard; got:\n${stderr}`,
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
