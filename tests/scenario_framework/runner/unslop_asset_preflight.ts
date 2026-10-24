/**
 * @module UnslopAssetPreflight
 * @path tests/scenario_framework/runner/unslop_asset_preflight.ts
 * @description Builds the verified portal lint asset set once per scenario selection that
 *   stages it, so a scenario run never depends on assets a previous run happened to leave.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [tests/scenario_framework/runner/main.ts, scripts/build_unslop_portal_bundle.ts]
 */

/** The root convenience task that packages and verifies the portal lint assets. */
export const UNSLOP_PACKAGING_TASK = "unslop-ts:bundle";

/** The part of a selected scenario entry this preflight reads. */
export interface IUnslopAssetSelection {
  readonly unslop_assets: boolean;
}

/** True when at least one selected scenario stages the packaged lint assets. */
export function needsUnslopAssets(entries: readonly IUnslopAssetSelection[]): boolean {
  return entries.some((entry) => entry.unslop_assets);
}

/** Runs the packaging task once for the whole selection.
 *  A non-zero exit is an explicit setup failure, never a silent fallback. */
export async function ensureUnslopAssets(
  entries: readonly IUnslopAssetSelection[],
  repoRoot: string,
): Promise<void> {
  if (!needsUnslopAssets(entries)) return;
  const status = await new Deno.Command("deno", {
    args: ["task", UNSLOP_PACKAGING_TASK],
    cwd: repoRoot,
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) {
    throw new Error(
      `packaged unslop assets are unavailable: deno task ${UNSLOP_PACKAGING_TASK} exited ` +
        `${status.code} in ${repoRoot}`,
    );
  }
}
