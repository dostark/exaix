#!/usr/bin/env -S deno run -A
/**
 * @module GoPortSchemasCorpus
 * @path scripts/go_port/conformance/schemas_corpus.ts
 * @description Builds the `schemas` conformance suite: base inputs from repository files, recorded tests and enum options, then probes and derived edges, all evaluated by the reference schemas in a verified snapshot.
 * Usage: imported by generate.ts, which publishes the suite. Run `deno run -A scripts/go_port/conformance/generate.ts --suite=schemas`.
 */
import { dirname, fromFileUrl, join } from "@std/path";
import type { TJsonValue } from "../snapshot_manifest.ts";
import type { ICaseResultV2, ICaseV2, ISuiteDefinition, TInputKind } from "./generate.ts";
import type { IInputDocument, IKeepEntry } from "./adapters/raw_value.ts";
import { deriveEdges, PROBES } from "./schemas_edges.ts";

const HERE = dirname(fromFileUrl(import.meta.url));
const ADAPTERS = join(HERE, "adapters");
const REPO_ROOT = join(HERE, "..", "..", "..");
const INVENTORY = join(REPO_ROOT, "exaix-go", "port", "inventory", "schemas.json");
const MAX_FILE_BASES = 10;
const MAX_MINED_VALID = 12;
const MAX_MINED_INVALID = 6;
const SEED_COUNT = 2;
const MAX_EDGES = 40;
const INVALID_ENUM = '"__not_an_option__"';
const ROLE_ORDER = ["file", "mined", "synth", "enum", "probe", "edge"] as const;
type TRole = (typeof ROLE_ORDER)[number];

interface IBases {
  readonly files: IInputDocument[];
  readonly mined: IInputDocument[];
  readonly enums: string[];
  readonly synth: string | null;
}

interface IPlanned {
  readonly key: string;
  readonly role: TRole;
  readonly input: IInputDocument;
}

interface IEvaluated extends ICaseResultV2 {
  readonly parsed?: TJsonValue;
}

interface IInventoryFile {
  readonly entries: readonly (IKeepEntry & { readonly class: string })[];
}

type TKeepSource = readonly IKeepEntry[] | (() => Promise<readonly IKeepEntry[]>);

/** The keep entries of the schemas inventory. */
async function readKeepEntries(): Promise<IKeepEntry[]> {
  const inventory: IInventoryFile = JSON.parse(await Deno.readTextFile(INVENTORY));
  return inventory.entries.filter((entry) => entry.class === "keep").map(({ module, symbol }) => ({ module, symbol }));
}

async function runDeno(snapshot: string, args: readonly string[], env: { [key: string]: string }): Promise<string> {
  const result = await new Deno.Command("deno", {
    args: [
      args[0],
      ...["--config", join(snapshot, "deno.json"), "--frozen", "--lock", join(snapshot, "deno.lock")],
      ...args.slice(1),
    ],
    cwd: snapshot,
    env: { ...env, TZ: "UTC", LD_LIBRARY_PATH: "", DENO_NO_UPDATE_CHECK: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr).trim() || `deno ${args[0]} failed`);
  return new TextDecoder().decode(result.stdout);
}

async function mineTests(snapshot: string, keepFile: string, record: string): Promise<void> {
  try {
    await Deno.stat(join(snapshot, "packages", "schemas", "tests"));
  } catch {
    return;
  }
  await runDeno(
    snapshot,
    [
      "test",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      `--allow-write=${dirname(record)}`,
      "--preload",
      join(ADAPTERS, "record_preload.ts"),
      "packages/schemas/tests",
    ],
    { CORPUS_ROOT: snapshot, CORPUS_KEEP: keepFile, CORPUS_RECORD: record, TMPDIR: dirname(record) },
  );
}

async function runAdapter(snapshot: string, adapter: string, args: readonly string[]): Promise<string> {
  return await runDeno(
    snapshot,
    ["run", "--allow-read", "--allow-env", "--allow-ffi", join(ADAPTERS, adapter), snapshot, ...args],
    {},
  );
}

async function evaluateInputs(
  snapshot: string,
  work: string,
  keepFile: string,
  items: readonly { id: string; schema: string; input: IInputDocument }[],
): Promise<IEvaluated[]> {
  const casesFile = join(work, "cases.json");
  await Deno.writeTextFile(casesFile, JSON.stringify(items));
  return JSON.parse(await runAdapter(snapshot, "evaluate.ts", [keepFile, casesFile]));
}

function evenlySpaced<TItem>(items: readonly TItem[], count: number): TItem[] {
  if (items.length <= count) return [...items];
  return Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)]);
}

function hasTag(value: TJsonValue): boolean {
  if (Array.isArray(value)) return value.some(hasTag);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, child]) => key.startsWith("$") || hasTag(child));
}

function slugOf(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function candidatesOf(key: string, bases: IBases): IPlanned[] {
  const planned: IPlanned[] = [];
  for (const input of bases.files) planned.push({ key, role: "file", input });
  for (const input of bases.mined) planned.push({ key, role: "mined", input });
  if (bases.synth !== null) planned.push({ key, role: "synth", input: { kind: "json", content: bases.synth } });
  for (const option of [...bases.enums, ...(bases.enums.length > 0 ? [INVALID_ENUM] : [])]) {
    planned.push({ key, role: "enum", input: { kind: "json", content: option } });
  }
  for (const content of PROBES) planned.push({ key, role: "probe", input: { kind: "json", content } });
  return planned;
}

function dedupe(planned: readonly IPlanned[]): IPlanned[] {
  const seen = new Set<string>();
  const result: IPlanned[] = [];
  for (const item of planned) {
    const identity = `${item.key}\n${item.input.kind}\n${item.input.content}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push(item);
    }
  }
  return result;
}

function orderAndName(planned: readonly IPlanned[]): { id: string; planned: IPlanned }[] {
  const sorted = [...planned].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
  );
  const counters = new Map<string, number>();
  return sorted.map((item) => {
    const slot = `${slugOf(item.key)}-${item.role}`;
    const next = (counters.get(slot) ?? 0) + 1;
    counters.set(slot, next);
    return { id: `${slot}-${String(next).padStart(3, "0")}`, planned: item };
  });
}

/** Picks the bases to keep for one schema from the evaluated candidates. */
function selectBases(candidates: readonly { planned: IPlanned; evaluated: IEvaluated }[]): IPlanned[] {
  const isValid = (item: { evaluated: IEvaluated }) => item.evaluated.reference.kind === "value";
  const ofRole = (role: TRole) => candidates.filter((item) => item.planned.role === role);
  const files = evenlySpaced(ofRole("file").filter(isValid), MAX_FILE_BASES);
  const mined = ofRole("mined");
  const keptMined = [
    ...mined.filter(isValid).slice(0, MAX_MINED_VALID),
    ...mined.filter((item) => !isValid(item)).slice(0, MAX_MINED_INVALID),
  ];
  return [...files, ...keptMined, ...ofRole("synth"), ...ofRole("enum"), ...ofRole("probe")].map((item) =>
    item.planned
  );
}

function edgesFor(
  key: string,
  candidates: readonly { planned: IPlanned; evaluated: IEvaluated }[],
): IPlanned[] {
  const seeds = candidates
    .filter((item) =>
      (item.planned.role === "file" || item.planned.role === "mined" || item.planned.role === "synth") &&
      item.evaluated.reference.kind === "value" &&
      item.evaluated.parsed !== undefined && !hasTag(item.evaluated.parsed)
    )
    .sort((a, b) => a.planned.input.content.length - b.planned.input.content.length)
    .slice(0, SEED_COUNT);
  const edges: IPlanned[] = [];
  for (const seed of seeds) {
    for (const edge of deriveEdges(seed.evaluated.parsed ?? null)) {
      const kind: TInputKind = "json";
      edges.push({ key, role: "edge", input: { kind, content: JSON.stringify(edge.value) } });
    }
  }
  return edges.slice(0, MAX_EDGES);
}

async function buildCases(snapshot: string, keep: readonly IKeepEntry[]): Promise<ICaseV2[]> {
  const work = await Deno.makeTempDir({ prefix: "schemas-corpus-" });
  try {
    const keepFile = join(work, "keep.json");
    const records = [join(work, "record-1.jsonl"), join(work, "record-2.jsonl")];
    await Deno.writeTextFile(keepFile, JSON.stringify(keep));
    for (const record of records) await mineTests(snapshot, keepFile, record);
    const bases: { [key: string]: IBases } = JSON.parse(
      await runAdapter(snapshot, "collect_inputs.ts", [keepFile, ...records]),
    );
    const candidates = dedupe(Object.keys(bases).sort().flatMap((key) => candidatesOf(key, bases[key])));
    const probeIds = candidates.map((planned, index) => ({ id: `candidate-${index}`, planned }));
    const evaluated = await evaluateInputs(
      snapshot,
      work,
      keepFile,
      probeIds.map(({ id, planned }) => ({ id, schema: planned.key, input: planned.input })),
    );
    const byId = new Map(evaluated.map((item) => [item.id, item]));
    const keys = [...new Set(candidates.map((item) => item.key))];
    const finals: IPlanned[] = [];
    for (const key of keys) {
      const rows = probeIds.filter(({ planned }) => planned.key === key).map(({ id, planned }) => ({
        planned,
        evaluated: byId.get(id) as IEvaluated,
      }));
      finals.push(...selectBases(rows), ...edgesFor(key, rows));
    }
    return orderAndName(dedupe(finals)).map(({ id, planned }) => ({
      id,
      schema: planned.key,
      input: planned.input,
    }));
  } finally {
    await Deno.remove(work, { recursive: true }).catch(() => {});
  }
}

async function evaluateCases(
  snapshot: string,
  keep: readonly IKeepEntry[],
  cases: readonly ICaseV2[],
): Promise<ICaseResultV2[]> {
  const work = await Deno.makeTempDir({ prefix: "schemas-corpus-" });
  try {
    const keepFile = join(work, "keep.json");
    await Deno.writeTextFile(keepFile, JSON.stringify(keep));
    const results = await evaluateInputs(snapshot, work, keepFile, cases);
    return results.map(({ id, reference }) => ({ id, reference }));
  } finally {
    await Deno.remove(work, { recursive: true }).catch(() => {});
  }
}

/** The schemas suite for a list of keep entries, or for a function that reads them. */
export function schemasSuiteFor(source: TKeepSource): ISuiteDefinition {
  const keepOf = async () => (typeof source === "function" ? await source() : source);
  return {
    version: 2,
    cases: async (snapshot) => buildCases(snapshot, await keepOf()),
    evaluate: async (snapshot, cases) => evaluateCases(snapshot, await keepOf(), cases),
  };
}

export const schemasSuite: ISuiteDefinition = schemasSuiteFor(readKeepEntries);
