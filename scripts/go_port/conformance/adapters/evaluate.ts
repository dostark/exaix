#!/usr/bin/env -S deno run -A
/**
 * @module GoPortEvaluate
 * @path scripts/go_port/conformance/adapters/evaluate.ts
 * @description Runs the reference schemas on corpus inputs and prints the reference outcome of each case as JSON.
 * Usage: TZ=UTC deno run --config <snapshot>/deno.json evaluate.ts <snapshot> <keep.json> <cases.json>
 */
import type { ICaseResultV2, IIssue } from "../generate.ts";
import type { TJsonValue } from "../../snapshot_manifest.ts";
import { type IInputDocument, type IKeepEntry, loadSchemas, normalize, type TRaw } from "./raw_value.ts";

interface IEvalCase {
  readonly id: string;
  readonly schema: string;
  readonly input: IInputDocument;
}

function errorName(error: Error): string {
  return error instanceof Error ? error.name : "Error";
}

async function parseInput(input: IInputDocument): Promise<TRaw> {
  if (input.kind === "json") return JSON.parse(input.content);
  if (input.kind === "text") return input.content;
  // deno-lint-ignore exaix/dynamic-import exaix/import-inside-statement -- only a yaml or toml case needs the parser, and a minimal snapshot has neither
  if (input.kind === "yaml") return (await import("@std/yaml")).parse(input.content) as TRaw;
  // deno-lint-ignore exaix/dynamic-import exaix/import-inside-statement -- only a yaml or toml case needs the parser, and a minimal snapshot has neither
  return (await import("@std/toml")).parse(input.content) as TRaw;
}

/** Replaces the host paths in a value, so a corpus does not depend on where the snapshot was cloned. */
function maskPaths(value: TJsonValue, masks: readonly (readonly [string, string])[]): TJsonValue {
  if (typeof value === "string") return masks.reduce((text, [path, mask]) => text.split(path).join(mask), value);
  if (Array.isArray(value)) return value.map((item) => maskPaths(item, masks));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, maskPaths(child, masks)]));
  }
  return value;
}

/** The instant that every evaluated schema sees as now. A schema that defaults a field to the current time then gives the same output on every run. */
const FIXED_NOW = Date.UTC(2026, 0, 1);

let uuidCounter = 0;

/** A schema that defaults a field to a random UUID gets the n-th fixed UUID of the case instead. */
function fixRandomUuid(): void {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
  });
}

function freezeClock(): void {
  globalThis.Date = new Proxy(Date, {
    construct: (target, args) => Reflect.construct(target, args.length === 0 ? [FIXED_NOW] : args),
    get: (target, property, receiver) => property === "now" ? () => FIXED_NOW : Reflect.get(target, property, receiver),
  });
}

async function main(): Promise<void> {
  freezeClock();
  fixRandomUuid();
  const [root, keepFile, casesFile] = Deno.args;
  const entries: IKeepEntry[] = JSON.parse(await Deno.readTextFile(keepFile));
  const cases: IEvalCase[] = JSON.parse(await Deno.readTextFile(casesFile));
  const schemas = new Map((await loadSchemas(root, entries)).map((item) => [item.key, item.schema]));
  const masks: (readonly [string, string])[] = [[root, "<ROOT>"]];
  const home = Deno.env.get("HOME");
  if (home) masks.push([home, "<HOME>"]);
  const results: (ICaseResultV2 & { parsed?: TJsonValue })[] = [];
  for (const item of cases) {
    const schema = schemas.get(item.schema);
    if (!schema) throw new Error(`unknown schema ${item.schema}`);
    let value: TRaw;
    try {
      value = await parseInput(item.input);
    } catch (error) {
      results.push({ id: item.id, reference: { kind: "error", category: errorName(error as Error) } });
      continue;
    }
    uuidCounter = 0;
    const parsedInput = normalize(value);
    try {
      const parsed = schema.safeParse(value);
      if (parsed.success) {
        results.push({
          id: item.id,
          reference: { kind: "value", value: maskPaths(normalize(parsed.data), masks) },
          parsed: parsedInput,
        });
      } else {
        const issues: IIssue[] = (parsed.error?.issues ?? []).map((issue) => ({
          path: issue.path.map((segment) => typeof segment === "symbol" ? String(segment) : segment),
          code: issue.code,
        }));
        results.push({ id: item.id, reference: { kind: "issues", issues }, parsed: parsedInput });
      }
    } catch (error) {
      results.push({ id: item.id, reference: { kind: "error", category: errorName(error as Error) } });
    }
  }
  console.log(JSON.stringify(results));
}

await main();
