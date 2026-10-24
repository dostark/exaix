/**
 * @module GitQueries
 * @path packages/git/src/git_queries.ts
 * @related-files [packages/git/tests/git_queries_test.ts]
 * @architectural-layer Services
 * @description Read-only git queries over an IGitService. Callers use them so the git subcommand constants stay inside this package.
 */

import type { IGitService, Opt, Reason } from "@exaix/core/types";
import {
  GIT_CMD_CAT_FILE,
  GIT_CMD_DIFF,
  GIT_CMD_LS_TREE,
  GIT_CMD_REV_PARSE,
  GIT_COMMIT_PEEL_SUFFIX,
  GIT_FLAG_DIFF_ALGORITHM_MYERS,
  GIT_FLAG_DIFF_FILTER_AMT,
  GIT_FLAG_LITERAL_PATHSPECS,
  GIT_FLAG_NAME_ONLY,
  GIT_FLAG_NAME_STATUS,
  GIT_FLAG_NO_COLOR,
  GIT_FLAG_NO_EXT_DIFF,
  GIT_FLAG_NO_INDENT_HEURISTIC,
  GIT_FLAG_NO_RENAMES,
  GIT_FLAG_NO_TEXT_CONV,
  GIT_FLAG_NUL,
  GIT_FLAG_TEXT,
  GIT_FLAG_UNIFIED_ZERO,
  GIT_FLAG_VERIFY,
} from "./constants.ts";
import { GitOutputLimitError, GitTimeoutError } from "./git_service.ts";

/** Byte cap of one strict query when the caller sets none. */
const DEFAULT_GIT_QUERY_MAX_OUTPUT_BYTES = 16_777_216;

/** Returns the current HEAD sha of the repo, or an empty string when it is unreadable. */
export async function readHeadSha(gitService: IGitService): Promise<string> {
  const result = await gitService.runGitCommand([GIT_CMD_REV_PARSE, "HEAD"], { throwOnError: false });
  return result.exitCode === 0 ? result.output.trim() : "";
}

/** Returns the repo-relative paths changed between two commits. The list is empty when they are equal or the diff fails. */
export async function listChangedFilesBetween(
  gitService: IGitService,
  before: string,
  after: string,
): Promise<string[]> {
  if (!before || !after || before === after) return [];
  const result = await gitService.runGitCommand([GIT_CMD_DIFF, GIT_FLAG_NAME_ONLY, before, after], {
    throwOnError: false,
  });
  if (result.exitCode !== 0) return [];
  return result.output.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

/** The closed failure codes of a strict verification query. */
/** Every strict query runs with categorical audit so no raw path reaches a Git event. */
const QUERY_AUDIT_MODE = "categorical" as const;

const QUERY_FAILURE_CODE = {
  invalidObject: "invalid_object",
  queryFailed: "query_failed",
  outputLimit: "output_limit",
  deadlineExceeded: "deadline_exceeded",
  invalidOutput: "invalid_output",
  invalidMode: "invalid_mode",
  limitExceeded: "limit_exceeded",
} as const;

export type GitQueryFailureCode = (typeof QUERY_FAILURE_CODE)[keyof typeof QUERY_FAILURE_CODE];

export interface IGitQueryFailure {
  readonly ok: false;
  readonly code: GitQueryFailureCode;
}

export type GitQueryResult<T> = { readonly ok: true; readonly value: T } | IGitQueryFailure;

/** One changed source the strict discovery selected. */
export interface IGitChangedSource {
  readonly path: string;
  readonly status: "added" | "modified" | "type_changed";
}

/** One closed changed-line interval on the destination side. */
export interface IGitLineRange {
  readonly start: number;
  readonly end: number;
}

/** One regular blob read at an immutable commit. */
export interface IGitBlob {
  readonly bytes: Uint8Array;
  readonly mode: string;
}

export interface IGitCommitQueryOptions {
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
}

export interface IGitChangedSourcesOptions {
  readonly extensions: readonly string[];
  readonly maxFiles: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs?: number;
}

export interface IGitLineRangeOptions {
  readonly maxOutputBytes: number;
  readonly timeoutMs?: number;
}

export interface IGitBlobOptions {
  readonly maxBytes: number;
  readonly timeoutMs?: number;
}

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);
const NUL = "\0";
const QUERY_STATUS = new Map<string, IGitChangedSource["status"]>([
  ["A", "added"],
  ["M", "modified"],
  ["T", "type_changed"],
]);
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DIFF_HEADER = "diff --git ";
const BINARY_MARKER = "Binary files ";
const BINARY_PATCH_MARKER = "GIT binary patch";

function queryFailure(code: GitQueryFailureCode): IGitQueryFailure {
  return { ok: false, code };
}

function failureFromError(error: unknown): IGitQueryFailure {
  if (error instanceof GitOutputLimitError) return queryFailure(QUERY_FAILURE_CODE.outputLimit);
  if (error instanceof GitTimeoutError) return queryFailure(QUERY_FAILURE_CODE.deadlineExceeded);
  return queryFailure(QUERY_FAILURE_CODE.queryFailed);
}

/** True when `value` is an exact full repository object id. */
export function isFullObjectId(value: string): boolean {
  return FULL_OBJECT_ID.test(value);
}

/** True when a path is repo-relative POSIX with no escape or NUL. */
export function isSafeRepoRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes(NUL) || path.includes("\\")) return false;
  if (path.startsWith("/")) return false;
  return !path.split("/").includes("..");
}

/** Decodes strict UTF-8, or returns null for invalid bytes. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** True when any closed changed range intersects the closed `[startLine, endLine]` interval. */
export function intersectsChangedLines(
  ranges: readonly IGitLineRange[],
  startLine: number,
  endLine: number,
): boolean {
  return ranges.some((range) => startLine <= range.end && endLine >= range.start);
}

/** Resolves an exact object id to its immutable commit id. Ref expressions are rejected. */
export async function resolveImmutableCommit(
  gitService: IGitService,
  objectId: string,
  options: Opt<IGitCommitQueryOptions, Reason.OptionalContext> = {},
): Promise<GitQueryResult<string>> {
  if (!isFullObjectId(objectId)) return queryFailure(QUERY_FAILURE_CODE.invalidObject);
  try {
    const result = await gitService.runGitCommand(
      [GIT_CMD_REV_PARSE, GIT_FLAG_VERIFY, `${objectId}${GIT_COMMIT_PEEL_SUFFIX}`],
      {
        maxOutputBytes: options.maxOutputBytes ?? DEFAULT_GIT_QUERY_MAX_OUTPUT_BYTES,
        timeoutMs: options.timeoutMs,
        auditMode: QUERY_AUDIT_MODE,
      },
    );
    const resolved = result.output.trim();
    return isFullObjectId(resolved) ? { ok: true, value: resolved } : queryFailure(QUERY_FAILURE_CODE.invalidOutput);
  } catch (error) {
    return failureFromError(error);
  }
}

/** Lists changed TypeScript sources between two immutable commits, NUL-safe and attribute-proof. */
export async function listChangedSources(
  gitService: IGitService,
  base: string,
  target: string,
  options: IGitChangedSourcesOptions,
): Promise<GitQueryResult<readonly IGitChangedSource[]>> {
  if (!isFullObjectId(base) || !isFullObjectId(target)) return queryFailure(QUERY_FAILURE_CODE.invalidObject);
  if (base === target) return { ok: true, value: [] };
  try {
    const result = await gitService.runGitCommand(
      [
        GIT_FLAG_LITERAL_PATHSPECS,
        GIT_CMD_DIFF,
        GIT_FLAG_NAME_STATUS,
        GIT_FLAG_NUL,
        GIT_FLAG_NO_RENAMES,
        GIT_FLAG_NO_EXT_DIFF,
        GIT_FLAG_NO_TEXT_CONV,
        GIT_FLAG_DIFF_FILTER_AMT,
        base,
        target,
      ],
      { maxOutputBytes: options.maxOutputBytes, timeoutMs: options.timeoutMs, auditMode: QUERY_AUDIT_MODE },
    );
    const sources: IGitChangedSource[] = [];
    const fields = result.output.split(NUL);
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const letter = fields[index];
      const path = fields[index + 1];
      if (letter.length === 0 && path.length === 0) continue;
      const status = QUERY_STATUS.get(letter);
      if (status === undefined) return queryFailure(QUERY_FAILURE_CODE.invalidOutput);
      if (!isSafeRepoRelativePath(path)) return queryFailure(QUERY_FAILURE_CODE.invalidOutput);
      if (!options.extensions.some((extension) => path.endsWith(extension))) continue;
      sources.push({ path, status });
    }
    if (sources.length > options.maxFiles) return queryFailure(QUERY_FAILURE_CODE.limitExceeded);
    return { ok: true, value: sources };
  } catch (error) {
    return failureFromError(error);
  }
}

/** One parsed hunk header. Counts use the omitted-means-one rule. */
interface IHunkHeader {
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
}

/** Parses one `@@` header, or null when the line is not a valid header. */
function parseHunkHeader(line: string): IHunkHeader | null {
  const match = HUNK_HEADER.exec(line);
  if (match === null) return null;
  const oldCount = match[2] === undefined ? 1 : Number(match[2]);
  const newStart = Number(match[3]);
  const newCount = match[4] === undefined ? 1 : Number(match[4]);
  if (!Number.isInteger(oldCount) || !Number.isInteger(newCount) || !Number.isInteger(newStart)) return null;
  return { oldCount, newStart, newCount };
}

/** Counts the added and removed lines of one hunk body. Null means a malformed body. */
function countHunkBody(
  lines: readonly string[],
  start: number,
): { added: number; removed: number; next: number } | null {
  let added = 0;
  let removed = 0;
  let index = start;
  while (index < lines.length && parseHunkHeader(lines[index]) === null) {
    const line = lines[index];
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
    else if (line.length > 0 && !line.startsWith("\\") && !line.startsWith(DIFF_HEADER)) return null;
    index++;
  }
  return { added, removed, next: index };
}

/** Parses `-U0` hunk headers into closed destination ranges. Null means a malformed patch. */
export function parseHunkRanges(patch: string): readonly IGitLineRange[] | null {
  if (patch.includes(BINARY_MARKER) || patch.includes(BINARY_PATCH_MARKER)) return null;
  const lines = patch.split("\n");
  const ranges: IGitLineRange[] = [];
  let index = 0;
  while (index < lines.length) {
    const header = parseHunkHeader(lines[index]);
    if (header === null) {
      index++;
      continue;
    }
    const body = countHunkBody(lines, index + 1);
    if (body === null) return null;
    if (body.added !== header.newCount || body.removed !== header.oldCount) return null;
    if (header.newCount > 0) {
      if (header.newStart < 1) return null;
      ranges.push({ start: header.newStart, end: header.newStart + header.newCount - 1 });
    }
    index = body.next;
  }
  return ranges;
}

/** Reads the closed changed-line ranges of one destination file. */
export async function readChangedLineRanges(
  gitService: IGitService,
  base: string,
  target: string,
  path: string,
  options: IGitLineRangeOptions,
): Promise<GitQueryResult<readonly IGitLineRange[]>> {
  if (!isFullObjectId(base) || !isFullObjectId(target)) return queryFailure(QUERY_FAILURE_CODE.invalidObject);
  if (!isSafeRepoRelativePath(path)) return queryFailure(QUERY_FAILURE_CODE.invalidObject);
  if (base === target) return { ok: true, value: [] };
  try {
    const result = await gitService.runGitCommand(
      [
        GIT_FLAG_LITERAL_PATHSPECS,
        GIT_CMD_DIFF,
        GIT_FLAG_NO_RENAMES,
        GIT_FLAG_NO_EXT_DIFF,
        GIT_FLAG_NO_TEXT_CONV,
        GIT_FLAG_TEXT,
        GIT_FLAG_NO_COLOR,
        GIT_FLAG_NO_INDENT_HEURISTIC,
        GIT_FLAG_DIFF_ALGORITHM_MYERS,
        GIT_FLAG_UNIFIED_ZERO,
        base,
        target,
        "--",
        path,
      ],
      { maxOutputBytes: options.maxOutputBytes, timeoutMs: options.timeoutMs, auditMode: QUERY_AUDIT_MODE },
    );
    const sections = result.output.split(DIFF_HEADER).length - 1;
    if (sections > 1) return queryFailure(QUERY_FAILURE_CODE.invalidOutput);
    const ranges = parseHunkRanges(result.output);
    return ranges === null ? queryFailure(QUERY_FAILURE_CODE.invalidOutput) : { ok: true, value: ranges };
  } catch (error) {
    return failureFromError(error);
  }
}

/** Reads one regular blob at an immutable commit. Symlinks and other modes are rejected. */
export async function readBlobAtCommit(
  gitService: IGitService,
  commit: string,
  path: string,
  options: IGitBlobOptions,
): Promise<GitQueryResult<IGitBlob>> {
  if (!isFullObjectId(commit)) return queryFailure(QUERY_FAILURE_CODE.invalidObject);
  if (!isSafeRepoRelativePath(path)) return queryFailure(QUERY_FAILURE_CODE.invalidObject);
  let mode: string;
  let type: string;
  let objectId: string;
  try {
    const listed = await gitService.runGitCommand([GIT_CMD_LS_TREE, GIT_FLAG_NUL, commit, "--", path], {
      maxOutputBytes: DEFAULT_GIT_QUERY_MAX_OUTPUT_BYTES,
      timeoutMs: options.timeoutMs,
      auditMode: QUERY_AUDIT_MODE,
    });
    const entry = listed.output.replace(new RegExp(`${NUL}$`), "");
    const separator = entry.indexOf("\t");
    if (separator < 0) return queryFailure(QUERY_FAILURE_CODE.queryFailed);
    const meta = entry.slice(0, separator).split(" ");
    [mode, type, objectId] = [meta[0], meta[1], meta[2]];
    if (entry.slice(separator + 1) !== path) return queryFailure(QUERY_FAILURE_CODE.invalidOutput);
    if (!isFullObjectId(objectId)) return queryFailure(QUERY_FAILURE_CODE.invalidOutput);
  } catch (error) {
    return failureFromError(error);
  }
  if (type !== "blob" || !REGULAR_BLOB_MODES.has(mode)) return queryFailure(QUERY_FAILURE_CODE.invalidMode);
  try {
    const blob = await gitService.runGitCommand([GIT_CMD_CAT_FILE, "blob", objectId], {
      maxOutputBytes: options.maxBytes,
      timeoutMs: options.timeoutMs,
      auditMode: QUERY_AUDIT_MODE,
    });
    const bytes = blob.stdoutBytes ?? new TextEncoder().encode(blob.output);
    return { ok: true, value: { bytes, mode } };
  } catch (error) {
    return failureFromError(error);
  }
}
