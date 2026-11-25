#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL0VocabularySymbols
 * @path scripts/go_port/core_l0_vocabulary_symbols.ts
 * @description Reads the runtime value of every kept core vocabulary symbol and encodes it as tagged JSON for the Go reference fixture.
 * Usage: imported by the Go-port scripts.
 */
import { join } from "@std/path";
import * as CoreRoot from "@exaix/core";
import * as CoreTypes from "@exaix/core/types";

/** A JSON value that may also carry the tags that stand for a pattern, a set or an absent value. */
export type TTaggedJson = string | number | boolean | null | readonly TTaggedJson[] | {
  readonly [key: string]: TTaggedJson;
};

/** A runtime value that a core module exports. */
export type TRuntimeValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | RegExp
  | ReadonlySet<TRuntimeValue>
  | readonly TRuntimeValue[]
  | { readonly [key: string]: TRuntimeValue };

/** A module namespace, which also exports functions and typed records next to its values. */
interface IRuntimeModule {
  // deno-lint-ignore exaix/no-unsafe-dictionary -- A module namespace mixes values, functions and typed records.
  readonly [symbol: string]: TRuntimeValue | object;
}

export interface IVocabularySymbolRow {
  readonly module: string;
  readonly symbol: string;
  readonly kind: string;
  readonly target: string;
  readonly value: TTaggedJson;
}

interface IInventoryEntry {
  readonly module: string;
  readonly symbol: string;
  readonly kind: string;
  readonly class: string;
  readonly step?: number;
  readonly evidence: { readonly target?: string };
}

const KEPT_VOCABULARY_STEP = 3;
const INVENTORY_PATH = join("exaix-go", "port", "inventory", "core-l0.json");
const NUMERIC_KEY = /^-?\d+$/;
const ENUM_KIND = "enum";

function encodeObject(value: { readonly [key: string]: TRuntimeValue }): TTaggedJson {
  const out: { [key: string]: TTaggedJson } = {};
  for (const [key, member] of Object.entries(value)) out[key] = encodeValue(member);
  return out;
}

/** Encodes a runtime value as JSON, tagging the values that JSON cannot carry. */
function encodeValue(value: TRuntimeValue): TTaggedJson {
  if (value === undefined) return { $undefined: true };
  if (value instanceof RegExp) return { $regexp: value.source, flags: value.flags };
  if (value instanceof Set) return { $set: [...value].map(encodeValue) };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (typeof value === "object" && value !== null) {
    return encodeObject(value as { readonly [key: string]: TRuntimeValue });
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Unsupported non-finite number");
  return value as TTaggedJson;
}

/** Returns the enum members without the reverse mapping that a numeric TypeScript enum adds. */
function enumMembers(value: { readonly [key: string]: TRuntimeValue }): { readonly [key: string]: TRuntimeValue } {
  const members: { [key: string]: TRuntimeValue } = {};
  for (const [key, member] of Object.entries(value)) {
    if (!NUMERIC_KEY.test(key)) members[key] = member;
  }
  return members;
}

const RUNTIME_EXPORTS: IRuntimeModule = { ...CoreRoot, ...CoreTypes };

/** Builds one fixture row per kept vocabulary inventory entry, in inventory order. */
export async function buildVocabularySymbols(root: string): Promise<IVocabularySymbolRow[]> {
  const inventory = JSON.parse(await Deno.readTextFile(join(root, INVENTORY_PATH))) as { entries: IInventoryEntry[] };
  const kept = inventory.entries.filter((e) => e.class === "keep" && e.step === KEPT_VOCABULARY_STEP);
  const rows: IVocabularySymbolRow[] = [];
  for (const entry of kept) {
    const raw = RUNTIME_EXPORTS[entry.symbol] as TRuntimeValue;
    if (raw === undefined) throw new Error(`The core barrels do not export ${entry.symbol}`);
    const value = entry.kind === ENUM_KIND ? enumMembers(raw as { readonly [key: string]: TRuntimeValue }) : raw;
    rows.push({
      module: entry.module,
      symbol: entry.symbol,
      kind: entry.kind,
      target: entry.evidence.target ?? "",
      value: encodeValue(value),
    });
  }
  return rows;
}

const CONFIGURABLE_CONSTANT = /export const (\w+)\b[^=]*=\s*configurable(?:<[^>]*>)?\(\{\s*key:\s*"([^"]+)"/g;

/** Maps each exported constant that wraps a configurable() default to its config key. */
export function extractConfigKeys(source: string): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const match of source.matchAll(CONFIGURABLE_CONSTANT)) keys.set(match[1], match[2]);
  return keys;
}
