#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL1CaseReference
 * @path scripts/go_port/core_l1_case_reference.ts
 * @description Builds the unpublished version 2 core-l1 cases from the pinned observations and records the kept TOML, allocator and card effects.
 * Usage: imported by core_l1_reference.ts.
 */
import { join, relative } from "@std/path";
import type { Opt, Reason } from "@exaix/core/types";
import { runPinnedAdapter } from "./core_l1_adapter.ts";

/** A JSON value in a recorded observation. */
export type TJson = string | number | boolean | null | TJson[] | IJsonObject;

/** A JSON object in a recorded observation. */
export interface IJsonObject {
  [key: string]: TJson;
}

/** One file of the bounded seed tree. A path is relative and slash separated. */
export interface ICoreL1SeedFile {
  readonly path: string;
  readonly content: string;
  readonly mtime_ms?: number;
}

/** The typed comparison of one core-l1 case. `before` and `after` name every relative file and its digest. */
export interface ICoreL1CaseValue {
  readonly result: TJson;
  readonly before: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
}

export interface ICoreL1CaseEnvelope {
  readonly id: string;
  readonly schema: string;
  readonly input: { readonly kind: "json"; readonly content: string };
  readonly reference: { readonly kind: "value"; readonly value: ICoreL1CaseValue };
}

export interface ICoreL1Corpus {
  readonly schema_version: 2;
  readonly suite: "core-l1";
  readonly reference: { readonly parent: string; readonly lockfile: string };
  readonly cases: readonly ICoreL1CaseEnvelope[];
}

/** One extra case that the recorder captures in its own temporary root. */
export interface ICoreL1ExtraCase {
  readonly id: string;
  readonly operation: string;
  readonly seed: readonly ICoreL1SeedFile[];
  readonly request: TJson;
  readonly result: TJson;
  readonly after: Readonly<Record<string, string>>;
}

export type TExtraRunner = (snapshot: string) => Promise<readonly ICoreL1ExtraCase[]>;

export const CORE_L1_LOCKFILE = "7dfc040c77813c791a86d7c79162438668e33a7a1688ef3cb6961bf6d5dae6ef";

const BLUEPRINT_PREFIX = "blueprint-";
const CONTEXT_PREFIX = "context-";
const CONFIG_PREFIX = "config-";
const JOURNAL_ID = "journal-chained-rows";
const PROCESS_ID = "process-request-outcomes";
const BLUEPRINT_DIR = join("Blueprints", "Agents");
const BLUEPRINT_SUFFIX = ".md";
const CONFIG_FILE = "exa.config.toml";
const KNOWN_DIVERGENCE = new Set(["blueprint-yaml-date-created", "blueprint-frontmatter-blank"]);
const PROMPT_BUDGET_FIXTURE = join("exaix-go", "internal", "core", "l0", "testdata", "reference", "prompt_budget.json");
const CARD_MEMORY = "Memory";
const CARD_ALIAS = "live-portal";
const CARD_PATH = "Portals/live";
const CARD_TECH = ["Go", "Deno"];
const CREATED_TIME = "2026-11-26T00:00:00.000Z";
const PORTAL_ENTRY = {
  alias: CARD_ALIAS,
  target_path: CARD_PATH,
  default_branch: "main",
  execution_strategy: "worktree",
} as const;
const OPERATOR_NOTES = "Keep these operator notes.";
const FRAGMENT_ROLE = "fragment-agent";
const FRAGMENT_AGENT = `---
name: Fragment Agent
---
Start {{include:shared}} {{include:missing}} {{include:loop}} End
`;
const FRAGMENT_FILES: Readonly<Record<string, string>> = {
  "Blueprints/Fragments/shared.md": "Shared {{include:nested/deep}}",
  "Blueprints/Fragments/nested/deep.md": "Deep",
  "Blueprints/Fragments/loop.md": "Loop {{include:loop}}",
};
const HEX_RADIX = 16;

interface IRecordedFixture {
  readonly id: string;
  readonly input: string;
  readonly observation: string;
}

function fail(message: string): never {
  throw new Error(`core-l1 case: ${message}`);
}

async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(HEX_RADIX).padStart(2, "0")).join("");
}

/** Hashes every regular file below root under its relative slash path. */
async function treeDigest(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await collectTree(root, root, out);
  return Object.fromEntries(Object.entries(out).sort(([left], [right]) => left.localeCompare(right)));
}

async function collectTree(base: string, directory: string, out: Record<string, string>): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    const full = join(directory, entry.name);
    if (entry.isDirectory) {
      await collectTree(base, full, out);
      continue;
    }
    if (!entry.isFile) fail(`unsupported seed entry ${entry.name}`);
    const data = await Deno.readFile(full);
    const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
    out[relative(base, full).split("\\").join("/")] = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(HEX_RADIX).padStart(2, "0")).join("");
  }
}

async function seedDigest(seed: readonly ICoreL1SeedFile[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of seed) out[file.path] = await sha256Hex(file.content);
  return Object.fromEntries(Object.entries(out).sort(([left], [right]) => left.localeCompare(right)));
}

function parseObject(text: string, field: string): IJsonObject {
  const value = JSON.parse(text) as TJson;
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${field} is not an object`);
  return value;
}

function asString(value: Opt<TJson, Reason.OptionalInput>, field: string): string {
  if (typeof value !== "string") fail(`${field} is not a string`);
  return value;
}

function asBoolean(value: Opt<TJson, Reason.OptionalInput>, field: string): boolean {
  if (typeof value !== "boolean") fail(`${field} is not a boolean`);
  return value;
}

interface IBlueprintObservation {
  readonly outcome: string;
  readonly loaded?: IJsonObject;
  readonly error?: { readonly kind?: TJson; readonly paths?: TJson[] };
  readonly warnings?: readonly TJson[];
}

function normalizedWarnings(warnings: Opt<readonly TJson[], Reason.OptionalInput>): string[] {
  return (warnings ?? []).filter((item): item is string => typeof item === "string").sort();
}

function normalizedKind(kind: Opt<TJson, Reason.OptionalInput>): TJson {
  // The Go rejection category reports a blank frontmatter as invalid frontmatter.
  return kind === "load_failed" ? "invalid_frontmatter" : (kind ?? "");
}

function normalizeBlueprint(observation: IBlueprintObservation): TJson {
  if (observation.outcome === "loaded" && observation.loaded !== undefined) {
    return { outcome: "loaded", loaded: observation.loaded, warnings: normalizedWarnings(observation.warnings) };
  }
  if (observation.outcome === "error" && observation.error !== undefined) {
    return {
      outcome: "error",
      error: { kind: normalizedKind(observation.error.kind), paths: observation.error.paths ?? [] },
      warnings: [],
    };
  }
  return { outcome: "absent", warnings: normalizedWarnings(observation.warnings) };
}

interface IContextFile {
  readonly path?: TJson;
  readonly content?: TJson;
  readonly mtime_ms?: TJson;
}

function seedsOf(entry: IRecordedFixture, input: IJsonObject): ICoreL1SeedFile[] {
  if (entry.id.startsWith(CONFIG_PREFIX)) {
    return [{ path: CONFIG_FILE, content: entry.input }];
  }
  if (entry.id.startsWith(BLUEPRINT_PREFIX)) {
    if (!asBoolean(input.present, `${entry.id}.present`)) return [];
    const role = asString(input.role, `${entry.id}.role`);
    return [{
      path: join(BLUEPRINT_DIR, `${role}${BLUEPRINT_SUFFIX}`),
      content: asString(input.content, `${entry.id}.content`),
    }];
  }
  if (entry.id.startsWith(CONTEXT_PREFIX)) {
    if (!Array.isArray(input.files)) fail(`${entry.id}.files is not a list`);
    return (input.files as IContextFile[]).map((file) => ({
      path: asString(file.path, `${entry.id}.files.path`),
      content: asString(file.content, `${entry.id}.files.content`),
      mtime_ms: typeof file.mtime_ms === "number" ? file.mtime_ms : undefined,
    }));
  }
  return [];
}

function requestOf(entry: IRecordedFixture, input: IJsonObject): TJson {
  if (entry.id.startsWith(CONFIG_PREFIX)) {
    return { name: CONFIG_FILE, authored_root: input.authored_root };
  }
  if (entry.id.startsWith(BLUEPRINT_PREFIX)) {
    return { role: input.role, default_model: input.default_model };
  }
  if (entry.id.startsWith(CONTEXT_PREFIX)) {
    return { config: input.config, requested: input.requested };
  }
  if (entry.id === PROCESS_ID) {
    const observed = parseObject(entry.observation, `${entry.id}.observation`);
    return { ...input, raw: { exit_code: observed.exit_code, stdout: observed.stdout, stderr: observed.stderr } };
  }
  return input;
}

function resultOf(entry: IRecordedFixture, observed: IJsonObject): TJson {
  if (entry.id.startsWith(BLUEPRINT_PREFIX)) return normalizeBlueprint(blueprintObservation(observed));
  return observed;
}

function blueprintObservation(observed: IJsonObject): IBlueprintObservation {
  const error = observed.error;
  const loaded = observed.loaded;
  const warnings = observed.warnings;
  return {
    outcome: asString(observed.outcome, "blueprint.outcome"),
    loaded: typeof loaded === "object" && loaded !== null && !Array.isArray(loaded) ? loaded : undefined,
    error: typeof error === "object" && error !== null && !Array.isArray(error)
      ? {
        kind: error.kind,
        paths: Array.isArray(error.paths) ? error.paths : [],
      }
      : undefined,
    warnings: Array.isArray(warnings) ? warnings : [],
  };
}

/** Builds one envelope from a recorded fixture. The seed is the authored input. The before and after trees start equal. */
async function envelopeOf(entry: IRecordedFixture): Promise<ICoreL1CaseEnvelope> {
  const configCase = entry.id.startsWith(CONFIG_PREFIX);
  const input = configCase ? {} : parseObject(entry.input, `${entry.id}.input`);
  const observed = parseObject(entry.observation, `${entry.id}.observation`);
  if (configCase) input.authored_root = observed.authored_root;
  const seed = seedsOf(entry, input);
  const tree = await seedDigest(seed);
  const operation = operationOf(entry.id);
  const content = { operation, seed, request: requestOf(entry, input) };
  return {
    id: entry.id,
    schema: operation,
    input: { kind: "json", content: `${JSON.stringify(content)}\n` },
    reference: { kind: "value", value: { result: resultOf(entry, observed), before: tree, after: tree } },
  };
}

/** Names the Go consumer that replays one recorded case. */
function operationOf(id: string): string {
  if (id.startsWith(CONFIG_PREFIX)) return "config-load";
  if (id.startsWith(BLUEPRINT_PREFIX)) return "blueprint-load";
  if (id.startsWith(CONTEXT_PREFIX)) return "context-load";
  if (id === JOURNAL_ID) return "journal";
  if (id === PROCESS_ID) return "process-request";
  fail(`unknown recorded operation for ${id}`);
}

async function envelopeFromExtra(entry: ICoreL1ExtraCase): Promise<ICoreL1CaseEnvelope> {
  const content = { operation: entry.operation, seed: entry.seed, request: entry.request };
  return {
    id: entry.id,
    schema: entry.operation,
    input: { kind: "json", content: `${JSON.stringify(content)}\n` },
    reference: {
      kind: "value",
      value: { result: entry.result, before: await seedDigest(entry.seed), after: entry.after },
    },
  };
}

/** Selects the two pinned allocator cases from the prompt budget fixture. */
async function promptBudgetCases(repoRoot: string): Promise<ICoreL1ExtraCase[]> {
  const fixture = parseObject(await Deno.readTextFile(join(repoRoot, PROMPT_BUDGET_FIXTURE)), "prompt_budget");
  if (!Array.isArray(fixture.cases)) fail("prompt_budget.cases is not a list");
  const wanted = new Map([
    ["cloud-default-no-hints", "prompt-budget-enforced"],
    ["explicit-disabled", "prompt-budget-disabled"],
  ]);
  const out: ICoreL1ExtraCase[] = [];
  for (const item of fixture.cases as IJsonObject[]) {
    const name = asString(item.name, "prompt_budget.case.name");
    const id = wanted.get(name);
    if (id === undefined) continue;
    out.push({
      id,
      operation: "prompt-budget",
      seed: [],
      request: { model: item.model, input: item.input },
      result: item.expected,
      after: {},
    });
  }
  if (out.length !== wanted.size) fail("prompt_budget fixture lacks a required allocator case");
  return out;
}

const CONFIG_WRITE_ADAPTER = `const [root, requestPath] = Deno.args;
const request = JSON.parse(await Deno.readTextFile(requestPath));
const { ConfigService } = await import(new URL("file://" + root + "/packages/core/src/config/service.ts").href);
const RealDate = globalThis.Date;
const realLog = console.log;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [request.created])); }
  static now() { return new RealDate(request.created).getTime(); }
};
try {
  console.log = () => {};
  const service = new ConfigService(request.path);
  service.get();
  await service.addPortal(request.entry.alias, request.entry.target_path, {
    defaultBranch: request.entry.default_branch,
    executionStrategy: request.entry.execution_strategy,
  });
} finally {
  globalThis.Date = RealDate;
  console.log = realLog;
}
console.log(JSON.stringify({ steps: [{ kind: "ensure", outcome: "created" }, { kind: "update", outcome: "updated" }] }));
`;

const FRAGMENT_ADAPTER = `const [root, requestPath] = Deno.args;
const request = JSON.parse(await Deno.readTextFile(requestPath));
const { IBlueprintLoader } = await import(new URL("file://" + root + "/packages/core/src/blueprint/blueprint_loader.ts").href);
const warnings = [];
const realWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(" ")); };
let loaded;
try {
  const loader = new IBlueprintLoader({ blueprintsPath: request.agents, defaultModel: "gemini-3.8-flash" });
  loaded = await loader.load(request.role);
} finally {
  console.warn = realWarn;
}
if (loaded === null) throw new Error("fragment fixture is absent");
const normalized = warnings.map((warning) => {
  const cyclic = /Circular inclusion detected for fragment: (.+)$/.exec(warning);
  if (cyclic) return 'fragment "' + cyclic[1] + '" is cyclic';
  const missing = /Failed to include fragment '([^']+)'/.exec(warning);
  if (missing) return 'fragment "' + missing[1] + '" is missing';
  return warning;
});
console.log(JSON.stringify({ prompt: loaded.systemPrompt, warnings: normalized }));
`;

const CARD_ADAPTER = `const [root, requestPath] = Deno.args;
const request = JSON.parse(await Deno.readTextFile(requestPath));
const { ContextCardGenerator } = await import(new URL("file://" + root + "/packages/core/src/context/context_card_generator.ts").href);
const config = { system: { root: request.root }, paths: { memory: "Memory" } };
const generator = new ContextCardGenerator(config);
const portal = { alias: request.portal.alias, path: request.portal.path, techStack: request.portal.tech_stack };
await generator.generate(portal);
const cardPath = request.root + "/" + request.memory + "/Projects/" + request.portal.alias.replace(/[^a-zA-Z0-9_-]/g, "_") + "/portal.md";
await Deno.writeTextFile(cardPath, (await Deno.readTextFile(cardPath)).replace("Add your notes here...", request.notes));
await generator.generate(portal);
const first = (await Deno.readTextFile(cardPath)).replace(request.notes, "Add your notes here...");
console.log(JSON.stringify({ outcomes: ["context_card.created", "context_card.updated"], cards: [first, await Deno.readTextFile(cardPath)] }));
`;

async function recordConfigWriteCase(snapshot: string): Promise<ICoreL1ExtraCase> {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "core-l1-config-writes-" }));
  try {
    const request = {
      path: join(root, CONFIG_FILE),
      entry: PORTAL_ENTRY,
      created: CREATED_TIME,
    };
    const output = await runPinnedAdapter(
      snapshot,
      CONFIG_WRITE_ADAPTER,
      JSON.stringify(request),
      {},
      ["--allow-write", `--allow-write=${root}`],
    );
    return {
      id: "config-toml-writes",
      operation: "config-writes",
      seed: [],
      request: { steps: [{ kind: "ensure" }, { kind: "update", entry: PORTAL_ENTRY, created: CREATED_TIME }] },
      result: JSON.parse(output) as TJson,
      after: await treeDigest(root),
    };
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

async function recordFragmentCase(snapshot: string): Promise<ICoreL1ExtraCase> {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "core-l1-fragments-" }));
  try {
    const seed: ICoreL1SeedFile[] = [
      { path: join("Blueprints", "Agents", `${FRAGMENT_ROLE}.md`), content: FRAGMENT_AGENT },
      ...Object.entries(FRAGMENT_FILES).map(([path, content]) => ({ path, content })),
    ];
    for (const file of seed) {
      const target = join(root, file.path);
      await Deno.mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
      await Deno.writeTextFile(target, file.content, { mode: 0o600 });
    }
    const output = await runPinnedAdapter(
      snapshot,
      FRAGMENT_ADAPTER,
      JSON.stringify({
        role: FRAGMENT_ROLE,
        agents: join(root, "Blueprints", "Agents"),
      }),
      {},
    );
    return {
      id: "blueprint-fragments",
      operation: "blueprint-fragments",
      seed,
      request: { role: FRAGMENT_ROLE },
      result: JSON.parse(output) as TJson,
      after: await treeDigest(root),
    };
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

async function recordCardCase(snapshot: string): Promise<ICoreL1ExtraCase> {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "core-l1-card-" }));
  try {
    const portal = { id: "portal-1", alias: CARD_ALIAS, path: CARD_PATH, tech_stack: CARD_TECH };
    const output = await runPinnedAdapter(
      snapshot,
      CARD_ADAPTER,
      JSON.stringify({ root, memory: CARD_MEMORY, portal, notes: OPERATOR_NOTES }),
      {},
      ["--allow-write", `--allow-write=${root}`],
    );
    return {
      id: "context-card-notes",
      operation: "context-card",
      seed: [],
      request: {
        portal: { portal_id: portal.id, alias: portal.alias, path: portal.path, tech_stack: portal.tech_stack },
        notes: OPERATOR_NOTES,
        memory: CARD_MEMORY,
      },
      result: JSON.parse(output) as TJson,
      after: await treeDigest(root),
    };
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

/** Records every extra case that the unpublished corpus owns. Later Blueprint cases join before publication. */
export const pinnedExtraRunner: TExtraRunner = async (snapshot: string): Promise<readonly ICoreL1ExtraCase[]> => [
  await recordConfigWriteCase(snapshot),
  ...await promptBudgetCases(Deno.cwd()),
  await recordFragmentCase(snapshot),
  await recordCardCase(snapshot),
];

/** Builds the unpublished corpus from the recorded fixtures and the extra cases. */
export async function buildCoreL1Corpus(
  recorded: readonly IRecordedFixture[],
  extras: readonly ICoreL1ExtraCase[],
  parent: string,
): Promise<ICoreL1Corpus> {
  const cases: ICoreL1CaseEnvelope[] = [];
  for (const entry of recorded) {
    if (KNOWN_DIVERGENCE.has(entry.id)) continue;
    cases.push(await envelopeOf(entry));
  }
  for (const extra of extras) cases.push(await envelopeFromExtra(extra));
  return {
    schema_version: 2,
    suite: "core-l1",
    reference: { parent, lockfile: CORE_L1_LOCKFILE },
    cases,
  };
}

/** Writes the corpus with a trailing newline. Identical inputs produce identical bytes. */
export async function writeCoreL1Corpus(target: string, corpus: ICoreL1Corpus): Promise<void> {
  await Deno.writeTextFile(join(target, "core_l1_cases.json"), `${JSON.stringify(corpus, null, 2)}\n`);
}
