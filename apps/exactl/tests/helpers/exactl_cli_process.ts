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

/** Runs `exactl <args>` against a temporary workspace that is removed afterwards. */
export async function runExactlInTempWorkspace(args: string[]): Promise<IExaCtlCliRun> {
  const root = await Deno.makeTempDir({ prefix: "exactl-cli-" });
  try {
    await runMigrationsIn(root);
    const configPath = join(root, "exa.config.toml");
    writeDaemonConfigWithMockAi(configPath, root);
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
      env: { EXA_CONFIG_PATH: configPath },
      stdout: "piped",
      stderr: "piped",
    }).output();
    return { stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr), code };
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}
