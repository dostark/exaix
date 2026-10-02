/**
 * @module ScenarioRunnerSentinels
 * @path tests/scenario_framework/runner/sentinels.ts
 * @description The deploy-time and fixture sentinels the scenario runner substitutes into
 *   preset text, config text and catalog endpoints. They live in their own module so both
 *   `matrix_expander.ts` and `binding_layers.ts` can share them without an import cycle.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/matrix_expander.ts, tests/scenario_framework/runner/binding_layers.ts]
 */

/** Replaced with the run's dogfood workspace root. Mirrors `scripts/dogfood_bootstrap.ts`. */
export const SENTINEL_DOGFOOD_ROOT = "__DOGFOOD_ROOT__";

/** Replaced with the run's worktree path. Mirrors `scripts/dogfood_bootstrap.ts`. */
export const SENTINEL_WORKTREE_PATH = "__WORKTREE_PATH__";

/** Replaced with the loopback fixture's port, before any schema that validates a URL sees it. */
export const SENTINEL_COMPAT_FIXTURE_PORT = "__COMPAT_FIXTURE_PORT__";
