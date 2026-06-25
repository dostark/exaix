/**
 * @module ScenarioFrameworkCellConfigSentinelTest
 * @path tests/scenario_framework/tests/unit/cell_config_sentinel_test.ts
 * @description Phase 127 Step 8 (LIVE-RT) — RED-first tests for dogfood-preset sentinel
 *   resolution. The matrix cells point at `configs/dogfood*.toml`, which carry the deploy-time
 *   sentinels `__DOGFOOD_ROOT__` (the daemon's system.root) and `__WORKTREE_PATH__` (the portal
 *   target). The synthetic runner self-boots the daemon with the cell preset as EXA_CONFIG_PATH,
 *   so the sentinels must be substituted to the runner's real workspace + portal BEFORE the
 *   daemon loads the config — otherwise `system.root` is the literal placeholder and the daemon
 *   roots away from where the runner submits requests. `resolveCellConfig` is the pure
 *   substitution (mirrors dogfood_bootstrap.ts) the runner uses to materialize the per-cell config.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, scripts/dogfood_bootstrap.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { resolveCellConfig } from "../../runner/matrix_expander.ts";

const PRESET = [
  "[system]",
  'root = "__DOGFOOD_ROOT__"',
  "",
  "[[portals]]",
  'alias = "exaix-self"',
  'target_path = "__WORKTREE_PATH__"',
  "",
  "[session_delegate]",
  'tool = "claude-code"',
].join("\n");

Deno.test("[cell_config] resolveCellConfig substitutes __DOGFOOD_ROOT__ with the workspace root", () => {
  const out = resolveCellConfig(PRESET, { workspaceRoot: "/ws/cell", worktreePath: "/repo" });
  assertStringIncludes(out, 'root = "/ws/cell"');
  assert(!out.includes("__DOGFOOD_ROOT__"), "the root sentinel must be fully replaced");
});

Deno.test("[cell_config] resolveCellConfig substitutes __WORKTREE_PATH__ with the portal/worktree path", () => {
  const out = resolveCellConfig(PRESET, { workspaceRoot: "/ws/cell", worktreePath: "/repo" });
  assertStringIncludes(out, 'target_path = "/repo"');
  assert(!out.includes("__WORKTREE_PATH__"), "the worktree sentinel must be fully replaced");
});

Deno.test("[cell_config] resolveCellConfig replaces every occurrence (replaceAll, not first-only)", () => {
  const doubled = PRESET + "\n" + 'fallback_root = "__DOGFOOD_ROOT__"';
  const out = resolveCellConfig(doubled, { workspaceRoot: "/ws", worktreePath: "/repo" });
  assert(!out.includes("__DOGFOOD_ROOT__"), "all root sentinels must be replaced");
});

Deno.test("[cell_config] resolveCellConfig leaves a sentinel-free preset unchanged", () => {
  const clean = '[system]\nroot = "/already/absolute"\n';
  assertEquals(resolveCellConfig(clean, { workspaceRoot: "/ws", worktreePath: "/repo" }), clean);
});
