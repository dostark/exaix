/**
 * @module MemoryExecutionResolutionTest
 * @path tests/config/memory_execution_resolution_test.ts
 * @description Phase 142 Step 18 (GAP-1) — `paths.memoryExecution` has one resolution rule.
 *
 *   Step 15 repointed the default from `"Execution"` (memory-relative) to `"Memory/Execution"`
 *   (root-relative). Production survived because five separate files each inlined the same
 *   disambiguation — `paths.memoryExecution.includes("/") ? … : join(paths.memory, …)` — with no
 *   shared helper and no test pinning either form. The change shipped uncovered and five
 *   amendment tests failed on `Memory/Memory/Execution`, surfaced by a full parallel run days
 *   later rather than by the step's own gates.
 *
 *   Both forms must stay supported: fixtures across the repository are split between them, so
 *   picking one and rejecting the other breaks existing workspaces. What must not stay is five
 *   copies of the rule — the sixth consumer that forgets it fails the same way.
 * @architectural-layer Test
 * @related-files [packages/core/src/config/paths.ts]
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { resolveMemoryExecutionRoot } from "@exaix/core/config";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
const PRODUCTION_ROOTS = ["apps", "packages"];
const NON_PRODUCTION_SEGMENTS = ["/tests/", "/test/", "/fixtures/", "/node_modules/"];

/** The inline disambiguation this step replaces, as a source pattern. */
const INLINE_SHIM = /memoryExecution\s*\.\s*includes\(\s*"\/"\s*\)/;

Deno.test("[path-resolution] both memoryExecution forms resolve to the same directory", () => {
  const rootRelative = resolveMemoryExecutionRoot({ memory: "Memory", memoryExecution: "Memory/Execution" });
  const memoryRelative = resolveMemoryExecutionRoot({ memory: "Memory", memoryExecution: "Execution" });

  assertEquals(rootRelative, "Memory/Execution");
  assertEquals(memoryRelative, join("Memory", "Execution"));
  assertEquals(rootRelative, memoryRelative);
});

Deno.test("[path-resolution] a non-default memory root is honoured by the memory-relative form", () => {
  // The composite form names its own parent, so a custom `paths.memory` cannot apply to it —
  // that asymmetry is the reason the rule exists and is worth pinning.
  assertEquals(
    resolveMemoryExecutionRoot({ memory: "Brain", memoryExecution: "Execution" }),
    join("Brain", "Execution"),
  );
  assertEquals(
    resolveMemoryExecutionRoot({ memory: "Brain", memoryExecution: "Memory/Execution" }),
    "Memory/Execution",
  );
});

Deno.test("[path-resolution] a nested composite form is left intact", () => {
  assertEquals(
    resolveMemoryExecutionRoot({ memory: "Memory", memoryExecution: "Memory/Runs/Execution" }),
    "Memory/Runs/Execution",
  );
});

Deno.test("[path-resolution] every production consumer resolves through the shared helper", async () => {
  const offenders: string[] = [];
  for (const root of PRODUCTION_ROOTS) {
    for await (const entry of walk(join(REPO_ROOT, root), { includeDirs: false, exts: [".ts"] })) {
      const posix = entry.path.replaceAll("\\", "/");
      if (NON_PRODUCTION_SEGMENTS.some((segment) => posix.includes(segment))) continue;
      if (posix.endsWith("_test.ts")) continue;
      if (posix.endsWith("packages/core/src/config/paths.ts")) continue; // the helper itself
      const source = await Deno.readTextFile(entry.path);
      if (INLINE_SHIM.test(source)) offenders.push(relative(REPO_ROOT, entry.path));
    }
  }
  assertEquals(
    offenders.sort(),
    [],
    "these files inline the memoryExecution disambiguation instead of calling " +
      `resolveMemoryExecutionRoot:\n  ${offenders.join("\n  ")}`,
  );
});
