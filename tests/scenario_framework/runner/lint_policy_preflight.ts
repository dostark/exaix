/**
 * @module LintPolicyPreflight
 * @path tests/scenario_framework/runner/lint_policy_preflight.ts
 * @description Installs the portal lint policy once per scenario selection that stages it, so a
 *   scenario run never depends on a directory a previous run happened to leave.
 * @architectural-layer Test
 * @dependencies []
 * @related-files [tests/scenario_framework/runner/main.ts, packages/lint-policy/src/tools/install_portal_policy.ts]
 */

/** The root task that installs the portal lint policy. */
export const LINT_POLICY_TASK = "unslop-ts:policy";

/** The part of a selected scenario entry this preflight reads. */
export interface ILintPolicySelection {
  readonly lint_policy: boolean;
}

/** True when at least one selected scenario stages the lint policy. */
export function needsLintPolicy(entries: readonly ILintPolicySelection[]): boolean {
  return entries.some((entry) => entry.lint_policy);
}

/** Runs the installer task once for the whole selection.
 *  A non-zero exit is an explicit setup failure, never a silent fallback. */
export async function ensureLintPolicy(
  entries: readonly ILintPolicySelection[],
  repoRoot: string,
): Promise<void> {
  if (!needsLintPolicy(entries)) return;
  const status = await new Deno.Command("deno", {
    args: ["task", LINT_POLICY_TASK],
    cwd: repoRoot,
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) {
    throw new Error(
      `the lint policy is unavailable: deno task ${LINT_POLICY_TASK} exited ` +
        `${status.code} in ${repoRoot}`,
    );
  }
}
