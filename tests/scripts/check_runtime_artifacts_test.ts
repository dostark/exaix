/**
 * @module CheckRuntimeArtifactsTest
 * @path tests/scripts/check_runtime_artifacts_test.ts
 * @description Unit tests for the runtime-artifact pre-commit gate (scripts/check_runtime_artifacts.ts).
 *   Covers both violation classes: a staged file literally living under a runtime-artifact
 *   path, and a runtime-artifact path embedded inside a staged patch/diff file's own
 *   `diff --git` headers (the exact shape of the Phase 144 venv-capture incident).
 * @architectural-layer Test
 * @related-files [scripts/check_runtime_artifacts.ts]
 */

import { assert, assertEquals } from "@std/assert";
import {
  findEmbeddedRuntimeArtifactPaths,
  findRuntimeArtifactViolations,
  isRuntimeArtifactPath,
} from "../../scripts/check_runtime_artifacts.ts";

// ── isRuntimeArtifactPath ──────────────────────────────────────────────────────

Deno.test("[isRuntimeArtifactPath] flags a file directly under venv/", () => {
  assert(isRuntimeArtifactPath("some/task/venv/bin/python"));
});

Deno.test("[isRuntimeArtifactPath] flags __pycache__ at any depth", () => {
  assert(isRuntimeArtifactPath("tests/fixtures/portal/__pycache__/mod.cpython-313.pyc"));
});

Deno.test("[isRuntimeArtifactPath] flags node_modules at any depth", () => {
  assert(isRuntimeArtifactPath("packages/foo/node_modules/left-pad/index.js"));
});

Deno.test("[isRuntimeArtifactPath] flags .DS_Store regardless of directory", () => {
  assert(isRuntimeArtifactPath("docs/.DS_Store"));
});

Deno.test("[isRuntimeArtifactPath] flags a bare .pyc file even outside __pycache__", () => {
  assert(isRuntimeArtifactPath("scripts/helper.pyc"));
});

Deno.test("[isRuntimeArtifactPath] does NOT flag a path that merely CONTAINS 'venv' as a substring", () => {
  assertEquals(isRuntimeArtifactPath("packages/prevented/src/myvenv.ts"), false);
});

Deno.test("[isRuntimeArtifactPath] does NOT flag ordinary source paths", () => {
  assertEquals(isRuntimeArtifactPath("scripts/check_runtime_artifacts.ts"), false);
  assertEquals(isRuntimeArtifactPath("packages/core/src/types/json.ts"), false);
});

// ── findEmbeddedRuntimeArtifactPaths ───────────────────────────────────────────

Deno.test("[findEmbeddedRuntimeArtifactPaths] finds a runtime-artifact path inside diff --git headers", () => {
  const patch = [
    "diff --git a/integrate.py b/integrate.py",
    "new file mode 100644",
    "+print('hi')",
    "diff --git a/venv/bin/python b/venv/bin/python",
    "new file mode 100644",
    "diff --git a/venv/lib/python3.12/site-packages/sympy/__init__.py b/venv/lib/python3.12/site-packages/sympy/__init__.py",
    "new file mode 100644",
  ].join("\n");
  const found = findEmbeddedRuntimeArtifactPaths(patch);
  assertEquals(found.sort(), [
    "venv/bin/python",
    "venv/lib/python3.12/site-packages/sympy/__init__.py",
  ]);
});

Deno.test("[findEmbeddedRuntimeArtifactPaths] returns empty for a patch with no runtime-artifact paths", () => {
  const patch = [
    "diff --git a/integrate.py b/integrate.py",
    "new file mode 100644",
    "+print('hi')",
    "diff --git a/output.txt b/output.txt",
    "new file mode 100644",
  ].join("\n");
  assertEquals(findEmbeddedRuntimeArtifactPaths(patch), []);
});

Deno.test("[findEmbeddedRuntimeArtifactPaths] dedupes repeated occurrences of the same path", () => {
  const patch = [
    "diff --git a/venv/bin/python b/venv/bin/python",
    "diff --git a/venv/bin/python b/venv/bin/python",
  ].join("\n");
  assertEquals(findEmbeddedRuntimeArtifactPaths(patch), ["venv/bin/python"]);
});

// ── findRuntimeArtifactViolations (integration of both classes) ────────────────

Deno.test("[findRuntimeArtifactViolations] flags a staged file literally under a runtime-artifact dir", () => {
  const violations = findRuntimeArtifactViolations([
    { path: "tests/fixtures/x/node_modules/left-pad/index.js", content: "module.exports = 1;" },
    { path: "scripts/real_source.ts", content: "export const x = 1;" },
  ]);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].kind, "staged-file");
  assertEquals(violations[0].stagedPath, "tests/fixtures/x/node_modules/left-pad/index.js");
});

Deno.test("[findRuntimeArtifactViolations] flags a reference.patch that embeds a captured venv (regression: Phase 144 multistep-definite-integral incident)", () => {
  const patchContent = [
    "diff --git a/integrate.py b/integrate.py",
    "new file mode 100644",
    "+import sympy",
    "diff --git a/venv/bin/python b/venv/bin/python",
    "new file mode 100644",
    "Binary files differ",
  ].join("\n");
  const violations = findRuntimeArtifactViolations([
    {
      path: "tests/scenario_framework/fixtures/external/terminal_bench/some-task/reference.patch",
      content: patchContent,
    },
  ]);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].kind, "embedded-in-diff");
  assertEquals(violations[0].artifactPath, "venv/bin/python");
});

Deno.test("[findRuntimeArtifactViolations] does not scan non-patch text files for diff --git-shaped content", () => {
  // A regular source file that happens to contain the literal string "diff --git" in a
  // comment/string must not be treated as a patch and scanned for embedded paths.
  const violations = findRuntimeArtifactViolations([
    { path: "scripts/some_tool.ts", content: '// example: "diff --git a/x b/x" is a patch header' },
  ]);
  assertEquals(violations, []);
});

Deno.test("[findRuntimeArtifactViolations] treats a file with no readable text content as path-only checkable", () => {
  const violations = findRuntimeArtifactViolations([
    { path: "assets/binary.bin" }, // content omitted, as for a real binary file
    { path: "some/venv/lib.so" }, // content omitted, but the PATH itself is the violation
  ]);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].stagedPath, "some/venv/lib.so");
});

Deno.test("[findRuntimeArtifactViolations] a fully clean staged set reports no violations", () => {
  const violations = findRuntimeArtifactViolations([
    { path: "scripts/check_runtime_artifacts.ts", content: "export const x = 1;" },
    { path: "tests/scripts/check_runtime_artifacts_test.ts", content: "Deno.test('x', () => {});" },
  ]);
  assertEquals(violations, []);
});
