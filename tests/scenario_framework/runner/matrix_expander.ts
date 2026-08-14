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
/**
 * Options for `buildJailLaunch`. `mountSource` is the only required field — every other
 * option defaults to the exact shape Phase 143's bare-cell path has always used
 * (`/worktree` mount + workdir, no extra env beyond `HOME=/tmp`), so existing callers are
 * unaffected by this Phase 144 Step 2 generalization.
 */
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
  /** Explicit `--mount` args used VERBATIM instead of live-resolving credentials via
   *  `resolveCredentialMounts`. A caller that persists the launch args into a static file
   *  (e.g. `renderExternalBenchTaskTemplate` writing a scenario YAML) MUST supply this — a
   *  live-resolved credential mount points at a disposable temp dir that only exists for the
   *  process lifetime of the call that created it, going stale before the persisted file's
   *  next run (discovered via a real batch-ingest run, Phase 144 Step 5). Use a
   *  `$FRAMEWORK_HOME`-relative path (expanded fresh at each scenario run) refreshed by a
   *  companion setup step, never a `Deno.makeTempDirSync()` path. */
  credentialMountArgs?: Opt<string[], Reason.OptionalInput>;
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
   * Explicit cell selection by `tool` (e.g. `--cell claude-code`) OR `provider` (e.g.
   * `--cell openai`) — checked as an OR, so a value matching either field selects the cell.
   * The provider fallback exists because every direct-API scenario cell in this framework
   * uses `tool: "exactl"` (the daemon CLI itself) with `provider` as the field that actually
   * varies (anthropic/openai/google/...) — once a scenario has more than one such cell,
   * `tool` alone can no longer disambiguate between them. The runner only ever executes the
   * FIRST cell with status "run" (synthetic_runner.ts), so a multi-cell matrix without a
   * selection always runs whichever prerequisite-satisfied cell appears first — silently
   * never running the others. When set, every cell matching neither field is recorded
   * skipped (with a reason naming the selection), so a caller can loop over cells explicitly
   * (one invocation per --cell) and still get an honest per-cell status for the ones it
   * didn't select, rather than an invisible omission.
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

/** The history tag a bare baseline cell's run carries (Phase 143 Step 1 cell taxonomy). */
export const HARNESS_BARE_TAG = "harness:bare";

/** The tag-prefix an ablation cell's run carries: `ablate:<subsystem>` (Phase 143 Step 2). */
export const ABLATE_TAG_PREFIX = "ablate:";

/** The tag an ablation cell's run carries for a given subsystem. */
export function ablateTag(subsystem: string): string {
  return `${ABLATE_TAG_PREFIX}${subsystem}`;
}

/** The step id of the bare scenario's direct-delegate launch step (scenario_templates.ts). */
export const BARE_DELEGATE_STEP_ID = "bare-delegate";

/**
 * The args-element sentinel that expands to the request fixture's exact bytes as ONE discrete
 * array element (never shell-interpolated — GAP-4). `expandVariablesInStep` leaves the unknown
 * `$REQUEST_FIXTURE_CONTENT` name verbatim (it is not an env var); `expandFileContentSentinels`
 * (synthetic_runner.ts) replaces it with the fixture file content after env expansion.
 */
export const REQUEST_FIXTURE_CONTENT_SENTINEL = "$REQUEST_FIXTURE_CONTENT";

/**
 * Inserts `REQUEST_FIXTURE_CONTENT_SENTINEL` into `args` immediately after a `-p` flag when
 * present, or appends it when absent (Phase 144 post-gap remediation, GAP-8 — the single
 * shared implementation both `overlayCellEnv` below and `renderExternalBenchTaskTemplate` in
 * `scenario_templates.ts` call, replacing what was duplicated inline logic). claude's `-p`
 * requires the prompt as the argument immediately after it — a prompt trailing other flags
 * (--allowedTools etc.) is mis-parsed as "no prompt". Other tools take the objective as a
 * trailing positional, so the sentinel stays last for them. Never mutates `args`.
 */
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

/**
 * Per-tool direct delegate launch shapes for bare cells (Phase 143 Step 1): the executable and
 * the args head before the task-content element. Shapes match the shipped headless delegate
 * surfaces (Dogfooding guide §6.1–6.2): `opencode run --format json --dir <worktree>` and
 * `claude -p --output-format json` (the step's cwd IS the worktree). The task content is
 * appended by the bare overlay as `REQUEST_FIXTURE_CONTENT_SENTINEL` — its own discrete element.
 * Unknown tools fail loudly at overlay time (authoring error), mirroring the start-daemon
 * requirement below.
 */
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
    // Phase 143 fix — the bare claude-cell launch carries the same scoped tool flags as the
    // daemon-run delegate (deriveClaudeToolFlags): --permission-mode acceptEdits and a scoped
    // --allowedTools (no wildcard Bash). Claude has no path-deny config (unlike opencode's
    // external_directory), so path confinement is the worktree boundary + this tool-surface
    // restriction; never --dangerously-skip-permissions.
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
    // Phase 144 Step 5 — pins the eval-cells.toml catalog's opencode-go/deepseek-v4-flash cell
    // for jailed bare-delegate live runs. No hardcoded --dir (unlike the plain "opencode" key,
    // pinned to the standard bare-cell /worktree mount): this shape is reused by BOTH the
    // standard matrix path (mounted at /worktree) and the Terminal-Bench external_bench_task
    // template (mounted at /app) — opencode defaults to its process cwd when --dir is omitted,
    // which buildJailLaunch's --workdir already sets correctly for either mount destination.
    args: ["run", "--format", "json", "--model", "opencode-go/deepseek-v4-flash"],
  },
};

/** Env var that overrides the eval-jail image name (default `exaix-eval-jail`). */
const EXA_EVAL_JAIL_IMAGE_ENV = "EXA_EVAL_JAIL_IMAGE";
const DEFAULT_EXA_EVAL_JAIL_IMAGE = "exaix-eval-jail";

const DEFAULT_JAIL_MOUNT_DEST = "/worktree";

/** Per-binary host credential store: `liveRelPath` (relative to `$HOME`) is the live credential
 *  file to copy; `stagedFileRelPath` is where that copy lands under the staged temp root;
 *  `stagedDirRelPath` (relative to `$HOME`, i.e. the jail's `/tmp`) is what the staged root
 *  mounts as inside the container. The staged root must be wide enough for the binary's own
 *  runtime writes (session/log/cache files it creates beside its credentials) — mounting only
 *  the exact credential file's parent lets Docker auto-create a root-owned, non-writable
 *  ancestor the binary then fails to `mkdir` under. Add an entry here when a new delegate
 *  binary needs jailed live-run credentials — `resolveCredentialMounts` handles the rest. */
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
    // session/model-cache state under ~/.local/state/opencode at runtime — discovered via a
    // real jailed run (Phase 144 Step 5) failing EACCES on `mkdir /tmp/.local/state` when only
    // the narrower share/opencode path was mounted.
    liveRelPath: ".local/share/opencode/auth.json",
    stagedFileRelPath: "share/opencode/auth.json",
    stagedDirRelPath: ".local",
  },
};

/**
 * Stage a disposable copy of `bin`'s host credential file and return the `--mount` args
 * pointing the jail at it (or `[]` when `bin` has no known credential store, `HOME` is unset,
 * or the live file does not exist — e.g. CI, no subscription/API login). Never mounts the
 * live host file itself. See `buildJailLaunch`'s docstring for the directory-vs-single-file
 * rationale.
 */
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
/**
 * Phase 143 — the eval-jail launch wrapper. Every jailed delegate runs inside a container that
 * mounts ONLY `options.mountSource` (bare cells: `$WORKSPACE_ROOT/todo-app` → `/worktree`): the
 * repo (and its `reference.patch` solutions) is absent from the delegate's filesystem, so
 * solution leakage is structurally impossible. `--user <host-uid>:<host-gid>` keeps the
 * bind-mounted directory (owned by the host user) writable; `--cap-drop=ALL` +
 * `--no-new-privileges` harden the process; `options.extraEnv` (e.g. bare cells'
 * `OPENCODE_CONFIG`) is defense-in-depth, never the primary boundary. Exported and
 * parametrized (Phase 144 Step 2) so `external_bench_task` reuses this exact hardened launch
 * shape instead of hand-rolling a second `docker run` invocation.
 */
export function buildJailLaunch(
  inner: { bin: string; args: string[] },
  options: IJailLaunchOptions,
): { bin: string; args: string[] } {
  const image = Deno.env.get(EXA_EVAL_JAIL_IMAGE_ENV) ?? DEFAULT_EXA_EVAL_JAIL_IMAGE;
  const uid = Deno.uid();
  const gid = Deno.gid();
  const userArgs = uid !== null && gid !== null ? ["--user", `${uid}:${gid}`] : [];
  // The container's delegate binary (HOME=/tmp) needs the host's real credentials — the
  // eval-jail credential passthrough. A DISPOSABLE COPY of the credential file is staged into
  // a fresh temp dir and bind-mounted (read-write) at a HOME-relative destination — never the
  // live host file. Mounting the live file alone (read-only) at a single nested path was the
  // original design, but Docker auto-creates the parent as a root-owned, non-writable
  // directory when only a single nested file is mounted, and both Claude Code's Bash tool
  // (needs to `mkdir .claude/session-env` beside its credentials) and opencode's own session/
  // log writes need the directory itself writable — blocking every call with EACCES (discovered
  // via a real headless run, Phase 144 Step 2). Mounting the WHOLE staged directory read-write
  // fixes this while still never exposing the real credentials file to in-container writes —
  // only a disposable copy is mounted, so even an in-container modification cannot corrupt the
  // host's real login. Tool-aware (Phase 144 Step 5): each delegate binary reads credentials
  // from its own store — Claude Code from `~/.claude/.credentials.json`, opencode (incl. the
  // opencode-go bare cell) from `~/.local/share/opencode/auth.json` — mounting the wrong
  // store is a silent no-op that leaves the delegate unauthenticated, not a loud failure.
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

/**
 * One cell of the matrix: a (tool, provider) pair selected by a real config preset.
 * `provider` is a documentary label; the actual provider realm is chosen by `config`'s
 * [session_delegate.provider] block (GAP-2 — there is no EXA_SESSION_DELEGATE_PROVIDER).
 * `harness: bare` (Phase 143 Step 1) marks a bare-delegate baseline cell: it skips the
 * daemon boot entirely (the delegate is launched directly), records `cell_id:
 * bare/<tool>/<provider>` + the `harness:bare` tag, and its cost/tokens come from the
 * delegate's stdout via `parseDelegateStdout` rather than the journal.
 */
export const MatrixCellSchema = z.object({
  tool: NON_EMPTY,
  provider: NON_EMPTY,
  config: NON_EMPTY,
  requires_bin: NON_EMPTY,
  requires_key: NON_EMPTY.optional(),
  requires_optin: NON_EMPTY.optional(),
  harness: z.enum(["bare"]).optional(),
  /** Phase 143 Step 2: the ablation subsystem token (skills | quality-gate | portal-knowledge).
   *  When set, the cell runs the full loop with exactly that subsystem toggled off and records
   *  `cell_id: ablate-<subsystem>/<tool>/<provider>` + the `ablate:<subsystem>` tag. */
  ablate: NON_EMPTY.optional(),
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
 * `options.selectedCell` by `tool` OR `provider` (when set), its binary is on PATH, every
 * `requires_key` is set, and `requires_optin` is set.
 */
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

/**
 * Overlay the per-cell delegate env onto the start-daemon step, leaving all other
 * steps untouched. Returns a fresh step array (no mutation of the input).
 *
 * A `harness: bare` cell (Phase 143 Step 1) never boots the daemon: instead the bare-delegate
 * step's executable and args are rewritten per tool (bin + args head from
 * `BARE_DELEGATE_LAUNCH_SHAPES`, task content appended as its own discrete
 * `REQUEST_FIXTURE_CONTENT_SENTINEL` element). The start-daemon requirement does not apply to
 * bare cells — they have no daemon step by template construction.
 */
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

/**
 * Rewrite a bare cell's `bare-delegate` step with the tool's direct-launch shape. The template
 * renders the step with placeholder command/args; the per-cell rewrite supplies the real
 * executable, args head, and the task-content sentinel element. Fails loudly when the bare
 * scenario lacks the delegate step (authoring error) or the tool has no launch shape.
 */
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
  // Phase 143 — every bare delegate runs in the eval-jail container (worktree-only mount), so
  // the repo's solution fixtures are not in the delegate's filesystem.
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

/** The binary `dockerProbeSkipReason` checks for. */
const DOCKER_BIN = "docker";

/**
 * Pre-flight docker-availability predicate (Phase 144 Step 2), mirroring `cellSkipReason`'s
 * shape: null means runnable, a string is the skip reason. Checked BEFORE any `docker run` —
 * `step_executor.ts`'s generic SHELL-step path has no missing-binary-to-SKIPPED handling of
 * its own (a bare `Deno.Command(...).output()`), so an absent `docker` invoked through that
 * path would throw uncaught rather than skip. Callers gate `external_bench_task` scenario
 * runs on this predicate the same way matrix cells are gated on `cellSkipReason`.
 */
export function dockerProbeSkipReason(
  binOnPath: Opt<(bin: string) => boolean, Reason.SensibleDefault> = binIsOnPath,
): string | null {
  return binOnPath(DOCKER_BIN) ? null : `binary '${DOCKER_BIN}' not on PATH`;
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
