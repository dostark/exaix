#!/usr/bin/env -S deno run -A
/**
 * @module DeployUnslopTs
 * @path scripts/deploy_unslop_ts.ts
 * @description Moves or initializes the unslop-ts submodule pointer after it checks that the ref is published and that the engine still accepts the Exaix catalog.
 * @architectural-layer Tooling
 * @dependencies []
 * @related-files [packages/lint-policy/tests/unslop_ts_compat_test.ts, tests/scripts/deploy_unslop_ts_test.ts]
 * @public Exports are the unit-test surface of this module.
 *
 * Usage:
 *   deno task unslop-ts:deploy --ref=<vX.Y.Z|commit> [--yes]
 *                                                      Show the incoming log, ask for approval, check out the ref,
 *                                                      run the compatibility check, stage the pointer.
 *                                                      Without a terminal the script stops unless --yes is given.
 *   deno run --no-config --allow-run --allow-read --allow-env scripts/deploy_unslop_ts.ts --init
 *                                                      Initialize the submodule at the recorded pointer, then run the check.
 *                                                      Use this form on a fresh clone, where the empty submodule directory stops `deno task`.
 *
 * The compatibility check runs the new engine's own tests on this machine. Its permission flags stop
 * accidents only: a hostile test can still start `deno` or `git` and run anything. Read the log first.
 *
 * Exit code 0 = done, 1 = refused or failed, 2 = usage error.
 * The script stages the pointer with `git add`. It never creates a commit and never pushes.
 */

const SUBMODULE = "unslop-ts";
const REMOTE = "origin";
const REMOTE_MAIN = `${REMOTE}/main`;
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const COMPAT_TESTS: readonly string[] = [
  `${SUBMODULE}/tests`,
  "packages/lint-policy/tests/unslop_ts_compat_test.ts",
];
/** Variables the engine tests and the typescript package read. The compatibility check grants no other. */
const COMPAT_ENV: readonly string[] = [
  "DEMO_LINT_RULES",
  "OTHER_LINT_RULES",
  "TSC_*",
  "NODE_INSPECTOR_IPC",
  "NODE_ENV",
  "NO_COLOR",
  "FORCE_COLOR",
  "COLORTERM",
  "TERM",
  "TERM_PROGRAM",
  "WT_SESSION",
  "OS",
  "VSCODE_INSPECTOR_OPTIONS",
];
const DEFAULT_TEMP_DIR = "/tmp";
/** Dynamic-loader variables. A scoped --allow-run refuses to spawn a process while one of them is set. */
const LOADER_ENV_PATTERN = /^(LD_|DYLD_)/;
const USAGE_EXIT = 2;
const APPROVAL_ANSWERS: readonly string[] = ["y", "yes"];
const FAILURE_EXIT = 1;
const USAGE = "Usage: deploy_unslop_ts.ts --ref=<vX.Y.Z|commit> [--yes] | --init";

class DeployError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "DeployError";
    this.exitCode = exitCode;
  }
}

interface IGitResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The arguments of the compatibility check. They limit read and write to the repository and the temp dir.
 * The flag `--allow-run=deno,git` still lets a test run any command. These flags stop accidents, not a hostile ref.
 */
export function compatCommandArgs(rootDir: string, tempDir: string): string[] {
  return [
    "test",
    `--allow-read=${rootDir},${tempDir}`,
    `--allow-write=${tempDir}`,
    "--allow-run=deno,git",
    `--allow-env=${COMPAT_ENV.join(",")}`,
    ...COMPAT_TESTS,
  ];
}

/** The environment of the compatibility check: the caller's, without loader variables. */
export function compatEnv(parent: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(parent).filter(([name]) => !LOADER_ENV_PATTERN.test(name)));
}

async function git(cwd: string, args: readonly string[]): Promise<IGitResult> {
  const result = await new Deno.Command("git", {
    args: [...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    ok: result.success,
    stdout: decoder.decode(result.stdout).trim(),
    stderr: decoder.decode(result.stderr).trim(),
  };
}

async function gitOrThrow(cwd: string, args: readonly string[]): Promise<string> {
  const result = await git(cwd, args);
  if (!result.ok) throw new DeployError(`git ${args.join(" ")} failed: ${result.stderr}`, FAILURE_EXIT);
  return result.stdout;
}

interface IParsedArgs {
  /** The ref to deploy, or null for --init. */
  readonly ref: string | null;
  readonly approved: boolean;
}

/** True when the user's answer approves the deploy. */
export function isApprovalAnswer(answer: string | null): boolean {
  return answer !== null && APPROVAL_ANSWERS.includes(answer.trim().toLowerCase());
}

/** Reads the arguments. Throws a usage error when they are not --init or --ref. */
function parseArgs(args: readonly string[]): IParsedArgs {
  const init = args.includes("--init");
  const refArg = args.find((arg) => arg.startsWith("--ref="));
  const approved = args.includes("--yes");
  if (init === (refArg !== undefined)) throw new DeployError(USAGE, USAGE_EXIT);
  if (init) return { ref: null, approved };
  const ref = refArg!.slice("--ref=".length);
  if (!TAG_PATTERN.test(ref) && !COMMIT_PATTERN.test(ref)) {
    throw new DeployError(`'${ref}' is not a version tag or a commit hash.\n${USAGE}`, USAGE_EXIT);
  }
  return { ref, approved };
}

/** Stops the deploy before any engine code runs, unless the user approves on a terminal or passes --yes. */
function requireApproval(ref: string, approved: boolean): void {
  if (approved) return;
  if (!Deno.stdin.isTerminal()) {
    throw new DeployError(`Approval needed for ${ref}. Read the log above, then run again with --yes.`, FAILURE_EXIT);
  }
  if (!isApprovalAnswer(prompt(`Run the engine tests for ${ref}? [y/N]`))) {
    throw new DeployError(`Deploy of ${ref} was not approved.`, FAILURE_EXIT);
  }
}

async function assertPublished(submodule: string, ref: string): Promise<void> {
  if (TAG_PATTERN.test(ref)) {
    const tag = await git(submodule, ["ls-remote", "--exit-code", "--tags", REMOTE, `refs/tags/${ref}`]);
    if (!tag.ok) throw new DeployError(`${ref} is not published: ${REMOTE} has no such tag.`, FAILURE_EXIT);
    return;
  }
  const reachable = await git(submodule, ["merge-base", "--is-ancestor", ref, REMOTE_MAIN]);
  if (!reachable.ok) throw new DeployError(`${ref} is not published: it is not on ${REMOTE_MAIN}.`, FAILURE_EXIT);
}

async function runCompatCheck(root: string): Promise<boolean> {
  const tempDir = Deno.env.get("TMPDIR") ?? DEFAULT_TEMP_DIR;
  const result = await new Deno.Command(Deno.execPath(), {
    args: compatCommandArgs(root, tempDir),
    cwd: root,
    clearEnv: true,
    env: compatEnv(Deno.env.toObject()),
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return result.success;
}

async function initialize(root: string): Promise<void> {
  await gitOrThrow(root, ["submodule", "update", "--init", SUBMODULE]);
  if (!(await runCompatCheck(root))) {
    throw new DeployError("The compatibility check failed for the recorded pointer.", FAILURE_EXIT);
  }
  console.log(`Initialized ${SUBMODULE}. The pointer is unchanged.`);
}

async function moveTo(root: string, ref: string, approved: boolean): Promise<void> {
  const submodule = `${root}/${SUBMODULE}`;
  const initialized = await git(submodule, ["rev-parse", "--git-dir"]);
  if (!initialized.ok) throw new DeployError(`${SUBMODULE} is not initialized. Run with --init first.`, FAILURE_EXIT);
  if ((await gitOrThrow(submodule, ["status", "--porcelain"])) !== "") {
    throw new DeployError(`The ${SUBMODULE} worktree is not clean. Commit or discard its changes first.`, FAILURE_EXIT);
  }
  const previous = await gitOrThrow(submodule, ["rev-parse", "HEAD"]);
  await gitOrThrow(submodule, ["fetch", "--tags", REMOTE]);
  await assertPublished(submodule, ref);
  console.log(`Incoming changes ${previous.slice(0, 10)}..${ref}:`);
  console.log(await gitOrThrow(submodule, ["log", "--oneline", `${previous}..${ref}`]));
  requireApproval(ref, approved);
  await gitOrThrow(submodule, ["checkout", "-q", "--detach", ref]);
  if (!(await runCompatCheck(root))) {
    await gitOrThrow(submodule, ["checkout", "-q", "--detach", previous]);
    throw new DeployError(
      `The compatibility check failed for ${ref}. Restored ${previous.slice(0, 10)}.`,
      FAILURE_EXIT,
    );
  }
  await gitOrThrow(root, ["add", SUBMODULE]);
  console.log(`Staged ${SUBMODULE} at ${ref}. Review the diff and commit it yourself.`);
}

async function main(args: readonly string[]): Promise<number> {
  try {
    const { ref, approved } = parseArgs(args);
    const root = Deno.cwd();
    if (ref === null) await initialize(root);
    else await moveTo(root, ref, approved);
    return 0;
  } catch (error) {
    if (!(error instanceof DeployError)) throw error;
    console.error(error.message);
    return error.exitCode;
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
