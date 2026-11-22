#!/usr/bin/env -S deno run -A
/**
 * @module GoPortSchemasEdges
 * @path scripts/go_port/conformance/schemas_edges.ts
 * @description Derives edge inputs of a schema corpus from one valid object: an omitted, null, empty, wrong-typed or unknown field and numeric boundaries.
 * Usage: imported by schemas_corpus.ts. It has no entry point of its own.
 */
import type { TJsonValue } from "../snapshot_manifest.ts";

export interface IEdge {
  readonly label: string;
  readonly value: TJsonValue;
}

/** Top-level inputs of the wrong shape for almost every schema, as JSON text. */
export const PROBES: readonly string[] = ["null", "42", '"x"', "[]", "true"];

const MAX_EDGE_FIELDS = 8;
const UNKNOWN_KEY = "__unknown_key__";
const LARGE_INTEGER = 9007199254740992;

interface IObject {
  readonly [key: string]: TJsonValue;
}

function isObject(value: TJsonValue): value is IObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeSpecific(key: string, value: TJsonValue): IEdge[] {
  if (typeof value === "string") {
    return [{ label: `empty-${key}`, value: "" }, { label: `wrong-type-${key}`, value: 123 }];
  }
  if (typeof value === "number") {
    return [
      { label: `zero-${key}`, value: 0 },
      { label: `negative-${key}`, value: -1 },
      { label: `fraction-${key}`, value: 1.5 },
      { label: `large-${key}`, value: LARGE_INTEGER },
      { label: `wrong-type-${key}`, value: "x" },
    ];
  }
  if (typeof value === "boolean") {
    return [{ label: `flip-${key}`, value: !value }, { label: `wrong-type-${key}`, value: "true" }];
  }
  if (Array.isArray(value)) return [{ label: `empty-${key}`, value: [] }, { label: `wrong-type-${key}`, value: "x" }];
  if (isObject(value)) return [{ label: `empty-${key}`, value: {} }, { label: `wrong-type-${key}`, value: [] }];
  return [];
}

/** Returns edge inputs in a fixed order. A base that is not an object has none. */
export function deriveEdges(base: TJsonValue): IEdge[] {
  if (!isObject(base)) return [];
  const edges: IEdge[] = [{ label: "unknown-key", value: { ...base, [UNKNOWN_KEY]: 1 } }];
  for (const key of Object.keys(base).slice(0, MAX_EDGE_FIELDS)) {
    const without = Object.fromEntries(Object.entries(base).filter(([name]) => name !== key));
    edges.push({ label: `omit-${key}`, value: without }, { label: `null-${key}`, value: { ...base, [key]: null } });
    for (const variant of typeSpecific(key, base[key])) {
      edges.push({ label: variant.label, value: { ...base, [key]: variant.value } });
    }
  }
  return edges;
}
