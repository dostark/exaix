/**
 * @module ExaCtlRenameHintCliTest
 * @path apps/exactl/tests/exactl_rename_hint_cli_test.ts
 * @description Runs the real exactl binary with removed command paths and checks the rename hint and exit code.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, tests/integration/helpers/daemon_config.ts]
 * @related-files [apps/exactl/main.ts, apps/exactl/src/exactl_error_handler.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { writeDaemonConfigWithMockAi } from "../../../tests/integration/helpers/daemon_config.ts";
import { runMigrationsIn } from "../../../tests/integration/helpers/migrate_test_db.ts";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const USAGE_EXIT_CODE = 2;

interface ICliRun {
  stderr: string;
  code: number;
}

async function runExactl(args: string[]): Promise<ICliRun> {
  const root = await Deno.makeTempDir({ prefix: "exactl-rename-hint-" });
  try {
    await runMigrationsIn(root);
    const configPath = join(root, "exa.config.toml");
    writeDaemonConfigWithMockAi(configPath, root);
    const { code, stderr } = await new Deno.Command(Deno.execPath(), {
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
      stdout: "null",
      stderr: "piped",
    }).output();
    return { stderr: new TextDecoder().decode(stderr), code };
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("running `exactl blueprint ls` prints the hint on stderr and exits 2", async () => {
  const run = await runExactl(["blueprint", "ls"]);
  assertEquals(run.code, USAGE_EXIT_CODE);
  assertStringIncludes(run.stderr, "use 'exactl blueprint list'");
});

Deno.test("a removed nested path prints the replacement and exits 2", async () => {
  const run = await runExactl(["blueprint", "agent-role", "list"]);
  assertEquals(run.code, USAGE_EXIT_CODE);
  assertStringIncludes(run.stderr, "use 'exactl blueprint list'");
});

Deno.test("a removed path followed by an unknown option still prints the hint", async () => {
  const run = await runExactl(["blueprint", "rm", "some-agent", "--bogus"]);
  assertEquals(run.code, USAGE_EXIT_CODE);
  assertStringIncludes(run.stderr, "use 'exactl blueprint remove some-agent'");
});
