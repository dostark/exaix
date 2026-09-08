/**
 * @module CalibrationIdentity
 * @path packages/eval-history/src/calibration/identity.ts
 * @description Canonical JSON serialization and SHA256 hashing for Phase 146 judge
 *   calibration identity (rubric/dataset/provenance/report/baseline content hashes).
 *   Pure — no provider or filesystem dependencies.
 * @architectural-layer Shared
 * @dependencies [@exaix/core]
 * @related-files [packages/eval-history/src/calibration/schema.ts, packages/flow/src/plan_digest.ts]
 */

import type { JSONValue } from "@exaix/core";

const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;

/** Lowercase 64-hex-character SHA256 digest shape used by every calibration identity field. */
export const SHA256_HEX_PATTERN: RegExp = /^[0-9a-f]{64}$/;

export class CalibrationCanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationCanonicalizationError";
  }
}

/** Deterministic JSON serialization for hashing: keys sorted recursively, arrays kept
 *  in order, `undefined`/non-finite numbers rejected, terminated with one LF. */
export function canonicalJsonStringify(value: JSONValue): string {
  return `${canonicalize(value)}\n`;
}

function canonicalize(value: JSONValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CalibrationCanonicalizationError(`Non-finite number cannot be canonicalized: ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeEntry(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const sortedKeys = Object.keys(value).sort();
    const entries = sortedKeys
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalizeEntry(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new CalibrationCanonicalizationError(`Value of type "${typeof value}" cannot be canonicalized`);
}

function canonicalizeEntry(value: JSONValue): string {
  if (value === undefined) {
    throw new CalibrationCanonicalizationError("undefined cannot appear inside a canonicalized array");
  }
  return canonicalize(value);
}

/** sha256 hex digest of `content`, matching {@link SHA256_HEX_PATTERN}. */
export async function sha256Hex(content: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0"))
    .join("");
}

/** Canonical-JSON-then-sha256 of `value`, the identity primitive every calibration hash builds on. */
export async function hashCalibrationValue(value: JSONValue): Promise<string> {
  return await sha256Hex(canonicalJsonStringify(value));
}
