#!/usr/bin/env -S deno run -A
/**
 * @module GoPortRecordPreload
 * @path scripts/go_port/conformance/adapters/record_preload.ts
 * @description Preload for `deno test`: records every input that a test passes to a keep schema, as one JSON line per call.
 * Usage: CORPUS_ROOT=<snapshot> CORPUS_KEEP=<keep.json> CORPUS_RECORD=<out.jsonl> deno test --preload record_preload.ts <tests>
 */
import { type IKeepEntry, loadSchemas, type TRaw } from "./raw_value.ts";

const root = Deno.env.get("CORPUS_ROOT") ?? "";
const keepFile = Deno.env.get("CORPUS_KEEP") ?? "";
const output = Deno.env.get("CORPUS_RECORD") ?? "";
const MAX_INPUT_BYTES = 65_536;

function serializable(input: TRaw): string | undefined {
  try {
    const text = JSON.stringify(input, (_key, value) => {
      if (value === undefined || typeof value === "function" || typeof value === "symbol") throw new Error("lossy");
      if (typeof value === "bigint" || value instanceof Date || value instanceof Map || value instanceof Set) {
        throw new Error("lossy");
      }
      return value;
    });
    return text === undefined || text.length > MAX_INPUT_BYTES ? undefined : text;
  } catch {
    return undefined;
  }
}

const entries: IKeepEntry[] = JSON.parse(await Deno.readTextFile(keepFile));
for (const registered of await loadSchemas(root, entries)) {
  for (const method of ["parse", "safeParse"] as const) {
    const original = registered.schema[method];
    Object.defineProperty(registered.target, method, {
      configurable: true,
      writable: true,
      value: (input: TRaw) => {
        const text = serializable(input);
        if (text !== undefined) {
          Deno.writeTextFileSync(output, `${JSON.stringify({ key: registered.key, input: text })}\n`, { append: true });
        }
        return original(input);
      },
    });
  }
}
