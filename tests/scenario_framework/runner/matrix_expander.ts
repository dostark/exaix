/**
 * @module ScenarioFrameworkMatrixExpander
 * @path tests/scenario_framework/runner/matrix_expander.ts
 * @description Phase 127 Step 2 — the additive scenario `matrix:` block and its expander.
 *   A matrix scenario declares a `tool × provider` cross-product of cells; `expandMatrix`
 *   turns it into one cell-run per cell. Each runnable cell overlays the per-cell env onto
 *   the start-daemon step: EXA_CONFIG_PATH ← the cell's config preset (the provider selector,
 *   GAP-2), EXA_SESSION_DELEGATE_TOOL ← the cell's tool, EXA_SESSION_DELEGATE_ENABLED=true.
 *   It NEVER sets EXA_SESSION_DELEGATE_PROVIDER — that env var does not exist; the provider
 *   realm is chosen by the loaded config's [session_delegate.provider] block. A cell whose
 *   binary / key / opt-in is absent is recorded skipped (not failed) so the matrix never
 *   produces a false red. A scenario without a `matrix:` block does not use this module.
 * @architectural-layer Test
 * @dependencies [zod, @std/path]
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/runner/step_executor.ts, apps/daemon/main.ts]
 */

import { z } from "zod";
import { isAbsolute, join } from "@std/path";
import type { IScenarioStep } from "../schema/step_schema.ts";
import type { Opt, Reason } from "@exaix/core/types";

/** A single cell's expansion: either a runnable step list or a recorded skip. */
export interface IMatrixCellRun {
  cell: IMatrixCell;
  steps: IScenarioStep[];
  status: MatrixCellStatusValue;
  skipReason?: string;
}

export interface IExpandMatrixOptions {
  /** Environment snapshot used for key / opt-in presence checks. */
  env: Record<string, string | undefined>;
  /** Returns true when the named binary is resolvable on PATH. */
  binOnPath: (bin: string) => boolean;
  /**
   * Repo root the cell `config` preset is resolved against. The daemon resolves a
   * relative EXA_CONFIG_PATH against its own CWD — which is the workspace, NOT the repo —
   * so a bare relative preset (e.g. `configs/dogfood.claude.toml`) would be looked up under
   * the workspace and not found. When set, the overlay rewrites EXA_CONFIG_PATH to the
   * preset resolved absolutely against this base. Omitted in pure-unit callers that only
   * assert the relative passthrough.
   */
  configBaseDir?: Opt<string, Reason.OptionalInput>;
  /**
   * Explicit cell selection by `tool` (e.g. `--cell claude-code`). The runner only ever
   * executes the FIRST cell with status "run" (synthetic_runner.ts), so a multi-cell matrix
   * without a selection always runs whichever prerequisite-satisfied cell appears first —
   * silently never running the others. When set, every cell whose `tool` does not match is
   * recorded skipped (with a reason naming the selection), so a caller can loop over cells
   * explicitly (one invocation per --cell) and still get an honest per-cell status for the
   * ones it didn't select, rather than an invisible omission.
   */
  selectedCell?: string;
}

/** Real targets the dogfood-preset sentinels resolve to for a matrix cell run. */
export interface ICellConfigTargets {
  /** Replaces `__DOGFOOD_ROOT__` — the daemon's `[system] root` (the runner's workspace/sandbox root). */
  workspaceRoot: string;
  /** Replaces `__WORKTREE_PATH__` — the mounted portal target (the repo in-repo, or a third-party repo in a deployed sandbox). */
  worktreePath: string;
}

/**
 * A runnable group the runner consumes: either a matrix cell-run (with its `cell`)
 * or the single pass-through group of a non-matrix scenario (`cell` undefined).
 */
export interface IRunnableStepGroup {
  steps: IScenarioStep[];
  status: MatrixCellStatusValue;
  cell?: IMatrixCell;
  skipReason?: string;
}

/** A loaded scenario as seen by the resolver — only the fields it needs. */
export interface IResolvableScenario {
  steps: IScenarioStep[];
  matrix?: IMatrixBlock;
}

/** The start-daemon step id the per-cell env overlay targets. */
export const MATRIX_START_DAEMON_STEP_ID = "start-daemon";

/** Deploy-time sentinels in the dogfood presets (mirrors scripts/dogfood_bootstrap.ts). */
const SENTINEL_DOGFOOD_ROOT = "__DOGFOOD_ROOT__";
const SENTINEL_WORKTREE_PATH = "__WORKTREE_PATH__";

/**
 * Pure substitution of a dogfood preset's deploy-time sentinels with the run's real paths,
 * so the synthetic runner can boot the daemon on the preset WITHOUT the literal placeholders
 * that would otherwise leave `[system] root` = "__DOGFOOD_ROOT__" (rooting the daemon away from
 * where the runner submits requests). Mirrors `dogfood_bootstrap.ts`'s `replaceAll` mapping.
 * A sentinel-free preset is returned unchanged. Topology-agnostic: the caller chooses the
 * targets (in-repo: portal = repo root; deployed sandbox: portal = the mounted third-party repo).
 */
export function resolveCellConfig(presetText: string, targets: ICellConfigTargets): string {
  return presetText
    .replaceAll(SENTINEL_DOGFOOD_ROOT, targets.workspaceRoot)
    .replaceAll(SENTINEL_WORKTREE_PATH, targets.worktreePath);
}

/** Per-cell expansion outcome. Named union (no magic string union). */
export const MatrixCellStatus = {
  RUN: "run",
  SKIP: "skip",
} as const;
export type MatrixCellStatusValue = typeof MatrixCellStatus[keyof typeof MatrixCellStatus];

const ENV_CONFIG_PATH = "EXA_CONFIG_PATH";
const ENV_DELEGATE_TOOL = "EXA_SESSION_DELEGATE_TOOL";
const ENV_DELEGATE_ENABLED = "EXA_SESSION_DELEGATE_ENABLED";

const NON_EMPTY = z.string().min(1);

/**
 * One cell of the matrix: a (tool, provider) pair selected by a real config preset.
 * `provider` is a documentary label; the actual provider realm is chosen by `config`'s
 * [session_delegate.provider] block (GAP-2 — there is no EXA_SESSION_DELEGATE_PROVIDER).
 */
export const MatrixCellSchema = z.object({
  tool: NON_EMPTY,
  provider: NON_EMPTY,
  config: NON_EMPTY,
  requires_bin: NON_EMPTY,
  requires_key: NON_EMPTY.optional(),
  requires_optin: NON_EMPTY.optional(),
}).strict();

export const MatrixSchema = z.object({
  axes: z.record(z.string(), z.array(z.string().min(1))).optional(),
  cells: z.array(MatrixCellSchema).min(1),
}).strict();

export type IMatrixCell = z.infer<typeof MatrixCellSchema>;
export type IMatrixBlock = z.infer<typeof MatrixSchema>;

/**
 * Evaluate a cell's presence predicates. Returns a skip reason (the first missing
 * predicate) or null when the cell can run. A cell runs only when ALL hold: it matches
 * `options.selectedCell` (when set), its binary is on PATH, every `requires_key` is set,
 * and `requires_optin` is set.
 */
function cellSkipReason(cell: IMatrixCell, options: IExpandMatrixOptions): string | null {
  if (options.selectedCell !== undefined && cell.tool !== options.selectedCell) {
    return `not the selected cell (--cell ${options.selectedCell})`;
  }
  if (!options.binOnPath(cell.requires_bin)) {
    return `binary '${cell.requires_bin}' not on PATH`;
  }
  if (cell.requires_optin && !options.env[cell.requires_optin]) {
    return `opt-in env '${cell.requires_optin}' is unset`;
  }
  if (cell.requires_key && !options.env[cell.requires_key]) {
    return `provider key '${cell.requires_key}' is unset`;
  }
  return null;
}

/**
 * Overlay the per-cell delegate env onto the start-daemon step, leaving all other
 * steps untouched. Returns a fresh step array (no mutation of the input).
 */
function overlayCellEnv(
  steps: IScenarioStep[],
  cell: IMatrixCell,
  configBaseDir: Opt<string, Reason.OptionalInput>,
): IScenarioStep[] {
  // The overlay targets exactly one step (start-daemon). If it is missing the cell would
  // boot with no delegate config and silently false-green — fail loudly on the authoring error.
  if (!steps.some((step) => step.id === MATRIX_START_DAEMON_STEP_ID)) {
    throw new Error(
      `matrix cell (tool=${cell.tool}, provider=${cell.provider}) has no '${MATRIX_START_DAEMON_STEP_ID}' step to overlay the per-cell env onto`,
    );
  }
  const configPath = configBaseDir && !isAbsolute(cell.config) ? join(configBaseDir, cell.config) : cell.config;
  return steps.map((step) => {
    if (step.id !== MATRIX_START_DAEMON_STEP_ID) return step;
    return {
      ...step,
      env: {
        ...(step.env ?? {}),
        [ENV_CONFIG_PATH]: configPath,
        [ENV_DELEGATE_TOOL]: cell.tool,
        [ENV_DELEGATE_ENABLED]: "true",
      },
    };
  });
}

/**
 * Expand a matrix block into one IMatrixCellRun per cell. Runnable cells carry the
 * per-cell env overlay on their start-daemon step; absent-prerequisite cells are
 * recorded `skip` with a reason and an unmodified step list.
 */
export function expandMatrix(
  steps: IScenarioStep[],
  matrix: IMatrixBlock,
  options: IExpandMatrixOptions,
): IMatrixCellRun[] {
  return matrix.cells.map((cell) => {
    const reason = cellSkipReason(cell, options);
    if (reason !== null) {
      return { cell, steps, status: MatrixCellStatus.SKIP, skipReason: reason };
    }
    return {
      cell,
      steps: overlayCellEnv(steps, cell, options.configBaseDir),
      status: MatrixCellStatus.RUN,
    };
  });
}

/**
 * Real PATH probe used as the default `binOnPath` in production runs. Splits PATH and
 * checks each directory for an executable entry. Pure of side effects beyond stat reads.
 */
export function binIsOnPath(bin: string, pathEnv: Opt<string, Reason.OptionalInput> = Deno.env.get("PATH")): boolean {
  if (!pathEnv) return false;
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    try {
      const stat = Deno.statSync(`${dir}/${bin}`);
      if (stat.isFile) return true;
    } catch {
      // not in this dir; keep scanning
    }
  }
  return false;
}

/**
 * The runner integration seam (Phase 127 Step 5): turn a loaded scenario into the
 * runnable groups the runner executes. A scenario with a `matrix:` block is expanded
 * via expandMatrix() — making it reachable from a real run (synthetic_runner.ts), not
 * just unit tests. A matrix-less scenario yields a single pass-through group carrying
 * its own steps unchanged (backward-compatible).
 */
export function resolveRunnableSteps(
  scenario: IResolvableScenario,
  options: IExpandMatrixOptions,
): IRunnableStepGroup[] {
  if (!scenario.matrix) {
    return [{ steps: scenario.steps, status: MatrixCellStatus.RUN }];
  }
  return expandMatrix(scenario.steps, scenario.matrix, options).map((run) => ({
    steps: run.steps,
    status: run.status,
    cell: run.cell,
    skipReason: run.skipReason,
  }));
}
