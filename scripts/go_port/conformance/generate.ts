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
import { contentHash, sha256Hex, stable } from "../snapshot_manifest.ts";

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
}

const REPO_ROOT = resolve(join(dirname(fromFileUrl(import.meta.url)), "..", "..", ".."));
const MANIFEST_PATH = join(REPO_ROOT, "exaix-dev-docs", "evidence", "go-port", "snapshot_manifest.json");
const GENERATOR_VERSION = "1";
const SHA = /^[0-9a-f]{40}$/;
const CASE_ID = /^[a-z0-9-]+$/;

const SUITES: Readonly<Record<string, readonly ICase[]>> = {
  "acceptance-bullets": [
    { id: "absent-heading", content: "## Other\n\n- ignored\n" },
    { id: "dash-bullets", content: "## Acceptance\n\n- one\n- two\n" },
    { id: "star-bullets", content: "## Success Criteria\n\n* one\n* two\n" },
    { id: "subsequent-heading", content: "## Acceptance\n\n- one\n\n## Next\n\n- ignored\n" },
  ],
};

export async function loadManifest(path = MANIFEST_PATH): Promise<ISnapshotManifest> {
  const manifest = JSON.parse(await Deno.readTextFile(path)) as ISnapshotManifest;
  const digest = await contentHash(manifest as never);
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

async function runOracle(snapshot: string, suite: string): Promise<ICaseResult[]> {
  const cases = SUITES[suite];
  if (!cases) throw new Error(`unknown suite: ${suite}`);
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
    const results = JSON.parse(new TextDecoder().decode(result.stdout)) as ICaseResult[];
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

export async function prepareGeneration(
  target: string,
  suite: string,
  results: readonly ICaseResult[],
  manifest: ISnapshotManifest,
): Promise<IGeneration> {
  const cases = SUITES[suite];
  if (!cases) throw new Error(`unknown suite: ${suite}`);
  const temp = join(target, `.tmp-${crypto.randomUUID()}`);
  await Deno.mkdir(join(temp, "cases"), { recursive: true });
  const entries: { id: string; file: string; sha256: string }[] = [];
  for (const item of results) {
    if (!CASE_ID.test(item.id)) throw new Error(`invalid case id: ${item.id}`);
    const content = stable({
      id: item.id,
      content: cases.find((entry) => entry.id === item.id)?.content ?? "",
      expected: item.expected,
    }) + "\n";
    const file = `cases/${item.id}.json`;
    await Deno.writeTextFile(join(temp, file), content);
    entries.push({ id: item.id, file, sha256: await sha256Hex(content) });
  }
  const body = stable({
    schema_version: 1,
    suite,
    generator_version: GENERATOR_VERSION,
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
    const suite = stable({
      schema_version: 1,
      suite: (JSON.parse(generation.manifest) as { suite: string }).suite,
      generation: generation.digest,
      generator_version: GENERATOR_VERSION,
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
  const results = await runOracle(options.snapshot ?? "", options.suite);
  const generation = await prepareGeneration(options.target, options.suite, results, manifest);
  await publishGeneration(options.target, generation);
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
