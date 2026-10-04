/**
 * @module JournalIntegrity
 * @path packages/storage-sqlite/src/journal_integrity.ts
 * @description Tamper-evidence hash chain for the Solo activity journal. Each new row links
 * to the previous row by SHA-256, so an accepted write cannot be silently edited or removed.
 * The chain makes tampering detectable, not impossible. Verification never throws.
 * @architectural-layer Storage
 * @related-files [packages/storage-sqlite/src/database_service.ts, apps/exactl/src/commands/journal_commands.ts]
 */

import { createHash } from "node:crypto";
import type { IJournalIntegrityResult } from "@exaix/core/types";

/** A stored activity row projected for chain verification, in rowid order. */
export interface IActivityChainRow {
  id: string;
  trace_id: string;
  actor: string;
  action_type: string;
  timestamp: string;
  payload: string;
  prev_hash: string | null;
  row_hash: string | null;
}

/** The non-link fields that feed one row's hash. */
export interface IActivityHashInput {
  id: string;
  trace_id: string;
  actor: string;
  action_type: string;
  timestamp: string;
  payload_digest: string;
}

/** Linkage of the first hashed row. The empty string is distinct from a SQL NULL. */
export const JOURNAL_CHAIN_GENESIS = "";

/** SHA-256 of a string, lowercase hex. Synchronous so it can run inside a write
 *  transaction without yielding (an await there lets two flushes interleave). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Digest of one activity payload. The security-audit payload_digest reuses this scheme. */
export function computePayloadDigest(payload: string): string {
  return sha256Hex(payload);
}

/** row_hash = SHA-256 of the newline-joined prev_hash and row fields. */
export function computeRowHash(prevHash: string, input: IActivityHashInput): string {
  return sha256Hex([
    prevHash,
    input.id,
    input.trace_id,
    input.actor,
    input.action_type,
    input.timestamp,
    input.payload_digest,
  ].join("\n"));
}

function broken(
  rowsChecked: number,
  unhashedPrefix: number,
  firstBrokenId: string,
  expectedHash: string | null,
  actualHash: string | null,
): IJournalIntegrityResult {
  return {
    ok: false,
    rows_checked: rowsChecked,
    unhashed_prefix: unhashedPrefix,
    first_broken_id: firstBrokenId,
    expected_hash: expectedHash,
    actual_hash: actualHash,
  };
}

/** Recompute the chain over rows ordered by rowid and report the first broken link. Rows
 *  before the chain existed carry NULL hashes and are counted as an unverifiable prefix. */
export function verifyActivityChain(
  rows: readonly IActivityChainRow[],
): IJournalIntegrityResult {
  let unhashedPrefix = 0;
  let start = 0;
  while (start < rows.length && rows[start].row_hash === null) {
    unhashedPrefix++;
    start++;
  }

  let expectedPrev = JOURNAL_CHAIN_GENESIS;
  let rowsChecked = 0;
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    if (row.row_hash === null) {
      return broken(rowsChecked, unhashedPrefix, row.id, expectedPrev, null);
    }
    if (row.prev_hash !== expectedPrev) {
      return broken(rowsChecked, unhashedPrefix, row.id, expectedPrev, row.prev_hash);
    }
    const payloadDigest = computePayloadDigest(row.payload);
    const recomputed = computeRowHash(row.prev_hash, {
      id: row.id,
      trace_id: row.trace_id,
      actor: row.actor,
      action_type: row.action_type,
      timestamp: row.timestamp,
      payload_digest: payloadDigest,
    });
    if (recomputed !== row.row_hash) {
      return broken(rowsChecked, unhashedPrefix, row.id, recomputed, row.row_hash);
    }
    expectedPrev = row.row_hash;
    rowsChecked++;
  }

  return {
    ok: true,
    rows_checked: rowsChecked,
    unhashed_prefix: unhashedPrefix,
    first_broken_id: null,
    expected_hash: null,
    actual_hash: null,
  };
}
