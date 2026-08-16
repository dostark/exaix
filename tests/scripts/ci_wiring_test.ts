/**
 * @module CiWiringTest
 * @path tests/scripts/ci_wiring_test.ts
 * @description Asserts the unified CI pipeline (scripts/ci.ts) and the generated
 *   pre-commit hook (scripts/setup_hooks.ts) wire the two Phase 125 validity
 *   gates — check:skill-envelopes and check:manifests — so a malformed exaix:
 *   block or a manifest-less plan step fails CI (P125 GAP-14/15).
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [scripts/ci.ts, scripts/setup_hooks.ts]
 */

import { assert } from "@std/assert";

const CI_SOURCE = await Deno.readTextFile(new URL("../../scripts/ci.ts", import.meta.url));
const HOOKS_SOURCE = await Deno.readTextFile(new URL("../../scripts/setup_hooks.ts", import.meta.url));

Deno.test("[ci_wiring] scripts/ci.ts check action includes check:skill-envelopes", () => {
  assert(
    CI_SOURCE.includes('"check:skill-envelopes"'),
    "ci.ts must invoke check:skill-envelopes so a malformed exaix block fails CI (GAP-14)",
  );
});

Deno.test("[ci_wiring] scripts/ci.ts check action includes check:manifests", () => {
  assert(
    CI_SOURCE.includes('"check:manifests"'),
    "ci.ts must invoke check:manifests so a manifest-less step fails CI (GAP-14)",
  );
});

Deno.test("[ci_wiring] both gates are wired via the shared static-check task list", () => {
  // Phase 168 refactor: checkCommand and allCommand now both reference ONE shared
  // STATIC_CHECK_TASKS array (see [ci_wiring] gate-parity tests below) instead of each
  // duplicating its own inline list — so "wired in both arrays" is now a structural
  // guarantee (same array reference) rather than a coincidence of textual duplication.
  // This test still verifies its original Phase 125 GAP-14/15 intent: both gates are
  // declared in the shared list, and both commands are wired to that shared list.
  assert(
    CI_SOURCE.includes('{ cmd: ["deno", "task", "check:skill-envelopes"]'),
    "check:skill-envelopes must be declared in STATIC_CHECK_TASKS",
  );
  assert(
    CI_SOURCE.includes('{ cmd: ["deno", "task", "check:manifests"]'),
    "check:manifests must be declared in STATIC_CHECK_TASKS",
  );
  const checkUsesShared = /const checkCommand[\s\S]*?runParallel\(STATIC_CHECK_TASKS\)/.test(CI_SOURCE);
  const allUsesShared = /const allCommand[\s\S]*?runParallel\(STATIC_CHECK_TASKS\)/.test(CI_SOURCE);
  assert(checkUsesShared, "checkCommand must run STATIC_CHECK_TASKS, not a separate inline gate list");
  assert(allUsesShared, "allCommand must run STATIC_CHECK_TASKS, not a separate inline gate list");
});

Deno.test("[ci_wiring] pre-commit hook content invokes both gates", () => {
  assert(
    HOOKS_SOURCE.includes("deno task check:skill-envelopes"),
    "pre-commit hook must invoke check:skill-envelopes (GAP-14)",
  );
  assert(
    HOOKS_SOURCE.includes("deno task check:manifests"),
    "pre-commit hook must invoke check:manifests (GAP-14)",
  );
});

Deno.test("[ci_wiring] every deno task gate the pre-commit hook invokes is wired into scripts/ci.ts's check pipeline", () => {
  // Extract the PRE_COMMIT_CONTENT template body — the hook scripts/setup_hooks.ts actually installs.
  const preCommitMatch = HOOKS_SOURCE.match(/const PRE_COMMIT_CONTENT = `([\s\S]*?)`;\n\nconst PRE_PUSH_CONTENT/);
  assert(preCommitMatch, "could not locate PRE_COMMIT_CONTENT template in scripts/setup_hooks.ts");
  const preCommitBody = preCommitMatch![1];

  // Only count REAL gate invocations — a line that IS `deno task <name>` — not advice text inside
  // an echo "..." error message (e.g. "Run 'deno task fmt' to fix." or "...deno task check:md-path:fix...").
  const hookTasks = new Set<string>();
  for (const line of preCommitBody.split("\n")) {
    const m = line.trim().match(/^deno task ([\w:.-]+)/);
    if (m) hookTasks.add(m[1]);
  }
  assert(hookTasks.size > 20, `sanity check: expected >20 real gate tasks in the hook, found ${hookTasks.size}`);

  // scripts/ci.ts has no deno-task wrapper for the hook's staged-markdown-lint step (it shells out to
  // scripts/markdown_lint.ts directly against the staged file list, not a `deno task`) — excluded by design.
  const NO_CI_TS_TASK_WRAPPER = new Set<string>();

  const ciTasks = new Set<string>();
  for (const m of CI_SOURCE.matchAll(/"task",\s*"([\w:.-]+)"/g)) ciTasks.add(m[1]);

  const missing = [...hookTasks].filter((t) => !NO_CI_TS_TASK_WRAPPER.has(t) && !ciTasks.has(t)).sort();
  assert(
    missing.length === 0,
    `scripts/ci.ts is missing ${missing.length} gate(s) the real pre-commit hook enforces: ${missing.join(", ")}. ` +
      `Add each to STATIC_CHECK_TASKS in scripts/ci.ts so 'deno run -A scripts/ci.ts check'/'all' is a true ` +
      `superset of the pre-commit hook (else agents following .github/copilot-instructions.md's documented ` +
      `"run scripts/ci.ts all before completion" advice are silently surprised by the real hook — Phase 168 ` +
      `self-improvement-retro finding).`,
  );
});

Deno.test("[ci_wiring] checkCommand and allCommand's static-check phases share the same gate list", () => {
  const checkStart = CI_SOURCE.indexOf("const checkCommand");
  const checkEnd = CI_SOURCE.indexOf("const testCommand");
  const allStart = CI_SOURCE.indexOf("const allCommand");
  const allEnd = CI_SOURCE.indexOf("const fixCommand");
  assert(checkStart >= 0 && checkEnd > checkStart, "could not locate checkCommand body");
  assert(allStart >= 0 && allEnd > allStart, "could not locate allCommand body");

  const extract = (body: string) => {
    const found = new Set<string>();
    for (const m of body.matchAll(/"task",\s*"([\w:.-]+)"/g)) found.add(m[1]);
    return found;
  };
  const checkTasks = extract(CI_SOURCE.slice(checkStart, checkEnd));
  const allTasks = extract(CI_SOURCE.slice(allStart, allEnd));
  // allCommand's later Testing/Coverage/Build phases add more tasks (test:security, etc.) — fine.
  // This only asserts its static-check (Phase 1) gates are never a strict subset of checkCommand's.
  const onlyInCheck = [...checkTasks].filter((t) => !allTasks.has(t)).sort();
  assert(
    onlyInCheck.length === 0,
    `allCommand's static-check phase is missing gate(s) present in checkCommand: ${onlyInCheck.join(", ")} — ` +
      `the two command bodies must share one task list (STATIC_CHECK_TASKS) so they cannot silently drift apart.`,
  );
});
