#!/usr/bin/env -S deno run -A
/**
 * @module GoPortConformance
 * @path scripts/go_port/conformance/generate.ts
 * @description Generates and atomically publishes one frozen conformance suite for the Go replay.
 * Usage: deno run -A scripts/go_port/conformance/generate.ts [--suite=acceptance-bullets] [--target=<dir>]
 */
import { dirname, fromFileUrl, join, resolve, toFileUrl } from "@std/path";
import { argValue } from "../cli_args.ts";
import { assertTargetAllowed, cloneSnapshot, gitOutput } from "../preserve_snapshot.ts";
import { contentHash, sha256Hex, stable, type TJsonValue } from "../snapshot_manifest.ts";
import { schemasSuite } from "./schemas_corpus.ts";

interface IManifestRefs {
  readonly parent: string;
  readonly submodules: Readonly<Record<string, string>>;
}

export interface ISnapshotManifest extends IManifestRefs {
  readonly content_hash: string;
  readonly lockfiles: Readonly<Record<string, string>>;
}

interface ICase {
  readonly id: string;
  readonly content: string;
}

type TExpected = { readonly kind: "value"; readonly value: readonly string[] } | {
  readonly kind: "error";
  readonly category: string;
};

interface ICaseResult {
  readonly id: string;
  readonly expected: TExpected;
}

export type TInputKind = "toml" | "yaml" | "json" | "text";

export interface IIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
}

export type TExpectedV2 =
  | { readonly kind: "value"; readonly value: TJsonValue }
  | { readonly kind: "issues"; readonly issues: readonly IIssue[] }
  | { readonly kind: "error"; readonly category: string };

/** A version 2 case. `go` records a D28 divergence: the Go outcome that differs from the reference. */
export interface ICaseV2 {
  readonly id: string;
  readonly schema: string;
  readonly input: { readonly kind: TInputKind; readonly content: string };
  readonly go?: TExpectedV2;
}

export interface ICaseResultV2 {
  readonly id: string;
  readonly reference: TExpectedV2;
}

/** A version 1 suite has string cases and one built-in oracle. A version 2 suite brings its own evaluator. */
export type ISuiteDefinition =
  | { readonly version: 1; readonly cases: readonly ICase[] }
  | {
    readonly version: 2;
    /** The inputs, or a function that builds them from the verified snapshot. */
    readonly cases: readonly ICaseV2[] | ((snapshot: string) => Promise<readonly ICaseV2[]>);
    readonly evaluate: (snapshot: string, cases: readonly ICaseV2[]) => Promise<readonly ICaseResultV2[]>;
  };

interface IGeneration {
  readonly dir: string;
  readonly digest: string;
  readonly manifest: string;
}

interface IGenerateOptions {
  readonly suite: string;
  readonly target: string;
  readonly snapshot?: string;
  readonly manifest?: ISnapshotManifest;
  readonly suites?: Readonly<Record<string, ISuiteDefinition>>;
}

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", "..", ".."));
const MANIFEST_PATH = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "snapshot_manifest.json");
const GENERATOR_V1 = "1";
const GENERATOR_V2 = "2";
const INPUT_KINDS: readonly string[] = ["toml", "yaml", "json", "text"];
const SCHEMA_NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const CASE_ID = /^[a-z0-9-]+$/;

const SUITES: Readonly<Record<string, ISuiteDefinition>> = {
  schemas: schemasSuite,
  "acceptance-bullets": {
    version: 1,
    cases: [
      { id: "absent-heading", content: "## Other\n\n- ignored\n" },
      { id: "dash-bullets", content: "## Acceptance\n\n- one\n- two\n" },
      { id: "star-bullets", content: "## Success Criteria\n\n* one\n* two\n" },
      { id: "subsequent-heading", content: "## Acceptance\n\n- one\n\n## Next\n\n- ignored\n" },
    ],
  },
};

export async function loadManifest(path = MANIFEST_PATH): Promise<ISnapshotManifest> {
  const manifest: ISnapshotManifest = JSON.parse(await Deno.readTextFile(path));
  const digest = await contentHash(manifest);
  if (digest !== manifest.content_hash) throw new Error("snapshot manifest digest does not match");
  if (!SHA.test(manifest.parent)) throw new Error("snapshot parent is not a full commit SHA");
  for (const [name, sha] of Object.entries(manifest.submodules)) {
    if (!SHA.test(sha)) throw new Error(`snapshot submodule ${name} is not a full commit SHA`);
  }
  return manifest;
}

export async function verifySnapshot(snapshot: string, manifest: ISnapshotManifest): Promise<string[]> {
  const errors: string[] = [];
  if (await gitOutput(snapshot, ["rev-parse", "HEAD"]) !== manifest.parent) errors.push("snapshot HEAD differs");
  for (const [name, sha] of Object.entries(manifest.submodules)) {
    const head = await gitOutput(join(snapshot, name), ["rev-parse", "HEAD"]).catch(() => "");
    if (head !== sha) errors.push(`snapshot submodule ${name} differs`);
  }
  const lock = await Deno.readFile(join(snapshot, "deno.lock"));
  if (await sha256Hex(lock) !== manifest.lockfiles["deno.lock"]) errors.push("snapshot lockfile differs");
  if ((await gitOutput(snapshot, ["status", "--porcelain"])).length > 0) errors.push("snapshot is not clean");
  return errors;
}

async function runOracle(snapshot: string, cases: readonly ICase[]): Promise<ICaseResult[]> {
  const oracle = join(snapshot, "packages", "core", "src", "planning", "delegate_brief.ts");
  const temp = await Deno.makeTempDir({ dir: dirname(snapshot), prefix: "conformance-adapter-" });
  const adapter = join(temp, "adapter.ts");
  const source = `import { parseAcceptanceFromContent } from ${JSON.stringify(toFileUrl(oracle).href)};
const cases = ${JSON.stringify(cases)};
const results = cases.map((item) => {
  try {
    return { id: item.id, expected: { kind: "value", value: parseAcceptanceFromContent(item.content) } };
  } catch (error) {
    return { id: item.id, expected: { kind: "error", category: error instanceof Error ? error.name : "Error" } };
  }
});
console.log(JSON.stringify(results));
`;
  await Deno.writeTextFile(adapter, source);
  try {
    const result = await new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--config",
        join(snapshot, "deno.json"),
        "--frozen",
        "--lock",
        join(snapshot, "deno.lock"),
        adapter,
      ],
      cwd: snapshot,
      env: { LD_LIBRARY_PATH: "", DENO_NO_UPDATE_CHECK: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) throw new Error(new TextDecoder().decode(result.stderr).trim() || "oracle adapter failed");
    const results: ICaseResult[] = JSON.parse(new TextDecoder().decode(result.stdout));
    const expected = new Set(cases.map((item) => item.id));
    if (results.length !== cases.length || new Set(results.map((item) => item.id)).size !== cases.length) {
      throw new Error("oracle returned a duplicate or missing case");
    }
    for (const item of results) {
      if (!expected.has(item.id)) throw new Error(`oracle returned an unknown case: ${item.id}`);
    }
    return results;
  } finally {
    await Deno.remove(temp, { recursive: true }).catch(() => {});
  }
}

function expectedJson(expected: TExpectedV2): TJsonValue {
  if (expected.kind === "value") return { kind: "value", value: expected.value };
  if (expected.kind === "issues") {
    return { kind: "issues", issues: expected.issues.map((entry) => ({ path: [...entry.path], code: entry.code })) };
  }
  return { kind: "error", category: expected.category };
}

function isV2Result(item: ICaseResult | ICaseResultV2): item is ICaseResultV2 {
  return "reference" in item;
}

function assertExpectation(expected: TExpectedV2, where: string): void {
  const kind: string = expected.kind;
  if (kind === "value") return;
  if (expected.kind === "issues") {
    for (const entry of expected.issues) {
      if (typeof entry.code !== "string" || entry.code.trim() === "") throw new Error(`${where}: issue without a code`);
      for (const segment of entry.path) {
        const valid = typeof segment === "string" || (Number.isInteger(segment) && segment >= 0);
        if (!valid) throw new Error(`${where}: issue path segment is neither a string nor a non-negative integer`);
      }
    }
    return;
  }
  if (expected.kind === "error") {
    if (typeof expected.category !== "string" || expected.category.trim() === "") {
      throw new Error(`${where}: error without a category`);
    }
    return;
  }
  throw new Error(`${where}: invalid expectation kind ${kind}`);
}

async function writeCaseFiles(
  temp: string,
  documents: readonly { readonly id: string; readonly body: TJsonValue }[],
): Promise<{ id: string; file: string; sha256: string }[]> {
  const entries: { id: string; file: string; sha256: string }[] = [];
  for (const item of documents) {
    if (!CASE_ID.test(item.id)) throw new Error(`invalid case id: ${item.id}`);
    const content = stable(item.body) + "\n";
    const file = `cases/${item.id}.json`;
    await Deno.writeTextFile(join(temp, file), content);
    entries.push({ id: item.id, file, sha256: await sha256Hex(content) });
  }
  return entries;
}

function documentOf(
  definition: ISuiteDefinition,
  item: ICaseResult | ICaseResultV2,
): { readonly id: string; readonly body: TJsonValue } {
  if (definition.version === 2) {
    if (!isV2Result(item)) throw new Error(`case ${item.id}: a version 2 suite needs a reference result`);
    if (typeof definition.cases === "function") throw new Error("the cases of a version 2 suite are not resolved");
    const source = definition.cases.find((entry) => entry.id === item.id);
    if (!source) throw new Error(`oracle returned an unknown case: ${item.id}`);
    if (!SCHEMA_NAME.test(source.schema)) throw new Error(`case ${item.id}: invalid schema name`);
    if (!INPUT_KINDS.includes(source.input.kind)) throw new Error(`case ${item.id}: invalid input kind`);
    assertExpectation(item.reference, `case ${item.id} reference`);
    if (source.go) assertExpectation(source.go, `case ${item.id} go`);
    const body: { [key: string]: TJsonValue } = {
      id: item.id,
      schema: source.schema,
      input: { kind: source.input.kind, content: source.input.content },
      reference: expectedJson(item.reference),
    };
    if (source.go) body.go = expectedJson(source.go);
    return { id: item.id, body };
  }
  if (isV2Result(item)) throw new Error(`case ${item.id}: a version 1 suite needs an expected result`);
  return {
    id: item.id,
    body: {
      id: item.id,
      content: definition.cases.find((entry) => entry.id === item.id)?.content ?? "",
      expected: item.expected,
    },
  };
}

export async function prepareGeneration(
  target: string,
  suite: string,
  results: readonly (ICaseResult | ICaseResultV2)[],
  manifest: ISnapshotManifest,
  suites: Readonly<Record<string, ISuiteDefinition>> = SUITES,
): Promise<IGeneration> {
  const definition = suites[suite];
  if (!definition) throw new Error(`unknown suite: ${suite}`);
  const temp = join(target, `.tmp-${crypto.randomUUID()}`);
  await Deno.mkdir(join(temp, "cases"), { recursive: true });
  const entries = await writeCaseFiles(temp, results.map((item) => documentOf(definition, item)));
  const body = stable({
    schema_version: definition.version,
    suite,
    generator_version: definition.version === 1 ? GENERATOR_V1 : GENERATOR_V2,
    reference: { parent: manifest.parent, lockfile: manifest.lockfiles["deno.lock"] },
    cases: entries,
  }) + "\n";
  await Deno.writeTextFile(join(temp, "manifest.json"), body);
  return { dir: temp, digest: await sha256Hex(body), manifest: body };
}

async function publishGeneration(target: string, generation: IGeneration): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  const lock = await Deno.open(join(target, ".publish.lock"), { createNew: true, write: true }).catch(() => {
    throw new Error("another conformance writer holds the lock");
  });
  try {
    const dest = join(target, "generations", generation.digest);
    await Deno.mkdir(dirname(dest), { recursive: true });
    const existing = await Deno.readTextFile(join(dest, "manifest.json")).catch(() => "");
    if (existing) {
      if (existing !== generation.manifest) throw new Error("generation digest collision");
      await Deno.remove(generation.dir, { recursive: true });
    } else {
      await Deno.rename(generation.dir, dest);
    }
    const generated: { suite: string; schema_version: number; generator_version: string } = JSON.parse(
      generation.manifest,
    );
    const suite = stable({
      schema_version: generated.schema_version,
      suite: generated.suite,
      generation: generation.digest,
      generator_version: generated.generator_version,
    }) + "\n";
    const temporary = join(target, `.suite-${crypto.randomUUID()}.json`);
    await Deno.writeTextFile(temporary, suite);
    await Deno.rename(temporary, join(target, "suite.json"));
  } finally {
    lock.close();
    await Deno.remove(join(target, ".publish.lock")).catch(() => {});
  }
}

export async function generateSuite(options: IGenerateOptions): Promise<string> {
  const manifest = options.manifest ?? await loadManifest();
  const errors = await verifySnapshot(options.snapshot ?? "", manifest);
  if (errors.length > 0) throw new Error(errors.join("; "));
  const suites = options.suites ?? SUITES;
  const definition = suites[options.suite];
  if (!definition) throw new Error(`unknown suite: ${options.suite}`);
  const snapshot = options.snapshot ?? "";
  if (definition.version === 1) {
    const results = await runOracle(snapshot, definition.cases);
    return await publish(options.target, options.suite, results, manifest, suites);
  }
  const cases = typeof definition.cases === "function" ? await definition.cases(snapshot) : definition.cases;
  const results = await definition.evaluate(snapshot, cases);
  const resolved: Readonly<Record<string, ISuiteDefinition>> = { ...suites, [options.suite]: { ...definition, cases } };
  return await publish(options.target, options.suite, results, manifest, resolved);
}

async function publish(
  target: string,
  suite: string,
  results: readonly (ICaseResult | ICaseResultV2)[],
  manifest: ISnapshotManifest,
  suites: Readonly<Record<string, ISuiteDefinition>>,
): Promise<string> {
  const generation = await prepareGeneration(target, suite, results, manifest, suites);
  await publishGeneration(target, generation);
  return generation.digest;
}

async function main(args: readonly string[]): Promise<number> {
  const suite = argValue(args, "suite") ?? "acceptance-bullets";
  const target = resolve(argValue(args, "target") ?? join(REPO_ROOT, "exaix-go", "testdata", "conformance", suite));
  const manifest = await loadManifest();
  const snapshotArg = argValue(args, "snapshot");
  let snapshot = snapshotArg ? resolve(snapshotArg) : undefined;
  let owned = false;
  if (!snapshot) {
    snapshot = join(dirname(REPO_ROOT), "exaix-sandboxes", "phase-246-conformance", crypto.randomUUID());
    await assertTargetAllowed(REPO_ROOT, snapshot);
    await Deno.mkdir(dirname(snapshot), { recursive: true });
    await cloneSnapshot(manifest, snapshot, REPO_ROOT);
    owned = true;
  }
  try {
    const digest = await generateSuite({ suite, target, snapshot, manifest });
    console.log(`✅ ${suite} ${digest}`);
    return 0;
  } finally {
    if (owned) await Deno.remove(snapshot, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
