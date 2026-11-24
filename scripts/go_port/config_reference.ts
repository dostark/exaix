#!/usr/bin/env -S deno run -A
/**
 * @module GoPortConfigReference
 * @path scripts/go_port/config_reference.ts
 * @description Generates the configuration reference documents that the Go schemas tests compare with the pinned decoder.
 * It starts from the decoder defaults, adds a hand-written supplement for optional blocks, sets every leaf to a different value that the pinned decoder accepts, and records the decoder output for the defaults and for the result.
 * Usage: deno run -A scripts/go_port/config_reference.ts [--snapshot=<dir>] [--supplement=<file>] [--target=<dir>]
 */
import { dirname, join, resolve, toFileUrl } from "@std/path";
import { parse, stringify } from "@std/toml";
import { argValue } from "./cli_args.ts";
import { loadManifest, verifySnapshot } from "./conformance/generate.ts";
import { assertTargetAllowed, cloneSnapshot } from "./preserve_snapshot.ts";

export type JsonValue = string | number | boolean | null | JsonValue[] | IJsonObject;

export interface IJsonObject {
  [key: string]: JsonValue;
}

export interface IConfigReference {
  /** Authored configuration, ready for TOML serialization. */
  readonly authored: IJsonObject;
  /** Decoder output for the defaults-only configuration. */
  readonly defaults: IJsonObject;
  /** Decoder output for the authored configuration. */
  readonly reference: IJsonObject;
  /** Dotted paths of leaves that keep their default because the decoder rejects every alternative. */
  readonly unchanged: readonly string[];
}

const REPO_ROOT = resolve(join(import.meta.dirname ?? ".", "..", ".."));
const DEFAULT_TARGET = join("exaix-go", "internal", "schemas", "testdata", "config", "generated");
const DEFAULT_SUPPLEMENT = join("scripts", "go_port", "config_reference_supplement.toml");
const REFERENCE_REVISION = "a956e0c8";
/** Leaves that stay as written: the root is environment dependent and the round mode changes validation of siblings. */
const KEEP_LEAVES = ["system.root", "system.schema_version", "tools.parallel_calls"];

/** Runs inside the verified snapshot. It reads `{ supplement }` from the first argument file and prints the result as JSON. */
const ADAPTER = `const input = JSON.parse(await Deno.readTextFile(Deno.args[1]));
const { ConfigSchema } = await import(new URL("file://" + Deno.args[0] + "/packages/schemas/src/config.ts").href);
const ENUMS = ["heuristic","llm","hybrid","very_low","low","medium","high","very_high","standard","deep","adaptive","local","api","free","freemium","paid","user","agent","learned","core","project","file","database","execution","reject","approve","cheapest","reliability","native_first","user_order","debug","warn","error","stdio","http","sse","WAL","DELETE","TRUNCATE","MEMORY","blueprint","dogfood","fast","strict","block","allow","deny","throughput","latency","cost","json","text","full","summary"];
const KEEP = new Set(input.keep);
const clone = (value) => JSON.parse(JSON.stringify(value));
function merge(a, b) {
  if (b === undefined) return a;
  const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (plain(a) && plain(b)) {
    const out = { ...a };
    for (const [key, value] of Object.entries(b)) out[key] = merge(a[key], value);
    return out;
  }
  return b;
}
function candidates(value) {
  if (typeof value === "boolean") return [!value];
  if (typeof value === "number") {
    return Number.isInteger(value) ? [value + 1, value - 1, value * 2, Math.floor(value / 2), value + 7] : [value * 0.5, value * 0.9, value + 0.5, value * 2, 0.5];
  }
  if (typeof value === "string") return [value + "x", ...ENUMS.filter((e) => e !== value), "alt-" + value];
  if (Array.isArray(value) && value.every((e) => typeof e === "string")) return [[...value, "extra"], ["only"], value.slice(0, -1)];
  return [];
}
function collect(value, path, leaves) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) collect(child, [...path, key], leaves);
  } else if (Array.isArray(value) && value.length && value.every((e) => e && typeof e === "object")) {
    value.forEach((item, index) => collect(item, [...path, index], leaves));
  } else leaves.push(path);
}
const valid = (config) => ConfigSchema.safeParse(config).success;
const defaults = ConfigSchema.parse({ system: { root: "." } });
const base = merge(clone(defaults), input.supplement);
delete base.models;
if (!valid(base)) {
  throw new Error("the defaults with the supplement are invalid: " + JSON.stringify(ConfigSchema.safeParse(base).error.issues.slice(0, 3)));
}
const leaves = [];
collect(base, [], leaves);
const unchanged = [];
for (const path of leaves) {
  const dotted = path.join(".");
  if (KEEP.has(dotted)) continue;
  let holder = base;
  for (const key of path.slice(0, -1)) holder = holder[key];
  const last = path[path.length - 1];
  const original = holder[last];
  let changed = false;
  for (const candidate of candidates(original)) {
    holder[last] = candidate;
    if (valid(base)) { changed = true; break; }
  }
  if (!changed) { holder[last] = original; unchanged.push(dotted); }
}
console.log(JSON.stringify({ authored: base, defaults, reference: ConfigSchema.parse(base), unchanged }));
`;

export async function generateConfigReference(
  root: string,
  supplement: IJsonObject,
): Promise<IConfigReference> {
  const temp = await Deno.makeTempDir({ prefix: "config-reference-" });
  const adapter = join(temp, "adapter.ts");
  const input = join(temp, "input.json");
  await Deno.writeTextFile(adapter, ADAPTER);
  await Deno.writeTextFile(input, JSON.stringify({ supplement, keep: KEEP_LEAVES }));
  try {
    const result = await new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        "--allow-ffi",
        "--config",
        join(root, "deno.json"),
        "--frozen",
        "--lock",
        join(root, "deno.lock"),
        toFileUrl(adapter).href,
        root,
        input,
      ],
      cwd: root,
      env: { LD_LIBRARY_PATH: "", DENO_NO_UPDATE_CHECK: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      throw new Error(new TextDecoder().decode(result.stderr).trim() || "config reference generation failed");
    }
    return JSON.parse(new TextDecoder().decode(result.stdout));
  } finally {
    await Deno.remove(temp, { recursive: true }).catch(() => {});
  }
}

/** Sorts object keys so that a regeneration produces identical bytes. */
export function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map((
        [key, child],
      ) => [key, sortKeys(child)]),
    );
  }
  return value;
}

export async function writeConfigReference(
  root: string,
  supplementPath: string,
  target: string,
): Promise<IConfigReference> {
  const supplement = parse(await Deno.readTextFile(supplementPath)) as IJsonObject;
  const generated = await generateConfigReference(root, supplement);
  await Deno.mkdir(target, { recursive: true });
  await Deno.writeTextFile(join(target, "authored.toml"), stringify(generated.authored));
  const document = {
    referenceRevision: REFERENCE_REVISION,
    defaults: generated.defaults,
    authored: generated.reference,
  };
  await Deno.writeTextFile(join(target, "reference.json"), `${JSON.stringify(sortKeys(document), null, 1)}\n`);
  return generated;
}

async function main(args: readonly string[]): Promise<number> {
  const target = resolve(argValue(args, "target") ?? join(REPO_ROOT, DEFAULT_TARGET));
  const supplement = resolve(argValue(args, "supplement") ?? join(REPO_ROOT, DEFAULT_SUPPLEMENT));
  const manifest = await loadManifest();
  const snapshotArg = argValue(args, "snapshot");
  let snapshot = snapshotArg ? resolve(snapshotArg) : undefined;
  let owned = false;
  if (!snapshot) {
    snapshot = join(dirname(REPO_ROOT), "exaix-sandboxes", "phase-247-config-reference", crypto.randomUUID());
    await assertTargetAllowed(REPO_ROOT, snapshot);
    await Deno.mkdir(dirname(snapshot), { recursive: true });
    await cloneSnapshot(manifest, snapshot, REPO_ROOT);
    owned = true;
  }
  try {
    const errors = await verifySnapshot(snapshot, manifest);
    if (errors.length > 0) throw new Error(errors.join("; "));
    const generated = await writeConfigReference(snapshot, supplement, target);
    console.log(`✅ ${target} (${generated.unchanged.length} leaves left at their defaults)`);
    return 0;
  } finally {
    if (owned) await Deno.remove(snapshot, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
