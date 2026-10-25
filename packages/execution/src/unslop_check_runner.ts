/**
 * @module UnslopCheckRunner
 * @path packages/execution/src/unslop_check_runner.ts
 * @description Security-sensitive portal unslop adapter: strict changed-line selection, trusted
 *   assets, a private generated lint config and a bounded `deno lint` child.
 * @architectural-layer Services
 * @dependencies [@std/path, @exaix/core, @exaix/git, @exaix/schemas]
 * @related-files [packages/execution/src/unslop_lint_process.ts, packages/execution/src/verification_output.ts]
 */

import { fromFileUrl, globToRegExp, join, relative, SEPARATOR, toFileUrl } from "@std/path";
import {
  UNSLOP_DENO_PACK,
  UNSLOP_PLUGIN_NAME,
  UNSLOP_PORTAL_CATALOG_FILENAME,
  UNSLOP_PORTAL_ENGINE_FILENAME,
  UNSLOP_PORTAL_INCLUDE_GLOBS,
  UNSLOP_PORTAL_SOURCE_EXTENSIONS,
} from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import {
  decodeUtf8,
  type IGitLineRange,
  intersectsChangedLines,
  isSafeRepoRelativePath,
  listChangedSources,
  readBlobAtCommit,
  readChangedLineRanges,
} from "@exaix/git";
import { UnslopErrorClass, VerificationStatus } from "@exaix/schemas";
import type {
  IUnslopCheckContext,
  IUnslopCheckOutcome,
  IUnslopCheckRunnerOptions,
  IUnslopFinding,
} from "./unslop_check_types.ts";
import { type IUnslopAssets, loadUnslopAssets } from "./unslop_assets.ts";
import { runUnslopLintBatch, unslopLintArgs } from "./unslop_lint_process.ts";
import { bindUnslopBudget } from "./unslop_budget.ts";
import { compareUnslopFindings, type IUnslopCollectedFindings, uniqueUnslopBatch } from "./unslop_findings.ts";
import {
  isUnslopPositionWithinSource,
  readUnslopLineLengths,
  validateUnslopSnapshot,
} from "./unslop_source_snapshot.ts";
import { UnslopCheckError } from "./unslop_check_error.ts";
import { createUnslopPrivateDirectory, removeUnslopPrivateDirectory, writeUnslopPrivateInput } from "./unslop_trust.ts";
import { buildVerificationCheckEnv, prepareVerificationOutput } from "./verification_output.ts";

/** The suppression marker the host-independent control rejects. */
const SUPPRESSION_MARKER = "deno-lint-ignore";
/** The discriminator field of a typed outcome. */
const KIND_FIELD = "kind";
const POSIX_SEPARATOR = "/";
const DENO_CONFIG_FILENAME = "deno.json";
const PLUGIN_FILENAME = "plugin.ts";

/** The file selection of one invocation. */
interface ISelection {
  readonly files: readonly string[];
}

function errorOutcome(errorClass: UnslopErrorClass): IUnslopCheckOutcome {
  return { kind: VerificationStatus.ERROR, error_class: errorClass, total: null, findings: [], output: "" };
}

function passedOutcome(): IUnslopCheckOutcome {
  return { kind: VerificationStatus.PASSED, hostExitCodes: [], total: 0, findings: [], output: "" };
}

function gitErrorClass(code: string): UnslopErrorClass {
  if (code === "output_limit" || code === "limit_exceeded") return UnslopErrorClass.LIMIT_EXCEEDED;
  if (code === "deadline_exceeded") return UnslopErrorClass.TIMEOUT;
  return UnslopErrorClass.GIT_FAILED;
}

function batchErrorClass(kind: string): UnslopErrorClass {
  if (kind === "deadline_exceeded") return UnslopErrorClass.TIMEOUT;
  if (kind === "limit") return UnslopErrorClass.LIMIT_EXCEEDED;
  if (kind === "spawn_failed") return UnslopErrorClass.SPAWN_FAILED;
  if (kind === "source_invalid") return UnslopErrorClass.SOURCE_INVALID;
  return UnslopErrorClass.HOST_PROTOCOL_INVALID;
}

/** Converts a host half-open range to the last touched line. Null means an invalid range. */
export function normalizeHostRange(
  start: { readonly line: number; readonly column: number },
  end: { readonly line: number; readonly column: number },
): { readonly startLine: number; readonly endLine: number } | null {
  if (start.line < 1 || start.column < 0) return null;
  if (end.line < start.line) return null;
  const endLine = end.line > start.line && end.column === 0 ? end.line - 1 : end.line;
  if (endLine < start.line) return null;
  return { startLine: start.line, endLine };
}

/** True when a repo path matches one of the include globs. */
export function matchesInclude(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) =>
    globToRegExp(glob, { extended: true, globstar: true, caseInsensitive: false }).test(path)
  );
}

/** Resolves a host `file:` URL to a confined repo-relative POSIX path. */
async function hostRepoPath(executionRoot: string, filename: string): Promise<string | null> {
  try {
    const absolute = fromFileUrl(filename);
    const realRoot = await Deno.realPath(executionRoot);
    const realFile = await Deno.realPath(absolute);
    if (realFile !== realRoot && !realFile.startsWith(realRoot + SEPARATOR)) return null;
    const rel = relative(realRoot, realFile).split(SEPARATOR).join(POSIX_SEPARATOR);
    return isSafeRepoRelativePath(rel) ? rel : null;
  } catch {
    return null;
  }
}

/** @visible */
export class UnslopCheckRunner {
  constructor(
    private readonly logger: IEventLogger,
    private readonly options: IUnslopCheckRunnerOptions,
  ) {}

  /** Runs one configured unslop check and returns its typed outcome. */
  async run(context: IUnslopCheckContext): Promise<IUnslopCheckOutcome> {
    const bound = bindUnslopBudget(context, this.options.settings.git_max_bytes);
    await this.emitStarted(context);
    let outcome = errorOutcome(UnslopErrorClass.HOST_PROTOCOL_INVALID);
    try {
      outcome = await this.execute(bound);
      if (bound.timeoutMs <= 0) throw new UnslopCheckError(UnslopErrorClass.TIMEOUT);
    } catch (error) {
      outcome = errorOutcome(
        error instanceof UnslopCheckError ? error.errorClass : UnslopErrorClass.HOST_PROTOCOL_INVALID,
      );
    }
    await this.emitCompleted(context, outcome);
    return outcome;
  }

  /** The check body. Exceptions map to a categorical error in `run`. */
  private async execute(context: IUnslopCheckContext): Promise<IUnslopCheckOutcome> {
    const selection = await this.selectChangedSources(context);
    if (KIND_FIELD in selection) return selection;

    const suppression = await this.scanSuppressionMarkers(context, selection.files);
    if (suppression !== null) return errorOutcome(suppression);
    const initial = await validateUnslopSnapshot(context, this.options, selection.files);
    if (initial !== null) return errorOutcome(initial);
    if (selection.files.length === 0) return passedOutcome();

    const assets = await loadUnslopAssets(context, this.options);
    if ("error_class" in assets) return errorOutcome(assets.error_class);

    const ranges = await this.loadRanges(context, selection.files);
    if (KIND_FIELD in ranges) return ranges;

    const directory = await createUnslopPrivateDirectory(context, this.options);
    const runDir = directory.path;
    try {
      await this.writePrivateInputs(runDir, assets);
      const collected = await this.lintBatches(context, runDir, selection.files, assets, ranges);
      const final = await validateUnslopSnapshot(context, this.options, selection.files);
      if (final !== null) return errorOutcome(final);
      if (KIND_FIELD in collected) return collected;
      return this.buildOutcome(context, collected);
    } finally {
      await removeUnslopPrivateDirectory(directory, this.options);
    }
  }

  /** Selects changed eligible files, or returns a categorical error. */
  private async selectChangedSources(context: IUnslopCheckContext): Promise<ISelection | IUnslopCheckOutcome> {
    const result = await listChangedSources(context.git, context.baseSha, context.targetSha, {
      extensions: UNSLOP_PORTAL_SOURCE_EXTENSIONS,
      maxFiles: this.options.settings.candidate_max_count,
      maxOutputBytes: this.options.settings.git_max_bytes,
      timeoutMs: context.timeoutMs,
    });
    if (!result.ok) return errorOutcome(gitErrorClass(result.code));
    const globs = context.check.include ?? UNSLOP_PORTAL_INCLUDE_GLOBS;
    const files = result.value.map((entry) => entry.path).filter((path) => matchesInclude(path, globs));
    return { files };
  }

  /** Rejects any selected file that contains the exact suppression marker. */
  private async scanSuppressionMarkers(
    context: IUnslopCheckContext,
    files: readonly string[],
  ): Promise<UnslopErrorClass | null> {
    for (const file of files) {
      const blob = await readBlobAtCommit(context.git, context.targetSha, file, {
        maxBytes: this.options.settings.file_max_bytes,
        timeoutMs: context.timeoutMs,
      });
      if (!blob.ok) return blob.code === "invalid_mode" ? UnslopErrorClass.SOURCE_INVALID : gitErrorClass(blob.code);
      const text = decodeUtf8(blob.value.bytes);
      if (text === null) return UnslopErrorClass.SOURCE_INVALID;
      if (text.includes(SUPPRESSION_MARKER)) return UnslopErrorClass.SUPPRESSION_FORBIDDEN;
    }
    return null;
  }

  /** Reads the closed changed ranges of every selected file. */
  private async loadRanges(
    context: IUnslopCheckContext,
    files: readonly string[],
  ): Promise<ReadonlyMap<string, readonly IGitLineRange[]> | IUnslopCheckOutcome> {
    const ranges = new Map<string, readonly IGitLineRange[]>();
    for (const file of files) {
      const result = await readChangedLineRanges(context.git, context.baseSha, context.targetSha, file, {
        maxOutputBytes: this.options.settings.git_max_bytes,
        timeoutMs: context.timeoutMs,
      });
      if (!result.ok) return errorOutcome(gitErrorClass(result.code));
      ranges.set(file, result.value);
    }
    return ranges;
  }

  /** Writes the generated plugin and config into the private directory. */
  private async writePrivateInputs(runDir: string, assets: IUnslopAssets): Promise<void> {
    await this.options.pathResolver.validatePath(runDir, [runDir]);
    const enginePath = join(runDir, UNSLOP_PORTAL_ENGINE_FILENAME);
    const catalogPath = join(runDir, UNSLOP_PORTAL_CATALOG_FILENAME);
    await writeUnslopPrivateInput(runDir, UNSLOP_PORTAL_ENGINE_FILENAME, assets.engineBytes, this.options);
    await writeUnslopPrivateInput(runDir, UNSLOP_PORTAL_CATALOG_FILENAME, assets.catalogBytes, this.options);
    const engineUrl = JSON.stringify(toFileUrl(enginePath).href);
    const catalogUrl = JSON.stringify(toFileUrl(catalogPath).href);
    const selectedPacks = assets.packs.includes(UNSLOP_DENO_PACK)
      ? "TYPESCRIPT_RULE_PACK, DENO_RULE_PACK"
      : "TYPESCRIPT_RULE_PACK";
    const plugin = [
      `import { createDenoPlugin, createRuleRegistry, parseCatalog, ${selectedPacks} } from ${engineUrl};`,
      `import catalogJson from ${catalogUrl} with { type: "json" };`,
      `const catalog = parseCatalog(catalogJson, { scriptRuleSchemas: null, registry: createRuleRegistry(${
        JSON.stringify(UNSLOP_PLUGIN_NAME)
      }, [${selectedPacks}]) });`,
      `export default createDenoPlugin(${
        JSON.stringify(UNSLOP_PLUGIN_NAME)
      }, catalog, { rulePacks: [${selectedPacks}], selection: "" });`,
      "",
    ].join("\n");
    await writeUnslopPrivateInput(runDir, PLUGIN_FILENAME, new TextEncoder().encode(plugin), this.options);
    await writeUnslopPrivateInput(
      runDir,
      DENO_CONFIG_FILENAME,
      new TextEncoder().encode(
        JSON.stringify({ lock: false, lint: { plugins: [`./${PLUGIN_FILENAME}`], include: [], exclude: [] } }),
      ),
      this.options,
    );
  }

  /** Runs every lint batch and returns the retained raw findings, or a categorical error. */
  private async lintBatches(
    context: IUnslopCheckContext,
    runDir: string,
    files: readonly string[],
    assets: IUnslopAssets,
    ranges: ReadonlyMap<string, readonly IGitLineRange[]>,
  ): Promise<IUnslopCollectedFindings | IUnslopCheckOutcome> {
    const batches = this.batchFiles(files, join(runDir, DENO_CONFIG_FILENAME));
    const { env, clearEnv } = buildVerificationCheckEnv();
    const deadline = Date.now() + context.timeoutMs;
    let findings: IUnslopFinding[] = [];
    let total = 0;
    const hostExitCodes: number[] = [];
    for (const batch of batches) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return errorOutcome(UnslopErrorClass.TIMEOUT);
      const result = await runUnslopLintBatch({
        configPath: join(runDir, DENO_CONFIG_FILENAME),
        files: batch.map((file) => `./${file}`),
        cwd: context.executionRoot,
        env,
        clearEnv,
        timeoutMs: remaining,
        jsonMaxBytes: this.options.settings.json_max_bytes,
        stderrMaxBytes: this.options.settings.stderr_max_bytes,
      });
      if (result.kind !== "diagnostics") return errorOutcome(batchErrorClass(result.kind));
      const normalized = await this.normalizeDiagnostics(context, result.diagnostics, batch, assets, ranges);
      if (!Array.isArray(normalized)) return normalized;
      const unique = uniqueUnslopBatch(normalized);
      total += unique.length;
      hostExitCodes.push(...result.hostExitCodes);
      findings = [...findings, ...unique.slice(0, this.options.settings.findings_limit)]
        .sort(compareUnslopFindings).slice(0, this.options.settings.findings_limit);
    }
    return { findings, total, hostExitCodes };
  }

  /** Splits files into batches that respect the file count and encoded argv budgets. */
  private batchFiles(files: readonly string[], configPath: string): readonly (readonly string[])[] {
    const batches: string[][] = [];
    let current: string[] = [];
    const fixedBytes = [Deno.execPath(), ...unslopLintArgs(configPath, [])]
      .reduce((total, arg) => total + new TextEncoder().encode(arg).byteLength + 1, 0);
    let bytes = fixedBytes;
    for (const file of files) {
      const operand = `./${file}`;
      const encoded = new TextEncoder().encode(operand).byteLength + 1;
      if (fixedBytes + encoded > this.options.settings.argv_max_bytes) {
        throw new UnslopCheckError(UnslopErrorClass.LIMIT_EXCEEDED);
      }
      const exceedsCount = current.length >= this.options.settings.batch_max_files;
      const exceedsBytes = bytes + encoded > this.options.settings.argv_max_bytes;
      if (current.length > 0 && (exceedsCount || exceedsBytes)) {
        batches.push(current);
        current = [];
        bytes = fixedBytes;
      }
      current.push(file);
      bytes += encoded;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  /** Normalizes, validates and filters host diagnostics to changed lines. */
  private async normalizeDiagnostics(
    context: IUnslopCheckContext,
    diagnostics: readonly {
      readonly filename: string;
      readonly code: string;
      readonly message: string;
      readonly hint: string;
      readonly start: { readonly line: number; readonly column: number };
      readonly end: { readonly line: number; readonly column: number };
    }[],
    selected: readonly string[],
    assets: IUnslopAssets,
    ranges: ReadonlyMap<string, readonly IGitLineRange[]>,
  ): Promise<IUnslopFinding[] | IUnslopCheckOutcome> {
    const selectedSet = new Set(selected);
    const sourceLengths = new Map<string, readonly number[]>();
    const findings: IUnslopFinding[] = [];
    for (const diagnostic of diagnostics) {
      const file = await hostRepoPath(context.executionRoot, diagnostic.filename);
      if (file === null || !selectedSet.has(file)) return errorOutcome(UnslopErrorClass.HOST_PROTOCOL_INVALID);
      if (!assets.ruleIds.has(diagnostic.code)) return errorOutcome(UnslopErrorClass.HOST_PROTOCOL_INVALID);
      const lengths = sourceLengths.get(file) ?? await readUnslopLineLengths(context, this.options, file);
      if (lengths === null) return errorOutcome(UnslopErrorClass.SNAPSHOT_INVALID);
      sourceLengths.set(file, lengths);
      if (
        !isUnslopPositionWithinSource(diagnostic.start, lengths) ||
        !isUnslopPositionWithinSource(diagnostic.end, lengths)
      ) {
        return errorOutcome(UnslopErrorClass.HOST_PROTOCOL_INVALID);
      }
      const interval = normalizeHostRange(diagnostic.start, diagnostic.end);
      if (interval === null) return errorOutcome(UnslopErrorClass.HOST_PROTOCOL_INVALID);
      const changed = ranges.get(file) ?? [];
      if (!intersectsChangedLines(changed, interval.startLine, interval.endLine)) continue;
      findings.push({
        file,
        start_line: diagnostic.start.line,
        start_column: diagnostic.start.column,
        end_line: diagnostic.end.line,
        end_column: diagnostic.end.column,
        rule: diagnostic.code,
      });
    }
    return findings;
  }

  /** Sorts, deduplicates, caps and formats the retained findings. */
  private buildOutcome(
    context: IUnslopCheckContext,
    collected: IUnslopCollectedFindings,
  ): IUnslopCheckOutcome {
    if (collected.total === 0) return passedOutcome();
    const text = collected.findings.map((finding) => `${finding.file}:${finding.start_line} ${finding.rule}`).join(
      "\n",
    );
    const output = prepareVerificationOutput(text, context.outputMaxChars, this.options.knownSecrets ?? []);
    return {
      kind: VerificationStatus.FAILED,
      hostExitCodes: collected.hostExitCodes,
      total: collected.total,
      findings: collected.findings,
      output,
    };
  }

  private emitStarted(context: IUnslopCheckContext): Promise<void> {
    return this.logger.info(DomainEventType.ExecutionVerificationLintCheckStarted, null, {
      request_id: context.requestId,
      run_id: context.runId,
      attempt: context.attempt,
      check_index: context.checkIndex,
      target_sha: context.targetSha,
    }, context.traceId);
  }

  private emitCompleted(context: IUnslopCheckContext, outcome: IUnslopCheckOutcome): Promise<void> {
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
