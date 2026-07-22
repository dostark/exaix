/**
 * @module CliTestHelpers
 * @path tests/integration/helpers/cli_test_helpers.ts
 * @description Shared helpers for CLI integration tests. Extracted from
 * cli_commands_test.ts and cli_wait_commands_scenario_test.ts to eliminate
 * duplication.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { withCliProcessMutex } from "../../helpers/cli_process_mutex.ts";

const skipInParallel = !!Deno.env.get("DENO_JOBS") && Deno.env.get("EXA_TEST_FORCE_CLI_PARALLEL") !== "1";

/** Wrapper that skips the test when running in parallel CI mode to avoid port conflicts. */
export function cliTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, ignore: skipInParallel, fn });
}

/**
 * Run an exactl command in a given workspace directory.
 */
export async function runExactl(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const repoRoot = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
  const exactlPath = join(repoRoot, "apps", "exactl", "main.ts");

  console.log(`Running CLI command: exactl ${args.join(" ")} in ${cwd}`);

  const configPath = join(cwd, "exa.config.toml");
  const hasConfig = await Deno.stat(configPath).then(() => true).catch(() => false);
  if (!hasConfig) {
    await Deno.writeTextFile(configPath, `[system]\nroot = "${cwd}"\nversion = "1.0.0"\nlog_level = "info"\n`);
  }

  const parentEnv = Deno.env.toObject();
  const env: Record<string, string> = {
    PATH: parentEnv.PATH ?? "",
    HOME: parentEnv.HOME ?? "",
    TMPDIR: parentEnv.TMPDIR ?? "/tmp",
    TERM: parentEnv.TERM ?? "xterm",
  };
  env.EXA_CONFIG_PATH = configPath;
  env.EXA_LLM_PROVIDER = "mock";

  const { code, stdout, stderr } = await withCliProcessMutex(async () => {
    const command = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-all", exactlPath, ...args],
      cwd: cwd,
      stdout: "piped",
      stderr: "piped",
      env,
    });
    return await command.output();
  });

  const stdoutStr = new TextDecoder().decode(stdout);
  const stderrStr = new TextDecoder().decode(stderr);

  console.log(`CLI command exit code: ${code}`);
  console.log(`CLI stdout length: ${stdoutStr.length}`);
  console.log(`CLI stderr length: ${stderrStr.length}`);

  const effectiveStdout = stdoutStr.trim() ? stdoutStr : stderrStr;

  if (!stdoutStr.trim() && stderrStr.trim()) {
    console.warn(`CLI command produced no stdout; using stderr as stdout: ${args.join(" ")}`);
    console.warn(`stderr: ${stderrStr}`);
  }

  if (effectiveStdout.trim()) {
    console.log(`CLI stdout: ${effectiveStdout.substring(0, 500)}${effectiveStdout.length > 500 ? "..." : ""}`);
  }

  if (Deno.env.get("CI") || Deno.env.get("GITHUB_ACTIONS")) {
    const artifactsDir = join(cwd, "test-artifacts", "cli");
    await Deno.mkdir(artifactsDir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await Deno.writeTextFile(join(artifactsDir, `cli-${id}.stdout.txt`), stdoutStr);
    await Deno.writeTextFile(join(artifactsDir, `cli-${id}.stderr.txt`), stderrStr);
  }

  return { code, stdout: effectiveStdout, stderr: stderrStr };
}
