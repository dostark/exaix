/**
 * @module DaemonDependencyGraphTest
 * @path apps/daemon/tests/daemon_dependency_graph_test.ts
 * @description Proves the daemon entry graph reaches no unslop-ts engine module and no lint-policy module.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [apps/daemon/main.ts, packages/execution/src/deno_lint_check.ts]
 */

import { assertEquals } from "@std/assert";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

Deno.test("daemon-graph-has-no-engine: the daemon entry reaches no engine or lint-policy module", async () => {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", "apps/daemon/main.ts"],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr).slice(-2_000));
  const graph = JSON.parse(new TextDecoder().decode(result.stdout)) as {
    modules?: { specifier: string }[];
  };
  const offenders = (graph.modules ?? [])
    .map((module) => module.specifier)
    .filter((specifier) => specifier.includes("/unslop-ts/") || specifier.includes("/packages/lint-policy/"));
  assertEquals(offenders, []);
});
