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
import { dirname, isAbsolute, join } from "@std/path";
import type { IScenarioStep } from "../schema/step_schema.ts";
import type { Opt, Reason } from "@exaix/core/types";
import { deriveClaudeToolFlags } from "@exaix/session";

/** A single cell's expansion: either a runnable step list or a recorded skip. */
export interface IMatrixCellRun {
  cell: IMatrixCell;
  steps: IScenarioStep[];
  status: MatrixCellStatusValue;
  skipReason?: string;
}
/** Options for `buildJailLaunch`. `mountSource` is the only required field; other options
 *  default to a `/worktree` mount + workdir with no extra env beyond `HOME=/tmp`. */
export interface IJailLaunchOptions {
  /** Host path bind-mounted into the container (the only content the delegate can see). */
  mountSource: string;
  /** Mount destination inside the container. Defaults to `/worktree` (bare-cell convention). */
  mountDest?: Opt<string, Reason.SensibleDefault>;
  /** Container WORKDIR. Defaults to `/worktree` (bare-cell convention). */
  workdir?: Opt<string, Reason.SensibleDefault>;
  /** Extra `-e KEY=VALUE` env vars beyond the always-present `HOME=/tmp`. */
  extraEnv?: Opt<Record<string, string>, Reason.OptionalInput>;
  /** Extra raw `--mount <entry>` bind mounts beyond `mountSource` (e.g. the hidden oracle
   *  test directory for a verify-only step — never present during delegate editing). */
  extraMounts?: Opt<string[], Reason.OptionalInput>;
  /** Explicit `--mount` args used VERBATIM instead of live-resolving credentials. A caller
   *  that persists launch args into a static file (e.g. a scenario YAML) MUST supply this —
   *  a live-resolved mount points at a disposable temp dir that goes stale after the process exits.
   *  Use a companion setup step, never a `Deno.makeTempDirSync()` path. */
  credentialMountArgs?: Opt<string[], Reason.OptionalInput>;
}

export interface IExpandMatrixOptions {
  /** Environment snapshot used for key / opt-in presence checks. */
  env: Record<string, string | undefined>;
  /** Returns true when the named binary is resolvable on PATH. */
  binOnPath: (bin: string) => boolean;
  /** Repo root the cell `config` preset is resolved against. The daemon resolves a relative
   *  EXA_CONFIG_PATH against its own CWD (the workspace, not the repo), so when set, the
   *  overlay rewrites EXA_CONFIG_PATH to the preset resolved absolutely against this base. */
  configBaseDir?: Opt<string, Reason.OptionalInput>;
  /** Explicit cell selection by `tool` or `provider` (checked as OR). Needed because the
   *  runner only ever executes the FIRST cell with status "run" — without a selection, a
   *  multi-cell matrix silently runs whichever satisfied cell appears first. */
  selectedCell?: string;
}

/** Real targets the dogfood-preset sentinels resolve to for a matrix cell run. */
export interface ICellConfigTargets {
  /** Replaces `__DOGFOOD_ROOT__` — the daemon's `[system] root` (the runner's workspace/sandbox root). */
  workspaceRoot: string;
  /** Replaces `__WORKTREE_PATH__` — the mounted portal target (the repo in-repo, or a third-party repo in a deployed sandbox). */
  worktreePath: string;
}

/** A runnable group the runner consumes: either a matrix cell-run (with its `cell`) or
 *  the single pass-through group of a non-matrix scenario (`cell` undefined). */
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

/** Pure substitution of a dogfood preset's deploy-time sentinels with the run's real paths —
 *  without this, the daemon would literally root at "__DOGFOOD_ROOT__". A sentinel-free
 *  preset is returned unchanged. Mirrors `dogfood_bootstrap.ts`'s `replaceAll` mapping. */
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

/** The history tag a bare baseline cell's run carries. */
export const HARNESS_BARE_TAG = "harness:bare";

/** The tag-prefix an ablation cell's run carries: `ablate:<subsystem>`. */
export const ABLATE_TAG_PREFIX = "ablate:";

/** The tag an ablation cell's run carries for a given subsystem. */
export function ablateTag(subsystem: string): string {
  return `${ABLATE_TAG_PREFIX}${subsystem}`;
}

/** The step id of the bare scenario's direct-delegate launch step (scenario_templates.ts). */
export const BARE_DELEGATE_STEP_ID = "bare-delegate";

/** The args-element sentinel that expands to the request fixture's exact bytes as ONE discrete
 *  array element (never shell-interpolated). `expandVariablesInStep` leaves the unknown name
 *  verbatim; `expandFileContentSentinels` (synthetic_runner.ts) replaces it after env expansion. */
export const REQUEST_FIXTURE_CONTENT_SENTINEL = "$REQUEST_FIXTURE_CONTENT";

/** Inserts `REQUEST_FIXTURE_CONTENT_SENTINEL` into `args` immediately after a `-p` flag when
 *  present (claude's `-p` misparses a prompt trailing other flags), or appends it when absent
 *  (other tools take the objective as a trailing positional). Never mutates `args`. */
export function spliceRequestFixtureSentinel(args: readonly string[]): string[] {
  const spliced = [...args];
  const printIdx = spliced.indexOf("-p");
  if (printIdx >= 0) {
    spliced.splice(printIdx + 1, 0, REQUEST_FIXTURE_CONTENT_SENTINEL);
  } else {
    spliced.push(REQUEST_FIXTURE_CONTENT_SENTINEL);
  }
  return spliced;
}

/** Per-tool direct delegate launch shapes for bare cells: the executable and args head before
 *  the task-content element (appended by the bare overlay as its own discrete sentinel
 *  element). Unknown tools fail loudly at overlay time (authoring error). */
export const BARE_DELEGATE_LAUNCH_SHAPES: Record<string, { bin: string; args: string[] }> = {
  "opencode": {
    bin: "opencode",
    // Inside the eval-jail container the worktree is at /worktree (the runner mounts only the
    // task worktree there); the delegate's own path scoping (OPENCODE_CONFIG external_directory
    // deny) is defense-in-depth, not the primary boundary.
    args: ["run", "--format", "json", "--dir", "/worktree"],
  },
  "claude-code": {
    bin: "claude",
    // The bare claude-cell launch carries the same scoped tool flags as the daemon-run
    // delegate: --permission-mode acceptEdits and scoped --allowedTools (no wildcard Bash,
    // never --dangerously-skip-permissions) — claude has no path-deny config like opencode's.
    args: ["-p", "--output-format", "json", ...deriveClaudeToolFlags()],
  },
  "claude-haiku-4-5": {
    bin: "claude",
    // Same scoped bare-launch as claude-code, pinned to the weak haiku model so the Exaix-vs-
    // bare comparison on the harness-lift weak-model tier runs a matching delegate.
    args: ["-p", "--output-format", "json", "--model", "claude-haiku-4-5", ...deriveClaudeToolFlags()],
  },
  "opencode-go": {
    bin: "opencode",
    // Pins the eval-cells.toml catalog's opencode-go/deepseek-v4-flash cell. No hardcoded
    // --dir: this shape is reused by both the standard matrix path (/worktree) and the
    // Terminal-Bench template (/app) — opencode defaults to cwd, set by buildJailLaunch's --workdir.
    args: ["run", "--format", "json", "--model", "opencode-go/deepseek-v4-flash"],
  },
};

/** Env var that overrides the eval-jail image name (default `exaix-eval-jail`). */
const EXA_EVAL_JAIL_IMAGE_ENV = "EXA_EVAL_JAIL_IMAGE";
const DEFAULT_EXA_EVAL_JAIL_IMAGE = "exaix-eval-jail";

const DEFAULT_JAIL_MOUNT_DEST = "/worktree";

/** Per-binary host credential store. The staged root must be wide enough for the binary's own
 *  runtime writes beside its credentials — mounting only the exact file's parent lets Docker
 *  auto-create a root-owned, non-writable ancestor the binary then fails to `mkdir` under. */
export const CREDENTIAL_STORES: Record<
  string,
  { liveRelPath: string; stagedFileRelPath: string; stagedDirRelPath: string }
> = {
  "claude": {
    liveRelPath: ".claude/.credentials.json",
    stagedFileRelPath: ".credentials.json",
    stagedDirRelPath: ".claude",
  },
  "opencode": {
    // Mounted at the wider /tmp/.local (not /tmp/.local/share/opencode): opencode also writes
    // session/model-cache state under ~/.local/state/opencode; the narrower share/opencode
    // mount fails EACCES on `mkdir /tmp/.local/state`.
    liveRelPath: ".local/share/opencode/auth.json",
    stagedFileRelPath: "share/opencode/auth.json",
    stagedDirRelPath: ".local",
  },
};

/** Stage a disposable copy of `bin`'s host credential file and return the `--mount` args
 *  pointing the jail at it, or `[]` when there is no known store, `HOME` is unset, or the
 *  live file does not exist (e.g. CI). Never mounts the live host file itself. */
function resolveCredentialMounts(bin: string): string[] {
  const store = CREDENTIAL_STORES[bin];
  const hostHome = Deno.env.get("HOME");
  if (!store || !hostHome) return [];
  try {
    const liveCredsPath = `${hostHome}/${store.liveRelPath}`;
    const stagedDir = Deno.makeTempDirSync({ prefix: "eval-jail-creds-" });
    const stagedFile = `${stagedDir}/${store.stagedFileRelPath}`;
    Deno.mkdirSync(dirname(stagedFile), { recursive: true });
    Deno.copyFileSync(liveCredsPath, stagedFile);
    return ["--mount", `type=bind,src=${stagedDir},dst=/tmp/${store.stagedDirRelPath}`];
  } catch {
    return [];
  }
}
/** The eval-jail launch wrapper. Every jailed delegate runs inside a container that mounts
 *  ONLY `options.mountSource`, so the repo's solution fixtures are structurally absent from
 *  the delegate's filesystem; `--cap-drop=ALL` etc. harden the process, `extraEnv` is defense-in-depth. */
export function buildJailLaunch(
  inner: { bin: string; args: string[] },
  options: IJailLaunchOptions,
): { bin: string; args: string[] } {
  const image = Deno.env.get(EXA_EVAL_JAIL_IMAGE_ENV) ?? DEFAULT_EXA_EVAL_JAIL_IMAGE;
  const uid = Deno.uid();
  const gid = Deno.gid();
  const userArgs = uid !== null && gid !== null ? ["--user", `${uid}:${gid}`] : [];
  // A DISPOSABLE COPY of the credential file is staged and mounted read-write at a HOME-
  // relative destination (never the live file) — mounting the WHOLE staged directory, not a
  // single nested file, avoids Docker auto-creating a root-owned parent that blocks writes with EACCES.
  const credMounts = options.credentialMountArgs ?? resolveCredentialMounts(inner.bin);
  const mountDest = options.mountDest ?? DEFAULT_JAIL_MOUNT_DEST;
  const workdir = options.workdir ?? DEFAULT_JAIL_MOUNT_DEST;
  const extraEnvArgs = Object.entries(options.extraEnv ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const extraMountArgs = (options.extraMounts ?? []).flatMap((entry) => ["--mount", entry]);
  return {
    bin: "docker",
    args: [
      "run",
      "--rm",
      "--mount",
      `type=bind,src=${options.mountSource},dst=${mountDest}`,
      ...extraMountArgs,
      "--workdir",
      workdir,
      ...userArgs,
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "-e",
      "HOME=/tmp",
      ...extraEnvArgs,
      ...credMounts,
      image,
      inner.bin,
      ...inner.args,
    ],
  };
}
const NON_EMPTY = z.string().min(1);

/** One cell of the matrix: a (tool, provider) pair selected by a real config preset.
 *  `provider` is documentary only — there is no EXA_SESSION_DELEGATE_PROVIDER env var; the
 *  real provider realm is chosen by `config`'s [session_delegate.provider] block. */
export const MatrixCellSchema = z.object({
  tool: NON_EMPTY,
  provider: NON_EMPTY,
  config: NON_EMPTY,
  requires_bin: NON_EMPTY,
  requires_key: NON_EMPTY.optional(),
  requires_optin: NON_EMPTY.optional(),
  harness: z.enum(["bare"]).optional(),
  /** The ablation subsystem token (skills | quality-gate | portal-knowledge). When set, the
   *  cell runs the full loop with exactly that subsystem toggled off and records `cell_id:
   *  ablate-<subsystem>/<tool>/<provider>` + the `ablate:<subsystem>` tag. */
  ablate: NON_EMPTY.optional(),
}).strict();

export const MatrixSchema = z.object({
  axes: z.record(z.string(), z.array(z.string().min(1))).optional(),
  cells: z.array(MatrixCellSchema).min(1),
}).strict();

export type IMatrixCell = z.infer<typeof MatrixCellSchema>;
export type IMatrixBlock = z.infer<typeof MatrixSchema>;

/** Evaluate a cell's presence predicates: returns the first missing predicate's skip reason,
 *  or null when the cell can run (matches `options.selectedCell` by `tool` OR `provider`
 *  when set, binary on PATH, every `requires_key`/`requires_optin` satisfied). */
function cellSkipReason(cell: IMatrixCell, options: IExpandMatrixOptions): string | null {
  if (
    options.selectedCell !== undefined &&
    cell.tool !== options.selectedCell &&
    cell.provider !== options.selectedCell
  ) {
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

/** Overlay the per-cell delegate env onto the start-daemon step, leaving all other steps
 *  untouched (returns a fresh array, no mutation). A `harness: bare` cell never boots the
 *  daemon: its bare-delegate step is rewritten per tool instead (see `overlayBareDelegateStep`). */
function overlayCellEnv(
  steps: IScenarioStep[],
  cell: IMatrixCell,
  configBaseDir: Opt<string, Reason.OptionalInput>,
): IScenarioStep[] {
  if (cell.harness === "bare") {
    return overlayBareDelegateStep(steps, cell);
  }
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

/** Rewrite a bare cell's `bare-delegate` step with the tool's direct-launch shape (the
 *  template renders it with placeholder command/args). Fails loudly when the bare scenario
 *  lacks the delegate step or the tool has no launch shape (authoring errors). */
function overlayBareDelegateStep(steps: IScenarioStep[], cell: IMatrixCell): IScenarioStep[] {
  const shape = BARE_DELEGATE_LAUNCH_SHAPES[cell.tool];
  if (!shape) {
    throw new Error(
      `bare matrix cell (tool=${cell.tool}, provider=${cell.provider}) has no direct-launch shape ` +
        `(supported tools: ${Object.keys(BARE_DELEGATE_LAUNCH_SHAPES).join(", ")})`,
    );
  }
  const delegate = steps.find((step) => step.id === BARE_DELEGATE_STEP_ID);
  if (!delegate) {
    throw new Error(
      `bare matrix cell (tool=${cell.tool}, provider=${cell.provider}) has no '${BARE_DELEGATE_STEP_ID}' step to rewrite`,
    );
  }
  // Every bare delegate runs in the eval-jail container (worktree-only mount), so the repo's
  // solution fixtures are not in the delegate's filesystem.
  const jailed = buildJailLaunch(shape, {
    mountSource: "$WORKSPACE_ROOT/todo-app",
    extraEnv: { OPENCODE_CONFIG: "/worktree/opencode.jsonc" },
  });
  return steps.map((step) => {
    if (step.id !== BARE_DELEGATE_STEP_ID) return step;
    const args = spliceRequestFixtureSentinel(jailed.args);
    return {
      ...step,
      command: jailed.bin,
      args,
    };
  });
}

/** Drop steps scoped away from this cell via their `cells` field (a non-empty allowlist of
 *  `tool` values); a step with no `cells` field runs for every cell, unchanged. */
function filterStepsForCell(steps: IScenarioStep[], cell: IMatrixCell): IScenarioStep[] {
  return steps.filter((step) => !step.cells || step.cells.includes(cell.tool));
}

/** Expand a matrix block into one IMatrixCellRun per cell. Runnable cells drop any step
 *  scoped away from them (`filterStepsForCell`) then get the per-cell env overlay;
 *  absent-prerequisite cells are recorded `skip` with a reason and an unmodified step list. */
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
      steps: overlayCellEnv(filterStepsForCell(steps, cell), cell, options.configBaseDir),
      status: MatrixCellStatus.RUN,
    };
  });
}

/** Real PATH probe used as the default `binOnPath` in production runs: splits PATH and
 *  checks each directory for an executable entry. */
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

/** The binary `dockerProbeSkipReason` checks for. */
const DOCKER_BIN = "docker";

/** Pre-flight docker-availability predicate, mirroring `cellSkipReason`'s shape (null =
 *  runnable, string = skip reason). Checked BEFORE any `docker run` because `step_executor.ts`'s
 *  generic SHELL-step path has no missing-binary handling and would throw uncaught otherwise. */
export function dockerProbeSkipReason(
  binOnPath: Opt<(bin: string) => boolean, Reason.SensibleDefault> = binIsOnPath,
): string | null {
  return binOnPath(DOCKER_BIN) ? null : `binary '${DOCKER_BIN}' not on PATH`;
}

/** The runner integration seam: turns a loaded scenario into the runnable groups the runner
 *  executes. A scenario with a `matrix:` block is expanded via `expandMatrix()`; a matrix-less
 *  scenario yields a single pass-through group carrying its own steps unchanged. */
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
