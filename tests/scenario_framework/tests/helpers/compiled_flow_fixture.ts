/**
 * @module CompiledFlowFixture
 * @path tests/scenario_framework/tests/helpers/compiled_flow_fixture.ts
 * @description Selects edition binaries and starts compiled daemons for flow scenario tests.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/tests/helpers/advanced_flow_case.ts]
 */
import { assert } from "@std/assert";
import { join } from "@std/path";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname;
const READY_TIMEOUT_SECONDS = "30";

export async function resolveFlowBinaries(edition: string): Promise<{ cli: string; daemon: string }> {
  if (edition !== "solo" && edition !== "team") throw new Error("Unsupported flow fixture edition");
  const binDir = join(REPO_ROOT, "dist", "bin");
  const binaries = {
    cli: join(binDir, `exactl-${edition}-${Deno.build.target}`),
    daemon: join(binDir, `${edition === "team" ? "exaix-team" : "exaix"}-${Deno.build.target}`),
  };
  for (const path of Object.values(binaries)) {
    assert((await Deno.stat(path)).isFile, `Required binary missing: ${path}`);
  }
  return binaries;
}

export async function startCompiledFlowDaemon(
  workspaceRoot: string,
  binaries: { cli: string; daemon: string },
): Promise<number> {
  const launched = await new Deno.Command("bash", {
    args: [
      "-c",
      'nohup "$1" > "$2" 2>&1 < /dev/null & echo $!',
      "--",
      binaries.daemon,
      join(workspaceRoot, ".exa", "daemon.log"),
    ],
    cwd: workspaceRoot,
  }).output();
  const pid = new TextDecoder().decode(launched.stdout).trim();
  if (!launched.success || !/^[0-9]+$/.test(pid)) throw new Error("Compiled daemon launch failed");
  await Deno.writeTextFile(join(workspaceRoot, ".exa", "daemon.pid"), pid);
  const ready = await new Deno.Command(binaries.cli, {
    args: ["journal", "wait", "--event", "daemon.ready", "--timeout", READY_TIMEOUT_SECONDS],
    cwd: workspaceRoot,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return ready.code;
}
