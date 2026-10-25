/**
 * @module DenoLintCheck
 * @path packages/execution/src/deno_lint_check.ts
 * @description Runs the generic Deno lint check over a commit's tracked files with the installed policy.
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/git, @exaix/schemas, @std/path]
 * @related-files [packages/execution/src/deno_lint_process.ts, packages/execution/src/verification_runner.ts]
 */

import { fromFileUrl, globToRegExp, join, relative, SEPARATOR } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { IGitService } from "@exaix/core/types";
import { isSafeRepoRelativePath, listTrackedFiles } from "@exaix/git";
import { type IDenoLintCheck, type ILintSettings, LintErrorClass, VerificationStatus } from "@exaix/schemas";
import { DENO_LINT_DEADLINE_EXCEEDED, type IDenoLintBatchOutcome, runDenoLintBatch } from "./deno_lint_process.ts";
import { type ILintFinding, uniqueLintBatch } from "./lint_snapshot.ts";
import { buildVerificationCheckEnv, prepareVerificationOutput } from "./verification_output.ts";

const POLICY_CONFIG_FILENAME = "deno.json";
const REPO_SEPARATOR = "/";
/** The line-comment directive Deno applies to a whole file before any plugin rule runs. */
const FILE_IGNORE_DIRECTIVE = /^\s*\/\/\s*deno-lint-ignore-file\b/;
/** The longest line prefix the guard inspects for a file-level directive. */
const LINE_PREFIX_MAX_BYTES = 4_096;
/** Plugin ids and built-in Deno rule ids. */
const RULE_PATTERN = /^([a-z][a-z0-9-]*\/)?[a-z][a-z0-9-]*$/;

/** One retained diagnostic of one lint run. Paths are repo-relative until safe projection. */
export type IDenoLintFinding = ILintFinding;

/** A check that retained no finding. */
export interface IDenoLintCheckOutcomePassed {
  readonly kind: typeof VerificationStatus.PASSED;
  readonly total: 0;
  readonly findings: readonly [];
  readonly output: "";
}

/** A check that retained findings. */
export interface IDenoLintCheckOutcomeFailed {
  readonly kind: typeof VerificationStatus.FAILED;
  readonly total: number;
  readonly findings: readonly IDenoLintFinding[];
  readonly output: string;
}

/** A check that could not produce a valid result. */
export interface IDenoLintCheckOutcomeError {
  readonly kind: typeof VerificationStatus.ERROR;
  readonly error_class: LintErrorClass;
  readonly total: null;
  readonly findings: readonly [];
  readonly output: string;
}

export type IDenoLintCheckOutcome =
  | IDenoLintCheckOutcomePassed
  | IDenoLintCheckOutcomeFailed
  | IDenoLintCheckOutcomeError;

/** One lint check invocation, bound to an immutable target commit. */
export interface IDenoLintCheckContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly attempt: number;
  readonly runId: string;
  readonly executionRoot: string;
  readonly targetSha: string;
  readonly git: IGitService;
  readonly checkIndex: number;
  readonly check: IDenoLintCheck;
  readonly timeoutMs: number;
  readonly outputMaxChars: number;
}

/** The bounded host batch runner the check dispatches to. */
export type IDenoLintBatchRunner = (
  options: Parameters<typeof runDenoLintBatch>[0],
) => Promise<IDenoLintBatchOutcome>;

/** The confinement check the runner needs from the path resolver. */
export interface IDenoLintPathValidator {
  validatePath(path: string, allowedRoots: string[]): Promise<string>;
}

/** Inputs of the generic Deno lint check. They never infer a root from the process directory. */
export interface IDenoLintCheckRunnerOptions {
  readonly settings: ILintSettings;
  readonly systemRoot: string;
  readonly pathResolver: IDenoLintPathValidator;
  /** Configured portal roots that cannot own trusted lint inputs. */
  readonly portalRoots?: readonly string[];
  readonly knownSecrets?: readonly string[];
  /** Host batch override for tests that do not spawn. */
  readonly runBatch?: IDenoLintBatchRunner;
  /** File-ignore scanner override for tests that simulate a slow guard. */
  readonly hasFileIgnore?: (path: string, beforeChunk: () => void) => Promise<boolean | null>;
  /** Clock override for tests that advance the deadline. */
  readonly now?: () => number;
}

/** A categorical failure raised inside the check body. */
class DenoLintCheckError extends Error {
  constructor(readonly errorClass: LintErrorClass) {
    super(errorClass);
    this.name = "DenoLintCheckError";
  }
}

function errorOutcome(errorClass: LintErrorClass): IDenoLintCheckOutcome {
  return {
    kind: VerificationStatus.ERROR,
    error_class: errorClass,
    total: null,
    findings: [],
    output: `${errorClass}: verification could not complete; check the policy and source.`,
  };
}

function passedOutcome(): IDenoLintCheckOutcome {
  return { kind: VerificationStatus.PASSED, total: 0, findings: [], output: "" };
}

/** Reads the remaining whole-check budget, or raises the timeout outcome. */
function remainingMs(deadline: number, now: () => number): number {
  const remaining = deadline - now();
  if (remaining <= 0) throw new DenoLintCheckError(LintErrorClass.TIMEOUT);
  return remaining;
}

/** Classifies one host batch failure. */
function batchErrorClass(kind: IDenoLintBatchOutcome["kind"]): LintErrorClass {
  if (kind === DENO_LINT_DEADLINE_EXCEEDED) return LintErrorClass.TIMEOUT;
  if (kind === "limit") return LintErrorClass.OUTPUT_LIMIT;
  if (kind === "source_invalid") return LintErrorClass.SOURCE_INVALID;
  return LintErrorClass.HOST_FAILED;
}

/** True when a repo path matches one of the globs. */
function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) =>
    globToRegExp(glob, { extended: true, globstar: true, caseInsensitive: false }).test(path)
  );
}

/** Splits the selection into batches of at most `size` files. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

/** Streams one regular file and reports whether a line starts with a file-level directive. */
async function sourceHasFileIgnore(path: string, beforeChunk: () => void): Promise<boolean | null> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(path);
  } catch {
    return null;
  }
  if (!info.isFile || info.isSymlink) return null;
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, { read: true });
  } catch {
    return null;
  }
  try {
    let prefix = "";
    let prefixBytes = 0;
    for await (const chunk of file.readable) {
      beforeChunk();
      for (const byte of chunk) {
        if (byte === 0x0a) {
          if (FILE_IGNORE_DIRECTIVE.test(prefix)) return true;
          prefix = "";
          prefixBytes = 0;
          continue;
        }
        if (prefixBytes < LINE_PREFIX_MAX_BYTES) {
          prefix += String.fromCharCode(byte);
          prefixBytes++;
        }
      }
    }
    return FILE_IGNORE_DIRECTIVE.test(prefix);
  } catch (error) {
    if (error instanceof DenoLintCheckError) throw error;
    return null;
  } finally {
    // The stream closes the file at EOF. Close only the early-exit path.
    try {
      file.close();
    } catch {
      // The resource already closed.
    }
  }
}

/** Resolves a host `file:` URL to a confined repo-relative POSIX path. */
async function hostRepoPath(executionRoot: string, filename: string): Promise<string | null> {
  try {
    const absolute = fromFileUrl(filename);
    const realRoot = await Deno.realPath(executionRoot);
    const realFile = await Deno.realPath(absolute);
    if (realFile !== realRoot && !realFile.startsWith(realRoot + SEPARATOR)) return null;
    const rel = relative(realRoot, realFile).split(SEPARATOR).join(REPO_SEPARATOR);
    return isSafeRepoRelativePath(rel) ? rel : null;
  } catch {
    return null;
  }
}

/** Orders findings by position and rule and drops exact duplicates. */
/** @visible */
export class DenoLintCheckRunner {
  constructor(
    private readonly logger: IEventLogger,
    private readonly options: IDenoLintCheckRunnerOptions,
  ) {}

  /** Runs one configured Deno lint check and returns its typed outcome. */
  async run(context: IDenoLintCheckContext): Promise<IDenoLintCheckOutcome> {
    await this.emitStarted(context);
    const now = this.options.now ?? Date.now;
    const deadline = now() + context.timeoutMs;
    let outcome: IDenoLintCheckOutcome;
    try {
      outcome = await this.execute(context, deadline, now);
    } catch (error) {
      outcome = errorOutcome(
        error instanceof DenoLintCheckError ? error.errorClass : LintErrorClass.HOST_FAILED,
      );
    }
    await this.emitCompleted(context, outcome);
    return outcome;
  }

  /** The check body. Exceptions map to a categorical error in `run`. */
  private async execute(
    context: IDenoLintCheckContext,
    deadline: number,
    now: () => number,
  ): Promise<IDenoLintCheckOutcome> {
    const configPath = await this.resolvePolicyConfig(context);
    const listed = await listTrackedFiles(context.git, context.targetSha, {
      maxOutputBytes: this.options.settings.git_max_bytes,
      timeoutMs: remainingMs(deadline, now),
    });
    if (!listed.ok) throw new DenoLintCheckError(LintErrorClass.GIT_FAILED);
    const selected = listed.value.filter((path) =>
      matchesAnyGlob(path, context.check.include) && !matchesAnyGlob(path, context.check.exclude)
    );
    if (selected.length === 0) return passedOutcome();
    await this.assertNoFileIgnore(context, selected, deadline, now);

    const { env, clearEnv } = buildVerificationCheckEnv();
    const runBatch = this.options.runBatch ?? runDenoLintBatch;
    const findings: IDenoLintFinding[] = [];
    for (const batch of chunk(selected, this.options.settings.batch_max_files)) {
      const result = await runBatch({
        configPath,
        files: batch.map((file) => `./${file}`),
        cwd: context.executionRoot,
        env,
        clearEnv,
        timeoutMs: remainingMs(deadline, now),
        jsonMaxBytes: this.options.settings.json_max_bytes,
        stderrMaxBytes: this.options.settings.stderr_max_bytes,
      });
      if (result.kind !== "diagnostics") throw new DenoLintCheckError(batchErrorClass(result.kind));
      for (const diagnostic of result.diagnostics) {
        if (!RULE_PATTERN.test(diagnostic.code)) throw new DenoLintCheckError(LintErrorClass.HOST_FAILED);
        const file = await hostRepoPath(context.executionRoot, diagnostic.filename);
        if (file === null) throw new DenoLintCheckError(LintErrorClass.HOST_FAILED);
        findings.push({
          file,
          start_line: diagnostic.start.line,
          start_column: diagnostic.start.column,
          end_line: diagnostic.end.line,
          end_column: diagnostic.end.column,
          rule: diagnostic.code,
        });
      }
    }
    return this.buildOutcome(context, findings);
  }

  /** Resolves the installed policy config and rejects an untrusted directory. */
  private async resolvePolicyConfig(context: IDenoLintCheckContext): Promise<string> {
    const policyRoot = join(this.options.systemRoot, this.options.settings.policy_root);
    const policyDir = join(policyRoot, context.check.policy);
    const configPath = join(policyDir, POLICY_CONFIG_FILENAME);
    let configInfo: Deno.FileInfo;
    try {
      configInfo = await Deno.lstat(configPath);
    } catch {
      throw new DenoLintCheckError(LintErrorClass.POLICY_MISSING);
    }
    if (!configInfo.isFile || configInfo.isSymlink) throw new DenoLintCheckError(LintErrorClass.POLICY_MISSING);
    try {
      const dirInfo = await Deno.lstat(policyDir);
      if (dirInfo.isSymlink || !dirInfo.isDirectory) {
        throw new DenoLintCheckError(LintErrorClass.POLICY_UNTRUSTED);
      }
      const realRoot = await Deno.realPath(policyRoot);
      const realDir = await Deno.realPath(policyDir);
      if (realDir !== realRoot && !realDir.startsWith(realRoot + SEPARATOR)) {
        throw new DenoLintCheckError(LintErrorClass.POLICY_UNTRUSTED);
      }
      await this.options.pathResolver.validatePath(configPath, [policyRoot]);
      for (const root of [context.executionRoot, ...(this.options.portalRoots ?? [])]) {
        const realRoot = await Deno.realPath(root).catch(() => null);
        if (realRoot === null) continue;
        if (realDir === realRoot || realDir.startsWith(realRoot + SEPARATOR)) {
          throw new DenoLintCheckError(LintErrorClass.POLICY_UNTRUSTED);
        }
      }
    } catch (error) {
      if (error instanceof DenoLintCheckError) throw error;
      throw new DenoLintCheckError(LintErrorClass.POLICY_UNTRUSTED);
    }
    return configPath;
  }

  /** Rejects any selected file that carries a file-level ignore directive. */
  private async assertNoFileIgnore(
    context: IDenoLintCheckContext,
    files: readonly string[],
    deadline: number,
    now: () => number,
  ): Promise<void> {
    const hasFileIgnore = this.options.hasFileIgnore ?? sourceHasFileIgnore;
    for (const file of files) {
      remainingMs(deadline, now);
      const found = await hasFileIgnore(join(context.executionRoot, file), () => remainingMs(deadline, now));
      if (found === null) throw new DenoLintCheckError(LintErrorClass.SOURCE_INVALID);
      if (found) throw new DenoLintCheckError(LintErrorClass.SUPPRESSION_FORBIDDEN);
    }
  }

  /** Sorts, deduplicates, caps and formats the retained findings. */
  private buildOutcome(
    context: IDenoLintCheckContext,
    findings: readonly IDenoLintFinding[],
  ): IDenoLintCheckOutcome {
    const unique = uniqueLintBatch(findings);
    if (unique.length === 0) return passedOutcome();
    const kept = unique.slice(0, this.options.settings.findings_limit);
    const text = kept.map((finding) => `${finding.file}:${finding.start_line} ${finding.rule}`).join("\n");
    const output = prepareVerificationOutput(text, context.outputMaxChars, this.options.knownSecrets ?? []);
    return {
      kind: VerificationStatus.FAILED,
      total: unique.length,
      findings: kept,
      output,
    };
  }

  private emitStarted(context: IDenoLintCheckContext): Promise<void> {
    return this.logger.info(DomainEventType.ExecutionVerificationLintCheckStarted, null, {
      request_id: context.requestId,
      run_id: context.runId,
      attempt: context.attempt,
      check_index: context.checkIndex,
      target_sha: context.targetSha,
    }, context.traceId);
  }

  private emitCompleted(context: IDenoLintCheckContext, outcome: IDenoLintCheckOutcome): Promise<void> {
    return this.logger.info(DomainEventType.ExecutionVerificationLintCheckCompleted, null, {
      request_id: context.requestId,
      run_id: context.runId,
      attempt: context.attempt,
      check_index: context.checkIndex,
      target_sha: context.targetSha,
      outcome: outcome.kind,
      total: outcome.total,
      error_class: outcome.kind === VerificationStatus.ERROR ? outcome.error_class : null,
    }, context.traceId);
  }
}
