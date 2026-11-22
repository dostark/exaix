#!/usr/bin/env -S deno run -A
/**
 * @module GoPortSynthesize
 * @path scripts/go_port/conformance/adapters/synthesize.ts
 * @description Builds a minimal valid input for a schema by repairing the issues that the schema itself reports. It gives up on a constraint it cannot satisfy.
 * Usage: imported by collect_inputs.ts. It has no entry point of its own.
 */
import type { IRawObject, ISchemaLike, TRaw } from "./raw_value.ts";

interface ISynthIssue {
  readonly code: string;
  readonly path: readonly (string | number | symbol)[];
  readonly expected?: string;
  readonly values?: readonly TRaw[];
  readonly origin?: string;
  readonly minimum?: number | bigint;
  readonly maximum?: number | bigint;
  readonly inclusive?: boolean;
  readonly format?: string;
  readonly keys?: readonly string[];
  readonly errors?: readonly (readonly ISynthIssue[])[];
}

const MAX_ROUNDS = 60;
const SAMPLE_STRINGS: readonly string[] = [
  "x",
  "main",
  "feature-x",
  "a/b",
  "1",
  "x.md",
  "X1",
  "a_b",
  "https://example.com",
];
const FORMATS: { readonly [format: string]: string } = {
  uuid: "00000000-0000-4000-8000-000000000000",
  guid: "00000000-0000-4000-8000-000000000000",
  email: "a@example.com",
  url: "https://example.com",
};

function placeholder(expected: string): TRaw | undefined {
  switch (expected) {
    case "string":
      return "x";
    case "number":
    case "int":
    case "integer":
      return 1;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
    case "record":
      return {};
    case "null":
      return null;
    default:
      return undefined;
  }
}

function setAt(root: TRaw, path: readonly (string | number | symbol)[], value: TRaw): TRaw {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const key = typeof head === "symbol" ? String(head) : head;
  const container: IRawObject | TRaw[] = typeof key === "number"
    ? (Array.isArray(root) ? [...root] : [])
    : (typeof root === "object" && root !== null && !Array.isArray(root) ? { ...(root as IRawObject) } : {});
  const current = (container as { [index: string]: TRaw })[String(key)];
  (container as { [index: string]: TRaw })[String(key)] = setAt(current, rest, value);
  return container;
}

function without(root: TRaw, path: readonly (string | number | symbol)[], names: readonly string[]): TRaw {
  const target = path.reduce<TRaw>((node, segment) => (node as { [index: string]: TRaw })?.[String(segment)], root);
  if (typeof target !== "object" || target === null || Array.isArray(target)) return root;
  const kept = Object.fromEntries(Object.entries(target as IRawObject).filter(([name]) => !names.includes(name)));
  return setAt(root, path, kept);
}

function samePath(a: readonly (string | number | symbol)[], b: readonly (string | number | symbol)[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

function repair(root: TRaw, issue: ISynthIssue, schema: ISchemaLike): TRaw | undefined {
  switch (issue.code) {
    case "invalid_type": {
      const value = placeholder(issue.expected ?? "");
      return value === undefined ? undefined : setAt(root, issue.path, value);
    }
    case "invalid_value":
      return issue.values && issue.values.length > 0 ? setAt(root, issue.path, issue.values[0]) : undefined;
    case "unrecognized_keys":
      return without(root, issue.path, issue.keys ?? []);
    case "invalid_format": {
      const sample = FORMATS[issue.format ?? ""];
      if (sample !== undefined) return setAt(root, issue.path, sample);
      for (const candidate of SAMPLE_STRINGS) {
        const attempt = setAt(root, issue.path, candidate);
        const remaining = schema.safeParse(attempt).error?.issues ?? [];
        if (!remaining.some((other) => other.code === "invalid_format" && samePath(other.path, issue.path))) {
          return attempt;
        }
      }
      return undefined;
    }
    case "too_small": {
      const size = Number(issue.minimum ?? 0) + (issue.inclusive === false ? 1 : 0);
      if (issue.origin === "string") return setAt(root, issue.path, "x".repeat(Math.max(size, 1)));
      if (issue.origin === "array") {
        return setAt(
          root,
          issue.path,
          Array.from({ length: Math.max(size, 1) }, () => null),
        );
      }
      if (issue.origin === "number" || issue.origin === "int") return setAt(root, issue.path, size);
      return undefined;
    }
    case "invalid_union": {
      const first = issue.errors?.[0]?.[0];
      return first ? repair(root, { ...first, path: [...issue.path, ...first.path] }, schema) : undefined;
    }
    default:
      return undefined;
  }
}

/** Returns a valid input as JSON text, or undefined when the repairs do not converge. */
export function synthesize(schema: ISchemaLike): string | undefined {
  let value: TRaw = {};
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = schema.safeParse(value);
    if (result.success) return JSON.stringify(value);
    const issues = (result.error?.issues ?? []) as readonly ISynthIssue[];
    let next: TRaw | undefined;
    for (const issue of issues) {
      next = repair(value, issue, schema);
      if (next !== undefined) break;
    }
    if (next === undefined || JSON.stringify(next) === JSON.stringify(value)) return undefined;
    value = next;
  }
  return undefined;
}
