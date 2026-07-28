/**
 * @module ScenarioFrameworkSandboxLifecycle
 * @path tests/scenario_framework/runner/sandbox_lifecycle.ts
 * @description Phase 142 Step 16 — decides and performs the reclamation of a run's sandbox.
 *
 * `resolveRuntimeConfigForExecution` mints `<base>/exaix-sandboxes/<runId>` per invocation and
 * nothing removed it, so growth was unbounded and proportional to how often scenarios ran: 103
 * sandboxes / 407 MB on one development machine, and rising, since Step 13 began seeding
 * `Blueprints/`, `Memory/` and the git-backed portal fixtures into each one (`fixtures/` alone is
 * 2.5 MB of a 4.1 MB sandbox). On a CI runner the directory grows until the disk fills, and that
 * presents as an unrelated build error.
 *
 * The decision is a pure function separated from the removal for one reason: this is the most
 * destructive operation in the framework, and the policy — which is all subtlety — should be
 * testable without a filesystem.
 *
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/config.ts, tests/scenario_framework/runner/main.ts, scripts/prune_scenario_sandboxes.ts]
 */

import { join, relative, resolve } from "@std/path";

/**
 * Where the workspace came from.
 *
 * Tracked explicitly rather than inferred from the path: deciding by shape ("does it live under
 * the sandbox base?") deletes a real workspace the day someone points `--workspace` at a directory
 * there, and that is a data-loss bug with no undo.
 */
export enum WorkspaceProvenance {
  /** The runner created it for this invocation and owns its lifetime. */
  RUNNER_MINTED = "runner-minted",
  /** Supplied via `--workspace` or `workspace_path`; the caller's directory, never ours to remove. */
  OPERATOR_SUPPLIED = "operator-supplied",
}

/** What happened to the sandbox, and why — the reason is what an operator is told. */
export enum SandboxRetention {
  REMOVED = "removed",
  KEPT_OPERATOR_WORKSPACE = "kept-operator-workspace",
  KEPT_BY_FLAG = "kept-by-flag",
  KEPT_RUN_FAILED = "kept-run-failed",
}

export interface IPlanSandboxCleanupOptions {
  workspacePath: string;
  outputDir: string;
  provenance: WorkspaceProvenance;
  keepSandbox: boolean;
  runPassed: boolean;
}

export interface ISandboxCleanupPlan {
  retention: SandboxRetention;
  /** The sandbox this plan was computed for; `applySandboxCleanup` refuses any other target. */
  workspacePath: string;
  /**
   * Sandbox-relative entries that must survive removal.
   *
   * Evidence is preserved by EXCLUSION rather than relocation. The default `output_dir` is
   * `<sandbox>/output` (`config.ts:153`), the run manifest and every artefact are written there,
   * and eval-history entries reference those paths — moving them would leave the history pointing
   * at nothing. Excluding the directory keeps every reference valid and still reclaims
   * substantially all of the bytes, since the evidence is kilobytes against megabytes of seeded
   * catalogs and portal fixtures.
   */
  preserve: string[];
}

export interface ISandboxCleanupOutcome {
  removed: boolean;
  retention: SandboxRetention;
  /** The sandbox path — reported so an operator can find a retained run's journal and logs. */
  path: string;
}

/** Human-readable reason, for the line the runner prints. */
export function describeRetention(retention: SandboxRetention): string {
  switch (retention) {
    case SandboxRetention.KEPT_OPERATOR_WORKSPACE:
      return "operator-supplied workspace — never removed by the runner";
    case SandboxRetention.KEPT_BY_FLAG:
      return "--keep-sandbox";
    case SandboxRetention.KEPT_RUN_FAILED:
      return "run did not pass — journal and daemon log retained for diagnosis";
    case SandboxRetention.REMOVED:
      return "removed";
  }
}

/** True when `child` is inside `parent` (not equal to it). */
function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel.length > 0 && !rel.startsWith("..") && !resolve(child).startsWith("..");
}

/**
 * Decide what happens to the sandbox, in strict precedence order.
 *
 * Provenance outranks everything: an operator's own directory is not ours to remove for any
 * reason. Then the explicit flag, then the failure asymmetry — the cost of keeping a failed run's
 * state is disk, the cost of discarding it is an undiagnosable failure.
 */
export function planSandboxCleanup(options: IPlanSandboxCleanupOptions): ISandboxCleanupPlan {
  const preserve = isInside(options.workspacePath, options.outputDir)
    ? [relative(resolve(options.workspacePath), resolve(options.outputDir))]
    : [];

  const retention = options.provenance === WorkspaceProvenance.OPERATOR_SUPPLIED
    ? SandboxRetention.KEPT_OPERATOR_WORKSPACE
    : options.keepSandbox
    ? SandboxRetention.KEPT_BY_FLAG
    : !options.runPassed
    ? SandboxRetention.KEPT_RUN_FAILED
    : SandboxRetention.REMOVED;

  return { retention, workspacePath: resolve(options.workspacePath), preserve };
}

/**
 * Carry out the plan.
 *
 * Refuses a target the plan was not computed for. This is the framework's only recursive delete,
 * and a refactor that threads the wrong root should remove nothing rather than the wrong thing —
 * the mismatch is not recoverable once it has run.
 */
export async function applySandboxCleanup(
  plan: ISandboxCleanupPlan,
  workspacePath: string,
): Promise<ISandboxCleanupOutcome> {
  const target = resolve(workspacePath);
  if (target !== plan.workspacePath) {
    throw new Error(
      `refusing to clean "${target}": the plan was computed for "${plan.workspacePath}"`,
    );
  }

  if (plan.retention !== SandboxRetention.REMOVED) {
    return { removed: false, retention: plan.retention, path: target };
  }

  if (plan.preserve.length === 0) {
    await Deno.remove(target, { recursive: true }).catch(() => {});
    return { removed: true, retention: plan.retention, path: target };
  }

  // Remove every top-level entry except the preserved ones, leaving the evidence in place at the
  // path the manifest and any eval-history entry already refer to.
  const keep = new Set(plan.preserve);
  for await (const entry of Deno.readDir(target)) {
    if (keep.has(entry.name)) continue;
    await Deno.remove(join(target, entry.name), { recursive: true }).catch(() => {});
  }
  return { removed: true, retention: plan.retention, path: target };
}
