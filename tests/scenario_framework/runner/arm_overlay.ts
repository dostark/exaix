/**
 * @module ScenarioFrameworkArmOverlay
 * @path tests/scenario_framework/runner/arm_overlay.ts
 * @description Catalog overlay path validation for Phase 158 Step 2's arm mechanism.
 * A `skill-version` or `agent-role-config` arm overlays a directory ahead of the shipped
 * catalog for the duration of one run; before that directory is ever prepended to a
 * search path, it must resolve through `PathResolver` — the same boundary every other
 * workspace-path-accepting code path in the repository uses — so an operator typo or a
 * malicious overlay path can never read or shadow content outside the workspace
 * (Pre-Gap Analysis GAP-7). Production code (`SkillsService`, `BlueprintResolver`)
 * trusts that any overlay directory it receives via env var was already validated here;
 * neither depends on `PathResolver` or `Config` directly, keeping the eval-only overlay
 * concern out of those packages' dependency footprint.
 * @architectural-layer Test
 * @related-files [packages/portal/src/path_resolver.ts, tests/scenario_framework/tests/unit/overlay_path_validation_test.ts]
 */

import type { PathResolver } from "@exaix/portal";

/** Resolves and validates a catalog overlay directory given as a portal alias path (e.g. `@Memory/Skills/eval-overlay`), via `PathResolver.resolve`'s path-traversal and symlink-escape checks. */
export async function validateCatalogOverlayDir(
  pathResolver: PathResolver,
  aliasPath: string,
): Promise<string> {
  return await pathResolver.resolve(aliasPath);
}
