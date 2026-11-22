#!/usr/bin/env -S deno run -A
/**
 * @module GoPortRawValue
 * @path scripts/go_port/conformance/adapters/raw_value.ts
 * @description Shared types and helpers of the schema corpus adapters. The adapters run inside a verified snapshot of the reference.
 * Usage: imported by collect_inputs.ts, evaluate.ts and record_preload.ts. It has no entry point of its own.
 */
import type { TJsonValue } from "../../snapshot_manifest.ts";
import type { TInputKind } from "../generate.ts";

export type TFunction = (...args: readonly never[]) => never;

export interface IRawObject {
  readonly [key: string]: TRaw;
}

/** Any value that a parser or a schema can hand back. */
export type TRaw =
  | string
  | number
  | boolean
  | null
  | undefined
  | bigint
  | symbol
  | Date
  | Uint8Array
  | TFunction
  | Map<TRaw, TRaw>
  | Set<TRaw>
  | readonly TRaw[]
  | IRawObject;

export interface IIssueLike {
  readonly path: readonly (string | number | symbol)[];
  readonly code: string;
}

export interface ISafeParse {
  readonly success: boolean;
  readonly data?: TRaw;
  readonly error?: { readonly issues: readonly IIssueLike[] };
}

export interface ISchemaLike {
  readonly parse: (input: TRaw) => TRaw;
  readonly safeParse: (input: TRaw) => ISafeParse;
}

export interface IKeepEntry {
  readonly module: string;
  readonly symbol: string;
}

export interface IRegistered extends IKeepEntry {
  readonly key: string;
  readonly schema: ISchemaLike;
  /** The exported object itself. A recorder patches its methods. */
  readonly target: IRawObject;
}

export interface IInputDocument {
  readonly kind: TInputKind;
  readonly content: string;
}

export function schemaKey(module: string, symbol: string): string {
  const stem = module.slice(module.lastIndexOf("/") + 1).replace(/\.ts$/, "");
  return `${stem}.${symbol}`;
}

function asSchema(value: TRaw): ISchemaLike | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<ISchemaLike>;
  return typeof candidate.parse === "function" && typeof candidate.safeParse === "function"
    ? { parse: candidate.parse.bind(value), safeParse: candidate.safeParse.bind(value) }
    : undefined;
}

/** Imports each keep entry from the snapshot and returns its schema object. */
export async function loadSchemas(root: string, entries: readonly IKeepEntry[]): Promise<IRegistered[]> {
  const result: IRegistered[] = [];
  const modules = new Map<string, IRawObject>();
  for (const entry of entries) {
    let loaded = modules.get(entry.module);
    if (!loaded) {
      // deno-lint-ignore exaix/dynamic-import exaix/import-inside-statement -- the module path is a verified snapshot file chosen at run time
      loaded = await import(`file://${root}/${entry.module}`);
      modules.set(entry.module, loaded ?? {});
    }
    const target = loaded?.[entry.symbol];
    const schema = asSchema(target);
    if (!schema || typeof target !== "object" || target === null) {
      throw new Error(`${entry.module}#${entry.symbol} is not a schema`);
    }
    result.push({ ...entry, key: schemaKey(entry.module, entry.symbol), schema, target: target as IRawObject });
  }
  return result;
}

/** Turns a value into JSON with tagged forms for what JSON cannot carry. The result is independent of the host. */
export function normalize(value: TRaw): TJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : { $number: String(value) };
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (typeof value === "undefined") return { $undefined: true };
  if (typeof value === "symbol") return { $symbol: value.description ?? "" };
  if (typeof value === "function") return { $function: true };
  if (value instanceof Date) return { $date: Number.isNaN(value.getTime()) ? null : value.toISOString() };
  if (value instanceof Uint8Array) return { $bytes: Array.from(value) };
  if (value instanceof Map) return { $map: Array.from(value.entries()).map(([k, v]) => [normalize(k), normalize(v)]) };
  if (value instanceof Set) return { $set: Array.from(value.values()).map(normalize) };
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : normalize(item)));
  const result: { [key: string]: TJsonValue } = {};
  for (const [key, child] of Object.entries(value as IRawObject)) {
    if (child !== undefined) result[key] = normalize(child);
  }
  return result;
}
