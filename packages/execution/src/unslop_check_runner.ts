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
  UNSLOP_PLUGIN_NAME,
  UNSLOP_PORTAL_ASSET_DIR,
  UNSLOP_PORTAL_CATALOG_FILENAME,
  UNSLOP_PORTAL_ENGINE_FILENAME,
  UNSLOP_PORTAL_INCLUDE_GLOBS,
  UNSLOP_PORTAL_MANIFEST_FILENAME,
  UNSLOP_PORTAL_SOURCE_EXTENSIONS,
  UNSLOP_RUNTIME_DIR,
} from "@exaix/core";
import { DomainEventType } from "@exaix/core/events";
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
import type { LogMetadata } from "@exaix/core/types";
import type {
  IUnslopCheckContext,
  IUnslopCheckOutcome,
  IUnslopCheckRunnerOptions,
  IUnslopFinding,
} from "./unslop_check_types.ts";
import { runUnslopLintBatch } from "./unslop_lint_process.ts";
import { buildVerificationCheckEnv, prepareVerificationOutput } from "./verification_output.ts";

/** The suppression marker the host-independent control rejects. */
const SUPPRESSION_MARKER = "deno-lint-ignore";
/** Manifest format and policy versions the adapter accepts. */
const SUPPORTED_MANIFEST_FORMAT = 1;
const SUPPORTED_POLICY_VERSION = 1;
/** Private runtime directory mode. */
const PRIVATE_DIR_MODE = 0o700;
const POSIX_SEPARATOR = "/";
const PRIVATE_DIR_PREFIX = "run-";
const DENO_CONFIG_FILENAME = "deno.json";
const PLUGIN_FILENAME = "plugin.ts";

/** One packaged manifest entry. */
interface IManifestEntry {
  readonly sha256: string;
  readonly bytes: number;
}

/** The packaged provenance manifest. */
interface IAssetManifest {
  readonly format_version: number;
  readonly policy_version: number;
  readonly files: Readonly<Record<string, IManifestEntry>>;
}

/** Trusted assets of one invocation. */
interface IUnslopAssets {
  readonly engineBytes: Uint8Array;
  readonly catalogBytes: Uint8Array;
  readonly ruleIds: ReadonlySet<string>;
}

/** The file selection of one invocation. */
interface ISelection {
  readonly files: readonly string[];
}

function errorOutcome(errorClass: UnslopErrorClass, output = ""): IUnslopCheckOutcome {
  return { kind: VerificationStatus.ERROR, error_class: errorClass, total: null, findings: [], output };
}

function passedOutcome(): IUnslopCheckOutcome {
  return { kind: VerificationStatus.PASSED, hostExitCodes: [], total: 0, findings: [], output: "" };
}

function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return crypto.subtle.digest("SHA-256", copy).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  );
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
  constructor(private readonly options: IUnslopCheckRunnerOptions) {}

  /** Runs one configured unslop check and returns its typed outcome. */
  async run(context: IUnslopCheckContext): Promise<IUnslopCheckOutcome> {
    await this.emitStarted(context);
    let outcome = errorOutcome(UnslopErrorClass.HOST_PROTOCOL_INVALID);
    try {
      outcome = await this.execute(context);
    } catch {
      outcome = errorOutcome(UnslopErrorClass.HOST_PROTOCOL_INVALID);
    }
    await this.emitCompleted(context, outcome);
    return outcome;
  }

  /** The check body. Exceptions map to a categorical error in `run`. */
  private async execute(context: IUnslopCheckContext): Promise<IUnslopCheckOutcome> {
    const selection = await this.selectChangedSources(context);
    if ("kind" in selection) return selection;
    if (selection.files.length === 0) return passedOutcome();

    const suppression = await this.scanSuppressionMarkers(context, selection.files);
    if (suppression !== null) return errorOutcome(suppression);

    const assets = await this.loadAssets();
    if ("error_class" in assets) return errorOutcome(assets.error_class);

    const ranges = await this.loadRanges(context, selection.files);
    if ("kind" in ranges) return ranges;

    const runDir = await this.createPrivateRunDir();
    try {
      await this.writePrivateInputs(runDir, assets);
      const collected = await this.lintBatches(context, runDir, selection.files, assets, ranges);
      if ("kind" in collected) return collected;
      return this.buildOutcome(context, collected.findings);
    } finally {
      await Deno.remove(runDir, { recursive: true }).catch(() => {});
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

  /** Loads and verifies the packaged engine, catalog and manifest. */
  private async loadAssets(): Promise<IUnslopAssets | { error_class: UnslopErrorClass }> {
    const trustedRoot = join(this.options.systemRoot, UNSLOP_PORTAL_ASSET_DIR);
    let assetDir: string;
    try {
      assetDir = await this.options.pathResolver.validatePath(
        join(this.options.systemRoot, this.options.settings.asset_dir),
        [trustedRoot],
      );
    } catch {
      return { error_class: UnslopErrorClass.ASSET_INVALID };
    }
    let manifest: IAssetManifest;
    try {
      manifest = JSON.parse(await Deno.readTextFile(join(assetDir, UNSLOP_PORTAL_MANIFEST_FILENAME)));
    } catch {
      return { error_class: UnslopErrorClass.ASSET_INVALID };
    }
    if (manifest.format_version !== SUPPORTED_MANIFEST_FORMAT || manifest.policy_version !== SUPPORTED_POLICY_VERSION) {
      return { error_class: UnslopErrorClass.ASSET_INVALID };
    }
    const engineEntry = manifest.files[UNSLOP_PORTAL_ENGINE_FILENAME];
    const catalogEntry = manifest.files[UNSLOP_PORTAL_CATALOG_FILENAME];
    if (engineEntry === undefined) return { error_class: UnslopErrorClass.ENGINE_MISSING };
    if (catalogEntry === undefined) return { error_class: UnslopErrorClass.ASSET_INVALID };

    try {
      await Deno.stat(join(assetDir, UNSLOP_PORTAL_ENGINE_FILENAME));
    } catch {
      return { error_class: UnslopErrorClass.ENGINE_MISSING };
    }
    const engineBytes = await this.readVerifiedAsset(assetDir, UNSLOP_PORTAL_ENGINE_FILENAME, engineEntry);
    if (engineBytes === null) return { error_class: UnslopErrorClass.ASSET_INVALID };
    const catalogBytes = await this.readVerifiedAsset(assetDir, UNSLOP_PORTAL_CATALOG_FILENAME, catalogEntry);
    if (catalogBytes === null) return { error_class: UnslopErrorClass.ASSET_INVALID };
    const ruleIds = parseCatalogRuleIds(catalogBytes);
    if (ruleIds === null) return { error_class: UnslopErrorClass.CATALOG_INVALID };
    return { engineBytes, catalogBytes, ruleIds };
  }

  /** Reads one asset and compares its bytes and hash with the manifest. */
  private async readVerifiedAsset(dir: string, name: string, entry: IManifestEntry): Promise<Uint8Array | null> {
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(join(dir, name));
    } catch {
      return null;
    }
    if (bytes.byteLength !== entry.bytes) return null;
    return (await sha256Hex(bytes)) === entry.sha256 ? bytes : null;
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

  /** Creates the exclusive private runtime directory for this invocation. */
  private async createPrivateRunDir(): Promise<string> {
    const runtimeRoot = await this.options.pathResolver.resolve("@Runtime");
    const parent = join(runtimeRoot, UNSLOP_RUNTIME_DIR);
    await Deno.mkdir(parent, { recursive: true, mode: PRIVATE_DIR_MODE });
    await this.options.pathResolver.validatePath(parent, [runtimeRoot]);
    return await Deno.makeTempDir({ dir: parent, prefix: PRIVATE_DIR_PREFIX });
  }

  /** Writes the generated plugin and config into the private directory. */
  private async writePrivateInputs(runDir: string, assets: IUnslopAssets): Promise<void> {
    const enginePath = join(runDir, UNSLOP_PORTAL_ENGINE_FILENAME);
    const catalogPath = join(runDir, UNSLOP_PORTAL_CATALOG_FILENAME);
    await Deno.writeFile(enginePath, assets.engineBytes);
    await Deno.writeFile(catalogPath, assets.catalogBytes);
    const engineUrl = JSON.stringify(toFileUrl(enginePath).href);
    const catalogUrl = JSON.stringify(toFileUrl(catalogPath).href);
    const plugin = [
      `import { createDenoPlugin, createRuleRegistry, parseCatalog, TYPESCRIPT_RULE_PACK } from ${engineUrl};`,
      `import catalogJson from ${catalogUrl} with { type: "json" };`,
      `const catalog = parseCatalog(catalogJson, { scriptRuleSchemas: null, registry: createRuleRegistry(${
        JSON.stringify(UNSLOP_PLUGIN_NAME)
      }, [TYPESCRIPT_RULE_PACK]) });`,
      `export default createDenoPlugin(${
        JSON.stringify(UNSLOP_PLUGIN_NAME)
      }, catalog, { rulePacks: [TYPESCRIPT_RULE_PACK], selection: "" });`,
      "",
    ].join("\n");
    await Deno.writeTextFile(join(runDir, PLUGIN_FILENAME), plugin);
    await Deno.writeTextFile(
      join(runDir, DENO_CONFIG_FILENAME),
      JSON.stringify({ lock: false, lint: { plugins: [`./${PLUGIN_FILENAME}`], include: [], exclude: [] } }),
    );
  }

  /** Runs every lint batch and returns the retained raw findings, or a categorical error. */
  private async lintBatches(
    context: IUnslopCheckContext,
    runDir: string,
    files: readonly string[],
    assets: IUnslopAssets,
    ranges: ReadonlyMap<string, readonly IGitLineRange[]>,
  ): Promise<{ findings: IUnslopFinding[] } | IUnslopCheckOutcome> {
    const batches = this.batchFiles(files);
    const { env, clearEnv } = buildVerificationCheckEnv();
    const deadline = Date.now() + context.timeoutMs;
    const findings: IUnslopFinding[] = [];
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
      const normalized = await this.normalizeDiagnostics(context, result.diagnostics, files, assets, ranges);
      if (!Array.isArray(normalized)) return normalized;
      findings.push(...normalized);
    }
    return { findings };
  }

  /** Splits files into batches that respect the file count and encoded argv budgets. */
  private batchFiles(files: readonly string[]): readonly (readonly string[])[] {
    const batches: string[][] = [];
    let current: string[] = [];
    let bytes = 0;
    for (const file of files) {
      const operand = `./${file}`;
      const encoded = new TextEncoder().encode(operand).byteLength + 1;
      const exceedsCount = current.length >= this.options.settings.batch_max_files;
      const exceedsBytes = bytes + encoded > this.options.settings.argv_max_bytes;
      if (current.length > 0 && (exceedsCount || exceedsBytes)) {
        batches.push(current);
        current = [];
        bytes = 0;
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
    const findings: IUnslopFinding[] = [];
    for (const diagnostic of diagnostics) {
      const file = await hostRepoPath(context.executionRoot, diagnostic.filename);
      if (file === null || !selectedSet.has(file)) return errorOutcome(UnslopErrorClass.HOST_PROTOCOL_INVALID);
      if (!assets.ruleIds.has(diagnostic.code)) return errorOutcome(UnslopErrorClass.HOST_PROTOCOL_INVALID);
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
    raw: readonly IUnslopFinding[],
  ): IUnslopCheckOutcome {
    const unique = new Map<string, IUnslopFinding>();
    for (const finding of raw) {
      const key = `${finding.file}\u0000${finding.start_line}\u0000${finding.start_column}\u0000${finding.rule}`;
      if (!unique.has(key)) unique.set(key, finding);
    }
    const sorted = [...unique.values()].sort((left, right) =>
      left.file.localeCompare(right.file) ||
      left.start_line - right.start_line ||
      left.start_column - right.start_column ||
      left.rule.localeCompare(right.rule)
    );
    if (sorted.length === 0) return passedOutcome();
    const capped = sorted.slice(0, this.options.settings.findings_limit);
    const text = capped.map((finding) => `${finding.file}:${finding.start_line} ${finding.rule}`).join("\n");
    const output = prepareVerificationOutput(
      text,
      context.outputMaxChars,
      this.options.knownSecrets ?? [],
    );
    return {
      kind: VerificationStatus.FAILED,
      hostExitCodes: [1],
      total: sorted.length,
      findings: capped,
      output,
    };
  }

  private emitStarted(context: IUnslopCheckContext): Promise<void> {
    return this.emit(DomainEventType.ExecutionVerificationLintCheckStarted, context, {
      request_id: context.requestId,
      run_id: context.runId,
      attempt: context.attempt,
      check_index: context.checkIndex,
      target_sha: context.targetSha,
    });
  }

  private emitCompleted(context: IUnslopCheckContext, outcome: IUnslopCheckOutcome): Promise<void> {
    return this.emit(DomainEventType.ExecutionVerificationLintCheckCompleted, context, {
      request_id: context.requestId,
      run_id: context.runId,
      attempt: context.attempt,
      check_index: context.checkIndex,
      target_sha: context.targetSha,
      outcome: outcome.kind,
      total: outcome.total,
      error_class: outcome.kind === VerificationStatus.ERROR ? outcome.error_class : null,
    });
  }

  private emit(
    action: typeof DomainEventType[keyof typeof DomainEventType],
    context: IUnslopCheckContext,
    payload: LogMetadata,
  ): Promise<void> {
    return this.options.logger.info(action, null, payload, context.traceId);
  }
}

/** Extracts the selected catalog rule ids. Null means invalid catalog JSON. */
function parseCatalogRuleIds(bytes: Uint8Array): ReadonlySet<string> | null {
  const text = decodeUtf8(bytes);
  if (text === null) return null;
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof document !== "object" || document === null) return null;
  const rules = (document as Record<string, unknown>).rules;
  if (typeof rules !== "object" || rules === null) return null;
  return new Set(Object.keys(rules));
}
