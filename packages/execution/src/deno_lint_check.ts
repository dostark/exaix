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
import { buildVerificationCheckEnv, prepareVerificationOutput } from "./verification_output.ts";

const POLICY_CONFIG_FILENAME = "deno.json";
const REPO_SEPARATOR = "/";
const LINE_BREAK = /\r?\n/;
/** The line-comment directive Deno applies to a whole file before any plugin rule runs. */
const FILE_IGNORE_DIRECTIVE = /^\s*\/\/\s*deno-lint-ignore-file\b/;
/** The bounded source read the guard performs per selected file. */
const MAX_SOURCE_BYTES = 2_097_152;

/** One retained diagnostic of one lint run. Paths are repo-relative until safe projection. */
export interface IDenoLintFinding {
  readonly file: string;
  readonly start_line: number;
  readonly start_column: number;
  readonly end_line: number;
  readonly end_column: number;
  readonly rule: string;
}

/** A check that retained no finding. */
export interface IDenoLintCheckOutcomePassed {
  readonly kind: typeof VerificationStatus.PASSED;
  readonly hostExitCodes: readonly number[];
  readonly total: 0;
  readonly findings: readonly [];
  readonly output: "";
}

/** A check that retained findings. */
export interface IDenoLintCheckOutcomeFailed {
  readonly kind: typeof VerificationStatus.FAILED;
  readonly hostExitCodes: readonly number[];
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
  return { kind: VerificationStatus.PASSED, hostExitCodes: [], total: 0, findings: [], output: "" };
}

/** Reads the remaining whole-check budget, or raises the timeout outcome. */
function remainingMs(deadline: number): number {
  const remaining = deadline - Date.now();
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

/** Reads one bounded regular UTF-8 source file, or null when it is absent or oversized. */
async function readBoundedSource(path: string, maxBytes: number): Promise<string | null> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(path);
  } catch {
    return null;
  }
  if (!info.isFile || info.isSymlink || info.size > maxBytes) return null;
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
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
function uniqueFindings(findings: readonly IDenoLintFinding[]): IDenoLintFinding[] {
  const seen = new Set<string>();
  const unique: IDenoLintFinding[] = [];
  for (const finding of findings) {
    const key =
      `${finding.file}\u0000${finding.start_line}\u0000${finding.start_column}\u0000${finding.end_line}\u0000${finding.end_column}\u0000${finding.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  return unique.sort((left, right) =>
    left.file.localeCompare(right.file) ||
    left.start_line - right.start_line ||
    left.start_column - right.start_column ||
    left.rule.localeCompare(right.rule)
  );
}

/** @visible */
export class DenoLintCheckRunner {
  constructor(
    private readonly logger: IEventLogger,
    private readonly options: IDenoLintCheckRunnerOptions,
  ) {}

  /** Runs one configured Deno lint check and returns its typed outcome. */
  async run(context: IDenoLintCheckContext): Promise<IDenoLintCheckOutcome> {
    await this.emitStarted(context);
    const deadline = Date.now() + context.timeoutMs;
    let outcome: IDenoLintCheckOutcome;
    try {
      outcome = await this.execute(context, deadline);
    } catch (error) {
      outcome = errorOutcome(
        error instanceof DenoLintCheckError ? error.errorClass : LintErrorClass.HOST_FAILED,
      );
    }
    await this.emitCompleted(context, outcome);
    return outcome;
  }

  /** The check body. Exceptions map to a categorical error in `run`. */
  private async execute(context: IDenoLintCheckContext, deadline: number): Promise<IDenoLintCheckOutcome> {
    const configPath = await this.resolvePolicyConfig(context);
    const listed = await listTrackedFiles(context.git, context.targetSha, {
      maxOutputBytes: this.options.settings.git_max_bytes,
      timeoutMs: remainingMs(deadline),
    });
    if (!listed.ok) throw new DenoLintCheckError(LintErrorClass.GIT_FAILED);
    const selected = listed.value.filter((path) =>
      matchesAnyGlob(path, context.check.include) && !matchesAnyGlob(path, context.check.exclude)
    );
    if (selected.length === 0) return passedOutcome();
    await this.assertNoFileIgnore(context, selected);

    const { env, clearEnv } = buildVerificationCheckEnv();
    const runBatch = this.options.runBatch ?? runDenoLintBatch;
    const findings: IDenoLintFinding[] = [];
    const hostExitCodes: number[] = [];
    for (const batch of chunk(selected, this.options.settings.batch_max_files)) {
      const result = await runBatch({
        configPath,
        files: batch.map((file) => `./${file}`),
        cwd: context.executionRoot,
        env,
        clearEnv,
        timeoutMs: remainingMs(deadline),
        jsonMaxBytes: this.options.settings.json_max_bytes,
        stderrMaxBytes: this.options.settings.stderr_max_bytes,
      });
      if (result.kind !== "diagnostics") throw new DenoLintCheckError(batchErrorClass(result.kind));
      hostExitCodes.push(...result.hostExitCodes);
      for (const diagnostic of result.diagnostics) {
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
    return this.buildOutcome(context, findings, hostExitCodes);
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
  ): Promise<void> {
    for (const file of files) {
      const text = await readBoundedSource(join(context.executionRoot, file), MAX_SOURCE_BYTES);
      if (text === null) throw new DenoLintCheckError(LintErrorClass.SOURCE_INVALID);
      if (text.split(LINE_BREAK).some((line) => FILE_IGNORE_DIRECTIVE.test(line))) {
        throw new DenoLintCheckError(LintErrorClass.SUPPRESSION_FORBIDDEN);
      }
    }
  }

  /** Sorts, deduplicates, caps and formats the retained findings. */
  private buildOutcome(
    context: IDenoLintCheckContext,
    findings: readonly IDenoLintFinding[],
    hostExitCodes: readonly number[],
  ): IDenoLintCheckOutcome {
    const unique = uniqueFindings(findings);
    if (unique.length === 0) return passedOutcome();
    const kept = unique.slice(0, this.options.settings.findings_limit);
    const text = kept.map((finding) => `${finding.file}:${finding.start_line} ${finding.rule}`).join("\n");
    const output = prepareVerificationOutput(text, context.outputMaxChars, this.options.knownSecrets ?? []);
    return {
      kind: VerificationStatus.FAILED,
      hostExitCodes,
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
