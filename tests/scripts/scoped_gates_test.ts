/**
 * @module ScopedGatesTest
 * @path tests/scripts/scoped_gates_test.ts
 * @description Exercises the path rule and the gate list for changes that touch only Go-port tooling.
 * @architectural-layer Test
 */
import { assert, assertArrayIncludes, assertEquals, assertFalse } from "@std/assert";
import {
  GO_PORT_TOOLING_PATTERN,
  isGoPortToolingOnly,
  planChangedCheck,
  scopedGates,
} from "../../scripts/scoped_gates.ts";
import { PRE_COMMIT_CONTENT } from "../../scripts/setup_hooks.ts";

const GO_PORT_TESTS = ["tests/scripts/go_port_a_test.ts", "tests/scripts/go_port_b_test.ts"];
const WHOLE_TREE_TASKS = ["lint", "fmt:check", "check:complexity", "check:cycles:gate", "check:unused-files:fail"];

Deno.test("scoped-gates: Go-port tooling paths and the two gitlinks are tooling-only", () => {
  assert(isGoPortToolingOnly([
    "scripts/go_port/core_l1_reference.ts",
    "tests/scripts/go_port_core_l1_corpus_test.ts",
    "tests/scripts/go_layer_gates_test.ts",
    "tests/scripts/helpers/go_checkout_fixture.ts",
    "exaix-go",
    "exaix-dev-docs",
  ]));
});

Deno.test("scoped-gates: any other parent path keeps the whole-tree gates", () => {
  for (const other of ["packages/core/mod.ts", "tests/scripts/helpers/other.ts", "scripts/ci.ts", "apps/tui/main.ts"]) {
    assertFalse(isGoPortToolingOnly(["scripts/go_port/a.ts", other]), other);
  }
});

Deno.test("scoped-gates: an empty change is not tooling-only", () => {
  assertFalse(isGoPortToolingOnly([]));
});

Deno.test("scoped-gates: typescript files get file-scoped format, lint and type checks and no whole-tree task", () => {
  const files = ["scripts/go_port/a.ts", "tests/scripts/go_port_a_test.ts"];
  const gates = scopedGates(files, GO_PORT_TESTS);
  const commands = gates.map((gate) => gate.cmd.join(" "));
  assertArrayIncludes(commands, [`deno fmt --check ${files.join(" ")}`]);
  assertArrayIncludes(commands, [`deno lint --rules-include=explicit-module-boundary-types ${files.join(" ")}`]);
  assertArrayIncludes(commands, [`deno check ${files.join(" ")}`]);
  for (const task of WHOLE_TREE_TASKS) {
    assertFalse(commands.includes(`deno task ${task}`), task);
  }
});

Deno.test("scoped-gates: markdown files are linted and a change without typescript skips the typescript gates", () => {
  const commands = scopedGates(["exaix-go", "scripts/go_port/README.md"], GO_PORT_TESTS).map((gate) =>
    gate.cmd.join(" ")
  );
  assert(commands.some((command) => command.includes("markdown_lint.ts scripts/go_port/README.md")));
  assertFalse(commands.some((command) => command.startsWith("deno lint")));
  assertFalse(commands.some((command) => command.startsWith("deno fmt")));
});

Deno.test("scoped-gates: the Go-port tests run only when Go-port tooling changed", () => {
  const withTooling = scopedGates(["scripts/go_port/a.ts"], GO_PORT_TESTS).map((gate) => gate.cmd.join(" "));
  assertArrayIncludes(withTooling, [`deno test --allow-all ${GO_PORT_TESTS.join(" ")}`]);
  const gitlinkOnly = scopedGates(["exaix-go"], GO_PORT_TESTS).map((gate) => gate.cmd.join(" "));
  assertFalse(gitlinkOnly.some((command) => command.startsWith("deno test")));
});

Deno.test("scoped-gates: the pre-commit hook uses the same path rule and runs the same gates", () => {
  const hookLines = PRE_COMMIT_CONTENT.split("\n").map((line) => line.trim());
  const toolingLine = hookLines.find((line) => line.startsWith("TOOLING_PATHS="));
  assertEquals(toolingLine?.split("'")[3], GO_PORT_TOOLING_PATTERN);
  const lintLine = hookLines.find((line) => line.startsWith("deno lint"));
  assertEquals(lintLine, "deno lint --rules-include=explicit-module-boundary-types $STAGED_TS || exit 1");
  const tasks = scopedGates(["scripts/go_port/a.ts", "scripts/go_port/a.md"], GO_PORT_TESTS)
    .map((gate) => gate.cmd)
    .filter((cmd) => cmd[1] === "task")
    .map((cmd) => cmd[2]);
  assert(tasks.length > 0);
  for (const task of tasks) {
    assertEquals(hookLines.some((line) => line.startsWith(`deno task ${task}`)), true, task);
  }
  assertEquals(new Set(tasks).size, tasks.length);
});

Deno.test("scoped-gates: a changed-files check is scoped for tooling, full for other changes and empty for none", () => {
  const scoped = planChangedCheck(["scripts/go_port/a.ts"], GO_PORT_TESTS);
  assertEquals(scoped.kind, "scoped");
  assertEquals(planChangedCheck(["scripts/go_port/a.ts", "packages/core/mod.ts"], GO_PORT_TESTS).kind, "full");
  assertEquals(planChangedCheck([], GO_PORT_TESTS).kind, "empty");
});
