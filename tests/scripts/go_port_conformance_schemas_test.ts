/**
 * @module GoPortConformanceSchemasTest
 * @path tests/scripts/go_port_conformance_schemas_test.ts
 * @description Exercises the schemas corpus: edge generation, the committed suite and deterministic regeneration.
 * @architectural-layer Test
 */
import { assert, assertArrayIncludes, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import { generateSuite, type ISnapshotManifest } from "../../scripts/go_port/conformance/generate.ts";
import { deriveEdges, PROBES } from "../../scripts/go_port/conformance/schemas_edges.ts";
import { schemaKey } from "../../scripts/go_port/conformance/adapters/raw_value.ts";
import { schemasSuiteFor } from "../../scripts/go_port/conformance/schemas_corpus.ts";
import { contentHash, sha256Hex } from "../../scripts/go_port/snapshot_manifest.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SUITE_DIR = join(ROOT, "exaix-go", "testdata", "conformance", "schemas");
const INVENTORY = join(ROOT, "exaix-go", "port", "inventory", "schemas.json");

interface IInventoryEntry {
  readonly module: string;
  readonly symbol: string;
  readonly class: string;
}

interface ISelectionFile {
  readonly generation: string;
}

interface ICaseFile {
  readonly id: string;
  readonly schema: string;
  readonly reference: { readonly kind: string };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await new Deno.Command("git", {
    cwd,
    args,
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      LD_LIBRARY_PATH: "",
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).trim();
}

Deno.test("go-port-schemas-corpus: edge generation covers omitted, null and unknown fields", () => {
  const edges = deriveEdges({ name: "x", count: 3, flag: true, list: [1], nested: { k: 1 } });
  const labels = edges.map((edge) => edge.label);
  for (
    const expected of [
      "unknown-key",
      "omit-name",
      "null-name",
      "empty-name",
      "wrong-type-name",
      "zero-count",
      "negative-count",
      "fraction-count",
      "large-count",
      "flip-flag",
      "empty-list",
      "empty-nested",
    ]
  ) {
    assertArrayIncludes(labels, [expected], `missing edge ${expected}`);
  }
  const unknown = edges.find((edge) => edge.label === "unknown-key");
  assertEquals(Object.keys(unknown?.value as Record<string, number>).length, 6);
  assertEquals(edges.find((edge) => edge.label === "omit-name")?.value, {
    count: 3,
    flag: true,
    list: [1],
    nested: { k: 1 },
  });
  assertEquals(edges.find((edge) => edge.label === "null-count")?.value, {
    name: "x",
    count: null,
    flag: true,
    list: [1],
    nested: { k: 1 },
  });
  assertEquals(deriveEdges({ a: 1 }), deriveEdges({ a: 1 }), "edges are deterministic");
  assert(PROBES.length >= 5, "the top-level probes cover null, number, string, array and boolean");
});

Deno.test("go-port-schemas-corpus: every kept schema has fixtures", async () => {
  const inventory: { entries: IInventoryEntry[] } = JSON.parse(await Deno.readTextFile(INVENTORY));
  const keep = inventory.entries.filter((entry) => entry.class === "keep");
  const selection: ISelectionFile = JSON.parse(await Deno.readTextFile(join(SUITE_DIR, "suite.json")));
  const cases = join(SUITE_DIR, "generations", selection.generation, "cases");
  const bySchema = new Map<string, ICaseFile[]>();
  for await (const entry of Deno.readDir(cases)) {
    const item: ICaseFile = JSON.parse(await Deno.readTextFile(join(cases, entry.name)));
    bySchema.set(item.schema, [...(bySchema.get(item.schema) ?? []), item]);
  }
  for (const entry of keep) {
    const key = schemaKey(entry.module, entry.symbol);
    const found = bySchema.get(key) ?? [];
    assert(found.length > 0, `${key} has no fixtures`);
    const rejected = found.some((item) => item.reference.kind !== "value");
    const probes = found.filter((item) => item.id.includes("-probe-"));
    const acceptsEverything = probes.length >= PROBES.length && probes.every((item) => item.reference.kind === "value");
    assert(rejected || acceptsEverything, `${key} has neither a rejected input nor probes that all pass`);
  }
});

async function fakeSnapshot(dir: string): Promise<{ path: string; manifest: ISnapshotManifest }> {
  const path = join(dir, "snapshot");
  const src = join(path, "packages", "schemas", "src");
  const tests = join(path, "packages", "schemas", "tests");
  await Deno.mkdir(src, { recursive: true });
  await Deno.mkdir(tests, { recursive: true });
  await Deno.writeTextFile(join(path, "deno.json"), "{}\n");
  await Deno.writeTextFile(join(path, "deno.lock"), '{"version":"5"}\n');
  await Deno.writeTextFile(
    join(src, "alpha.ts"),
    `const fail = (path: string[], code: string) => ({ success: false, error: { issues: [{ path, code }] } });
export const AlphaSchema = {
  parse: (value: { name?: string }) => value,
  safeParse: (value: { name?: string } | null) =>
    value !== null && typeof value === "object" && typeof value.name === "string"
      ? { success: true, data: { name: value.name, kind: "alpha", created: new Date().toISOString(), id: crypto.randomUUID() } }
      : fail(["name"], "invalid_type"),
};
`,
  );
  await Deno.writeTextFile(
    join(tests, "alpha_test.ts"),
    `import { AlphaSchema } from "../src/alpha.ts";
Deno.test("alpha accepts a name", () => {
  AlphaSchema.safeParse({ name: "recorded" });
});
`,
  );
  await git(path, "init", "-q");
  await git(path, "add", "-A");
  await git(path, "commit", "-q", "-m", "base");
  const head = await git(path, "rev-parse", "HEAD");
  const lock = await Deno.readFile(join(path, "deno.lock"));
  const body = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    content_hash: "",
    parent: head,
    submodules: {},
    lockfiles: { "deno.lock": await sha256Hex(lock) },
    runtime: { deno: "", go: "", docker: "" },
    images: {},
    scenarios: {},
    fixtures: {},
    dirty: false,
  };
  const manifest = { ...body, content_hash: await contentHash(body) } as ISnapshotManifest;
  return { path, manifest };
}

Deno.test("go-port-schemas-corpus: regeneration yields the same generation digest", async () => {
  await withTempDir(async (dir) => {
    const fake = await fakeSnapshot(dir);
    const suites = {
      schemas: schemasSuiteFor([{ module: "packages/schemas/src/alpha.ts", symbol: "AlphaSchema" }]),
    };
    const first = await generateSuite({
      suite: "schemas",
      target: join(dir, "first"),
      snapshot: fake.path,
      manifest: fake.manifest,
      suites,
    });
    const second = await generateSuite({
      suite: "schemas",
      target: join(dir, "second"),
      snapshot: fake.path,
      manifest: fake.manifest,
      suites,
    });
    assertEquals(second, first);
    const generation = join(dir, "first", "generations", first, "cases");
    const kinds = new Map<string, string>();
    for await (const entry of Deno.readDir(generation)) {
      const item: ICaseFile = JSON.parse(await Deno.readTextFile(join(generation, entry.name)));
      kinds.set(item.id, item.reference.kind);
    }
    assert([...kinds.keys()].some((id) => id.includes("-mined-")), "the recorded test input is a case");
    assert([...kinds.keys()].some((id) => id.includes("-edge-")), "edges are derived from a valid input");
    assert([...kinds.keys()].some((id) => id.includes("-probe-")), "the top-level probes are cases");
    assertArrayIncludes([...kinds.values()], ["issues"], "a rejected input is recorded as an issue list");
    const sample: { reference: { value: { created: string; id: string } } } = JSON.parse(
      await Deno.readTextFile(join(generation, "alpha-alphaschema-mined-001.json")),
    );
    assertEquals(sample.reference.value.created, "2026-01-01T00:00:00.000Z");
    assertEquals(sample.reference.value.id, "00000000-0000-4000-8000-000000000001");
  });
});
