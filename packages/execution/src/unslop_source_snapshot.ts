/**
 * @module UnslopSourceSnapshot
 * @path packages/execution/src/unslop_source_snapshot.ts
 * @description Validates lint operands against the immutable committed source snapshot.
 * @architectural-layer Services
 * @dependencies [@std/path, @exaix/git, @exaix/schemas]
 * @related-files [packages/execution/src/unslop_check_runner.ts, packages/execution/tests/unslop_check_runner_test.ts]
 */

import { join } from "@std/path";
import { decodeUtf8, readBlobAtCommit, readVerificationHead } from "@exaix/git";
import { UnslopErrorClass } from "@exaix/schemas";
import type { IUnslopCheckContext, IUnslopCheckRunnerOptions } from "./unslop_check_types.ts";
import { UnslopCheckError } from "./unslop_check_error.ts";

/** The fixed allocation ceiling of one bounded read chunk. */
const READ_CHUNK_BYTES = 65_536;

/** Reads at most maxBytes and refuses a growing or nonregular file. */
export async function readUnslopFile(path: string, maxBytes: number): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return null;
  const metadata = await Deno.lstat(path);
  if (!metadata.isFile || metadata.isSymlink) return null;
  if (metadata.size > maxBytes) throw new UnslopCheckError(UnslopErrorClass.LIMIT_EXCEEDED);
  using file = await Deno.open(path, { read: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const buffer = new Uint8Array(Math.min(READ_CHUNK_BYTES, maxBytes - total + 1));
    const count = await file.read(buffer);
    if (count === null) break;
    total += count;
    if (total > maxBytes) throw new UnslopCheckError(UnslopErrorClass.LIMIT_EXCEEDED);
    chunks.push(buffer.slice(0, count));
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Requires the current HEAD and every lint operand to match the committed target. */
export async function validateUnslopSnapshot(
  context: IUnslopCheckContext,
  options: IUnslopCheckRunnerOptions,
  files: readonly string[],
): Promise<UnslopErrorClass | null> {
  const head = await readVerificationHead(context.git, {
    maxOutputBytes: options.settings.git_max_bytes,
    timeoutMs: context.timeoutMs,
  });
  if (!head.ok || head.value !== context.targetSha) return UnslopErrorClass.SNAPSHOT_INVALID;
  for (const path of files) {
    const blob = await readBlobAtCommit(context.git, context.targetSha, path, {
      maxBytes: options.settings.file_max_bytes,
      timeoutMs: context.timeoutMs,
    });
    if (!blob.ok) {
      return blob.code === "output_limit" ? UnslopErrorClass.LIMIT_EXCEEDED : UnslopErrorClass.SNAPSHOT_INVALID;
    }
    const text = decodeUtf8(blob.value.bytes);
    if (text === null || text.includes("\0")) return UnslopErrorClass.SOURCE_INVALID;
    try {
      const resolved = await options.pathResolver.validatePath(join(context.executionRoot, path), [
        context.executionRoot,
      ]);
      const bytes = await readUnslopFile(resolved, options.settings.file_max_bytes);
      if (bytes === null || bytes.length !== blob.value.bytes.length) return UnslopErrorClass.SNAPSHOT_INVALID;
      if (!bytes.every((byte, index) => byte === blob.value.bytes[index])) return UnslopErrorClass.SNAPSHOT_INVALID;
    } catch (error) {
      return error instanceof UnslopCheckError ? error.errorClass : UnslopErrorClass.SNAPSHOT_INVALID;
    }
  }
  return null;
}

/** Reads bounded line lengths for validation of the host's source positions. */
export async function readUnslopLineLengths(
  context: IUnslopCheckContext,
  options: IUnslopCheckRunnerOptions,
  path: string,
): Promise<readonly number[] | null> {
  const confined = await options.pathResolver.validatePath(join(context.executionRoot, path), [context.executionRoot]);
  const bytes = await readUnslopFile(confined, options.settings.file_max_bytes);
  if (bytes === null) return null;
  const text = decodeUtf8(bytes);
  return text === null ? null : text.split("\n").map((line) => [...line].length);
}

/** Allows the host's zero-based boundary column and its one-based end-of-line position. */
export function isUnslopPositionWithinSource(
  position: { readonly line: number; readonly column: number },
  lengths: readonly number[],
): boolean {
  const length = lengths[position.line - 1];
  return length !== undefined && Number.isInteger(position.column) && position.column >= 0 &&
    position.column <= length + 1;
}
