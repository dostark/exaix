/**
 * @module DelegateIsolationTest
 * @path tests/scenario_framework/tests/unit/delegate_isolation_test.ts
 * @description Asserts the external_bench_task delegate launch is wrapped by buildJailLaunch
 *   (container args present: --cap-drop=ALL, --security-opt=no-new-privileges, bind-mount
 *   type), not a bare host-direct invocation — guarding against silent regression to
 *   host-direct execution (Phase 144 Step 2, Architecture Notes: the vendored
 *   reference.patch lives in the same task-contract tree as the delegate would otherwise see
 *   host-direct). A delegate step constructed WITHOUT the jail wrapper fails the assertion.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, tests/scenario_framework/runner/scenario_templates.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { buildJailLaunch } from "../../runner/matrix_expander.ts";
import { renderExternalBenchTaskTemplate } from "../../runner/scenario_templates.ts";
import { buildRunJailedLaunch, parseRunJailedArgs } from "../../scripts/run_jailed.ts";

function assertJailed(command: string, args: string[]): void {
  assertEquals(command, "docker", "delegate must run via docker, not host-direct");
  assertEquals(args[0], "run");
  assert(args.includes("--cap-drop=ALL"), "must drop all capabilities");
  assert(args.includes("--security-opt=no-new-privileges"), "must forbid privilege escalation");
  assert(args.some((a) => a.startsWith("type=bind")), "must bind-mount the task environment");
  assert(args.includes("--rm"), "must guarantee teardown on every exit path (docker run --rm)");
}

Deno.test("[DelegateIsolation] buildJailLaunch wraps an inner command in the hardened container launch", () => {
  const jailed = buildJailLaunch({ bin: "claude", args: ["-p"] }, { mountSource: "/some/portal", mountDest: "/app" });
  assertJailed(jailed.bin, jailed.args);
  assert(jailed.args.includes("claude"), "the inner delegate binary must be present as the container command");
});

Deno.test("[DelegateIsolation] buildJailLaunch uses an explicit credentialMountArgs override instead of live-resolving credentials", () => {
  const jailed = buildJailLaunch({ bin: "claude", args: ["-p"] }, {
    mountSource: "/some/portal",
    mountDest: "/app",
    credentialMountArgs: ["--mount", "type=bind,src=$FRAMEWORK_HOME/output/.eval-jail-creds/claude,dst=/tmp/.claude"],
  });
  assertJailed(jailed.bin, jailed.args);
  assert(
    jailed.args.includes("type=bind,src=$FRAMEWORK_HOME/output/.eval-jail-creds/claude,dst=/tmp/.claude"),
    "must use the override mount verbatim (a template-safe, run-time-expanded path) instead of a " +
      "generation-time-resolved disposable temp dir, which would go stale before the persisted scenario re-runs",
  );
});

Deno.test("[DelegateIsolation] external_bench_task template's rendered delegate step routes through run_jailed.ts, never a bare host-direct command", () => {
  const yaml = renderExternalBenchTaskTemplate({
    id: "delegate-isolation-fixture",
    title: "Delegate Isolation Fixture",
    requestFixture: "fixtures/requests/external/delegate-isolation-fixture.md",
    portalDir: "external/terminal_bench/delegate-isolation-fixture",
    oracleTestsDir: "delegate-isolation-fixture/oracle_tests",
    scopedTestCmd: "true",
    tool: "claude-code",
    benchmarkVersion: "d28711d0da2675d0bb1d56de45ae5df6082438a3",
  });
  assert(
    yaml.includes('command: "deno"'),
    "rendered delegate step must invoke the run_jailed.ts wrapper via deno, not a raw docker/CLI command",
  );
  assert(yaml.includes("run_jailed.ts"), "rendered delegate step must name the run_jailed.ts framework wrapper");
  assert(
    yaml.includes('"--bin", "claude"'),
    "the delegate tool must be passed as run_jailed.ts's --bin flag, never spawned directly",
  );
  assert(!yaml.includes('command: "claude"'), "the delegate command must never be the bare, unjailed claude binary");
  assert(
    !yaml.includes('command: "docker"'),
    "the docker invocation must happen inside run_jailed.ts at run time, never baked into the persisted scenario YAML",
  );
});

Deno.test("[DelegateIsolation] run_jailed.ts's own launch builder wraps the delegate exactly like buildJailLaunch — the property the rendered step relies on", async () => {
  const options = parseRunJailedArgs([
    "--mount-source",
    "/some/portal",
    "--mount-dest",
    "/app",
    "--workdir",
    "/app",
    "--bin",
    "claude",
    "--",
    "-p",
  ]);
  const jailed = await buildRunJailedLaunch(options);
  assertJailed(jailed.bin, jailed.args);
  assert(jailed.args.includes("claude"), "the inner delegate binary must be present as the container command");
});

Deno.test("[DelegateIsolation] a delegate step constructed WITHOUT the jail wrapper fails this assertion (regression guard)", () => {
  const unjailed = { command: "claude", args: ["-p", "solve the task"] };
  let threw = false;
  try {
    assertJailed(unjailed.command, unjailed.args);
  } catch {
    threw = true;
  }
  assert(threw, "an unjailed (host-direct) delegate step must fail assertJailed — proves the check is not vacuous");
});
