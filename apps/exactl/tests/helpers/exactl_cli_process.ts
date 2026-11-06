/**
 * @module ExaCtlCliProcess
 * @path apps/exactl/tests/helpers/exactl_cli_process.ts
 * @description Runs the real exactl binary entry point as a subprocess inside a fresh migrated workspace.
 * @architectural-layer Test
 * @dependencies [@std/path, tests/integration/helpers/daemon_config.ts, tests/integration/helpers/migrate_test_db.ts]
 * @related-files [apps/exactl/main.ts, apps/exactl/tests/exactl_rename_hint_cli_test.ts]
 */

import { join } from "@std/path";
import { writeDaemonConfigWithMockAi } from "../../../../tests/integration/helpers/daemon_config.ts";
import { runMigrationsIn } from "../../../../tests/integration/helpers/migrate_test_db.ts";

export interface IExaCtlCliRun {
  stdout: string;
  stderr: string;
  code: number;
}

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;
const TEST_ENV_PREFIX = "EXA_TEST";
const SOLO_EDITION = "solo";

/** The parent environment without the test-mode switches that other test files set in this process. */
function childEnv(configPath: string): Record<string, string> {
  const env = Deno.env.toObject();
  for (const key of Object.keys(env)) {
    if (key.startsWith(TEST_ENV_PREFIX)) delete env[key];
  }
  return { ...env, EXA_CONFIG_PATH: configPath, EXAIX_EDITION: SOLO_EDITION };
}

/** Runs each `exactl <args>` in order against one temporary workspace that `seed` fills first. */
export async function runExactlSeededWorkspace(
  seed: (root: string) => Promise<void> | void,
  argsList: string[][],
): Promise<IExaCtlCliRun[]> {
  const root = await Deno.makeTempDir({ prefix: "exactl-cli-" });
  try {
    await runMigrationsIn(root);
    const configPath = join(root, "exa.config.toml");
    writeDaemonConfigWithMockAi(configPath, root);
    await seed(root);
    const runs: IExaCtlCliRun[] = [];
    for (const args of argsList) {
      const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-all",
          "--config",
          join(REPO_ROOT, "deno.json"),
          join(REPO_ROOT, "apps/exactl/main.ts"),
          ...args,
        ],
        cwd: root,
        clearEnv: true,
        env: childEnv(configPath),
        stdout: "piped",
        stderr: "piped",
      }).output();
      runs.push({ stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr), code });
    }
    return runs;
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/** Runs each `exactl <args>` in order against one temporary workspace that is removed afterwards. */
export function runExactlSequenceInTempWorkspace(argsList: string[][]): Promise<IExaCtlCliRun[]> {
  return runExactlSeededWorkspace(() => {}, argsList);
}

/** Runs `exactl <args>` against a temporary workspace that is removed afterwards. */
export async function runExactlInTempWorkspace(args: string[]): Promise<IExaCtlCliRun> {
  const [run] = await runExactlSequenceInTempWorkspace([args]);
  return run;
}
