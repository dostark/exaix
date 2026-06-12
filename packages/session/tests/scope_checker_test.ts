/**
 * @module ScopeCheckerTest
 * @path packages/session/tests/scope_checker_test.ts
 * @description Phase 106 Step 4 — tests for session-delegation scope enforcement
 *   (GAP-3). Asserts both traversal-safety (stage 1: null byte, `..`, absolute,
 *   worktree-root escape) and glob scope-match (stage 2) mechanics.
 */

import { assertEquals } from "@std/assert";
import { checkScope } from "@exaix/session/scope_checker.ts";

const ROOT = "/workspace/worktrees/feat-trace-01";

Deno.test("[scope_checker] in-scope paths are accepted", () => {
  const result = checkScope(["src/main.ts", "src/utils/helpers.ts"], ["src/**"], ROOT);
  assertEquals(result.violations, []);
  assertEquals(result.accepted, ["src/main.ts", "src/utils/helpers.ts"]);
});

Deno.test("[scope_checker] path outside permitted glob is a violation", () => {
  const result = checkScope(["src/main.ts", "docs/design.md"], ["src/**"], ROOT);
  assertEquals(result.violations, ["docs/design.md"]);
  assertEquals(result.accepted, ["src/main.ts"]);
});

Deno.test("[scope_checker][security] path traversal via .. is a violation", () => {
  const result = checkScope(["../secrets/.env", "src/ok.ts"], ["src/**", "../**"], ROOT);
  assertEquals(result.violations.includes("../secrets/.env"), true, "traversal must be rejected");
});

Deno.test("[scope_checker][security] absolute path is always a violation", () => {
  const result = checkScope(["/etc/passwd"], ["/**"], ROOT);
  assertEquals(result.violations, ["/etc/passwd"]);
});

Deno.test("[scope_checker][security] null-byte path is a violation", () => {
  const result = checkScope(["src/\x00evil.ts"], ["src/**"], ROOT);
  assertEquals(result.violations.length >= 1, true);
});

Deno.test("[scope_checker] wildcard glob matches nested paths", () => {
  const result = checkScope(["packages/core/src/types/constants.ts"], ["packages/**"], ROOT);
  assertEquals(result.violations, []);
  assertEquals(result.accepted.length, 1);
});

Deno.test("[scope_checker] multiple permitted globs are honored", () => {
  const result = checkScope(["apps/daemon/main.ts", "tests/integration/smoke_test.ts"], ["apps/**", "tests/**"], ROOT);
  assertEquals(result.violations, []);
  assertEquals(result.accepted.length, 2);
});

Deno.test("[scope_checker] empty paths_touched returns no violations", () => {
  const result = checkScope([], ["src/**"], ROOT);
  assertEquals(result.violations, []);
  assertEquals(result.accepted, []);
});

Deno.test("[scope_checker] literal file-path glob matches", () => {
  const result = checkScope(["Workspace/Plans/req-01_plan.md"], ["Workspace/Plans/*.md"], ROOT);
  assertEquals(result.violations, []);
});
