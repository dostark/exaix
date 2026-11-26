#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL0VocabularySymbols
 * @path scripts/go_port/core_l0_vocabulary_symbols.ts
 * @description Reads the runtime value of every kept core vocabulary symbol and encodes it as tagged JSON for the Go reference fixture.
 * Usage: imported by the Go-port scripts.
 */
import { join } from "@std/path";
import { z } from "zod";
import * as CoreRoot from "@exaix/core";
import * as CoreTypes from "@exaix/core/types";

/** A JSON value that may also carry the tags that stand for a pattern, a set or an absent value. */
export type TTaggedJson = string | number | boolean | null | readonly TTaggedJson[] | {
  readonly [key: string]: TTaggedJson;
};

type TRuntimeValue = string | number | boolean | null | undefined | object;

export interface IVocabularySymbolRow {
  readonly module: string;
  readonly symbol: string;
  readonly kind: string;
  readonly target: string;
  readonly value: TTaggedJson;
}

const KEPT_VOCABULARY_STEP = 3;
const INVENTORY_PATH = join("exaix-go", "port", "inventory", "core-l0.json");
const NUMERIC_KEY = /^-?\d+$/;
const ENUM_KIND = "enum";

const INVENTORY = z.object({
  entries: z.array(z.object({
    module: z.string(),
    symbol: z.string(),
    kind: z.string(),
    class: z.string(),
    step: z.number().optional(),
    evidence: z.object({ target: z.string().optional() }),
  })),
});

/** Encodes a runtime value as JSON, tagging the values that JSON cannot carry. */
function encodeValue(value: TRuntimeValue): TTaggedJson {
  if (value === undefined) return { $undefined: true };
  if (value === null) return null;
  if (value instanceof RegExp) return { $regexp: value.source, flags: value.flags };
  if (value instanceof Set) return { $set: [...value].map(encodeValue) };
  if (Array.isArray(value)) return value.map(encodeValue);
  switch (typeof value) {
    case "object":
      return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, encodeValue(member)]));
    case "number":
      if (!Number.isFinite(value)) throw new Error("Unsupported non-finite number");
      return value;
    case "string":
    case "boolean":
      return value;
    default:
      throw new Error("Unsupported vocabulary value");
  }
}

/** Returns the enum members without the reverse mapping that a numeric TypeScript enum adds. */
function encodeEnum(value: TRuntimeValue): TTaggedJson {
  const members = z.record(z.string(), z.union([z.string(), z.number()])).parse(value);
  return Object.fromEntries(Object.entries(members).filter(([key]) => !NUMERIC_KEY.test(key)));
}

const RUNTIME_EXPORTS = new Map<string, TRuntimeValue>(Object.entries({ ...CoreRoot, ...CoreTypes }));

/** Builds one fixture row per kept vocabulary inventory entry, in inventory order. */
export async function buildVocabularySymbols(root: string): Promise<IVocabularySymbolRow[]> {
  const inventory = INVENTORY.parse(JSON.parse(await Deno.readTextFile(join(root, INVENTORY_PATH))));
  const kept = inventory.entries.filter((e) => e.class === "keep" && e.step === KEPT_VOCABULARY_STEP);
  const rows: IVocabularySymbolRow[] = [];
  for (const entry of kept) {
    const raw = RUNTIME_EXPORTS.get(entry.symbol);
    if (raw === undefined) throw new Error(`The core barrels do not export ${entry.symbol}`);
    rows.push({
      module: entry.module,
      symbol: entry.symbol,
      kind: entry.kind,
      target: entry.evidence.target ?? "",
      value: entry.kind === ENUM_KIND ? encodeEnum(raw) : encodeValue(raw),
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
