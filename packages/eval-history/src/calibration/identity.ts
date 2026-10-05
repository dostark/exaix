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

import type { JSONObject, JSONValue } from "@exaix/core/types";
import { ARTIFACT_CONTEXT_ASSEMBLY_VERSION, JUDGE_CONTEXT_ASSEMBLY_VERSION } from "./constants.ts";

export interface IContextAssemblyInput {
  kind: ContextAssemblyKind;
  sources: Record<string, string>;
  dynamicAssets: string[];
  effectiveConfiguration: JSONObject;
}

export interface IContextAssemblyIdentity {
  readonly kind: ContextAssemblyKind;
  readonly version: string;
  readonly digest: string;
  readonly input_map: {
    readonly sources: Record<string, string>;
    readonly dynamic_assets: string[];
    readonly configuration: JSONObject;
  };
}

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

export enum ContextAssemblyKind {
  Artifact = "artifact",
  Judge = "judge",
}

const SECRET_CONFIGURATION_KEY: RegExp = /(?:^|[_-])(password|secret|token|api[_-]?key)(?:$|[_-])/i;

function validateAssemblyPath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\u0000")) {
    throw new CalibrationCanonicalizationError("calibration-assembly-invalid-path");
  }
  if (path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new CalibrationCanonicalizationError("calibration-assembly-invalid-path");
  }
}

function freezeNonsecretConfiguration(value: JSONValue): void {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_CONFIGURATION_KEY.test(key)) {
      throw new CalibrationCanonicalizationError("calibration-assembly-secret-configuration");
    }
    freezeNonsecretConfiguration(child);
  }
  Object.freeze(value);
}

/** Hashes an explicitly collected assembly input closure without adding per-item submission data. */
export async function buildContextAssemblyIdentity(input: IContextAssemblyInput): Promise<IContextAssemblyIdentity> {
  const paths: string[] = Object.keys(input.sources).sort();
  if (paths.length === 0 || !Object.values(ContextAssemblyKind).includes(input.kind)) {
    throw new CalibrationCanonicalizationError("calibration-assembly-missing-inputs");
  }
  const dynamicAssets: string[] = [...input.dynamicAssets].sort();
  if (new Set(dynamicAssets).size !== dynamicAssets.length) {
    throw new CalibrationCanonicalizationError("calibration-assembly-duplicate-asset");
  }
  for (const asset of dynamicAssets) {
    validateAssemblyPath(asset);
    if (!Object.hasOwn(input.sources, asset)) {
      throw new CalibrationCanonicalizationError("calibration-assembly-unresolved-asset");
    }
  }
  const sources: Record<string, string> = {};
  for (const path of paths) {
    validateAssemblyPath(path);
    if (typeof input.sources[path] !== "string" || !input.sources[path]) {
      throw new CalibrationCanonicalizationError("calibration-assembly-unreadable-input");
    }
    sources[path] = await sha256Hex(input.sources[path]);
  }
  canonicalJsonStringify(input.effectiveConfiguration);
  const configuration: JSONObject = structuredClone(input.effectiveConfiguration);
  freezeNonsecretConfiguration(configuration);
  const version: string = input.kind === ContextAssemblyKind.Artifact
    ? ARTIFACT_CONTEXT_ASSEMBLY_VERSION
    : JUDGE_CONTEXT_ASSEMBLY_VERSION;
  const inputMap = Object.freeze({
    sources: Object.freeze(sources),
    dynamic_assets: Object.freeze(dynamicAssets) as string[],
    configuration,
  });
  const digest: string = await hashCalibrationValue({ kind: input.kind, version, input_map: inputMap });
  return Object.freeze({ kind: input.kind, version, digest, input_map: inputMap });
}
