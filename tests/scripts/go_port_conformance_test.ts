/**
 * @module GoPortConformanceTest
 * @path tests/scripts/go_port_conformance_test.ts
 * @description Exercises the frozen suite generator, snapshot checks and atomic publication.
 * @architectural-layer Test
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "@exaix/testing";
import {
  generateSuite,
  type ICaseResultV2,
  type ISnapshotManifest,
  type ISuiteDefinition,
  loadManifest,
  prepareGeneration,
  verifySnapshot,
} from "../../scripts/go_port/conformance/generate.ts";
import { contentHash, sha256Hex } from "../../scripts/go_port/snapshot_manifest.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));

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

async function snapshot(dir: string): Promise<{ path: string; manifest: ISnapshotManifest; manifestPath: string }> {
  const path = join(dir, "snapshot");
  const source = join(ROOT, "packages", "core", "src", "planning", "delegate_brief.ts");
  const target = join(path, "packages", "core", "src", "planning", "delegate_brief.ts");
  await Deno.mkdir(join(path, "packages", "core", "src", "planning"), { recursive: true });
  await Deno.writeTextFile(target, await Deno.readTextFile(source));
  await Deno.writeTextFile(join(path, "deno.json"), "{}\n");
  await Deno.writeTextFile(join(path, "deno.lock"), '{"version":"5"}\n');
  await git(path, "init", "-q");
  await git(path, "add", "-A");
  await git(path, "commit", "-q", "-m", "base");
  const head = await git(path, "rev-parse", "HEAD");
  return buildManifest(dir, path, head);
}

async function buildManifest(
  dir: string,
  path: string,
  parent: string,
): Promise<{ path: string; manifest: ISnapshotManifest; manifestPath: string }> {
  const lock = await Deno.readFile(join(path, "deno.lock"));
  const body = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    content_hash: "",
    parent,
    submodules: {},
    lockfiles: { "deno.lock": await sha256Hex(lock) },
    runtime: { deno: "", go: "", docker: "" },
    images: {},
    scenarios: {},
    fixtures: {},
    dirty: false,
  };
  const manifest = { ...body, content_hash: await contentHash(body) } as ISnapshotManifest;
  const manifestPath = join(dir, "manifest.json");
  await Deno.writeTextFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return { path, manifest, manifestPath };
}

Deno.test("go-port-conformance: two runs are identical and ignore the current checkout", async () => {
  await withTempDir(async (dir) => {
    const fake = await snapshot(dir);
    const target = join(dir, "suite");
    const first = await generateSuite({
      suite: "acceptance-bullets",
      target,
      snapshot: fake.path,
      manifest: fake.manifest,
    });
    const firstSuite = await Deno.readTextFile(join(target, "suite.json"));
    const current = join(ROOT, "packages", "core", "src", "planning", "delegate_brief.ts");
    const original = await Deno.readTextFile(current);
    try {
      await Deno.writeTextFile(current, original.replace("return [];", 'return ["mutated"];'));
      const second = await generateSuite({
        suite: "acceptance-bullets",
        target,
        snapshot: fake.path,
        manifest: fake.manifest,
      });
      assertEquals(second, first);
      assertEquals(await Deno.readTextFile(join(target, "suite.json")), firstSuite);
    } finally {
      await Deno.writeTextFile(current, original);
    }
  });
});

Deno.test("go-port-conformance: a wrong parent, dirty tree or changed lockfile is rejected", async () => {
  await withTempDir(async (dir) => {
    const fake = await snapshot(dir);
    const wrong = await buildManifest(dir, fake.path, "0".repeat(40));
    assert((await verifySnapshot(fake.path, wrong.manifest)).length > 0);
    await Deno.writeTextFile(join(fake.path, "dirty.txt"), "dirty\n");
    assert((await verifySnapshot(fake.path, fake.manifest)).some((error) => error.includes("clean")));
    await Deno.remove(join(fake.path, "dirty.txt"));
    await Deno.writeTextFile(join(fake.path, "deno.lock"), '{"version":"5","changed":true}\n');
    assert((await verifySnapshot(fake.path, fake.manifest)).some((error) => error.includes("lockfile")));
  });
});

Deno.test("go-port-conformance: the manifest digest is verified", async () => {
  await withTempDir(async (dir) => {
    const fake = await snapshot(dir);
    assertEquals((await loadManifest(fake.manifestPath)).parent, fake.manifest.parent);
    const tampered = { ...fake.manifest, content_hash: "0".repeat(64) };
    await Deno.writeTextFile(fake.manifestPath, `${JSON.stringify(tampered)}\n`);
    await assertRejects(() => loadManifest(fake.manifestPath), Error, "digest");
  });
});

Deno.test("go-port-conformance: an interrupted regeneration keeps the previous selection", async () => {
  await withTempDir(async (dir) => {
    const fake = await snapshot(dir);
    const target = join(dir, "suite");
    await generateSuite({ suite: "acceptance-bullets", target, snapshot: fake.path, manifest: fake.manifest });
    const before = await Deno.readTextFile(join(target, "suite.json"));
    const results = [
      { id: "absent-heading", expected: { kind: "value" as const, value: [] } },
      { id: "dash-bullets", expected: { kind: "value" as const, value: ["one", "two"] } },
      { id: "star-bullets", expected: { kind: "value" as const, value: ["one", "two"] } },
      { id: "subsequent-heading", expected: { kind: "value" as const, value: ["one"] } },
    ];
    await prepareGeneration(target, "acceptance-bullets", results, fake.manifest);
    assertEquals(await Deno.readTextFile(join(target, "suite.json")), before);
  });
});

const GOLDEN_CASE =
  '{"go":{"kind":"value","value":12},"id":"old-octal","input":{"content":"{\\"a\\":1}","kind":"json"},"reference":{"kind":"value","value":10},"schema":"Alpha"}\n';

const FIXTURE_SUITES: Readonly<Record<string, ISuiteDefinition>> = {
  fixture: {
    version: 2,
    cases: [{
      id: "old-octal",
      schema: "Alpha",
      input: { kind: "json", content: '{"a":1}' },
      go: { kind: "value", value: 12 },
    }],
    evaluate: (_snapshot, cases) =>
      Promise.resolve(cases.map((item) => ({ id: item.id, reference: { kind: "value", value: 10 } }))),
  },
};

interface ISelectionFile {
  readonly schema_version: number;
  readonly generator_version: string;
  readonly generation: string;
}

interface IManifestFile {
  readonly schema_version: number;
  readonly cases: readonly { readonly id: string; readonly file: string; readonly sha256: string }[];
}

async function readSelection(path: string): Promise<ISelectionFile> {
  return JSON.parse(await Deno.readTextFile(path));
}

async function readManifest(path: string): Promise<IManifestFile> {
  return JSON.parse(await Deno.readTextFile(path));
}

Deno.test("go-port-conformance: acceptance-bullets regenerates byte-identical", async () => {
  await withTempDir(async (dir) => {
    const fake = await snapshot(dir);
    const target = join(dir, "suite");
    await generateSuite({ suite: "acceptance-bullets", target, snapshot: fake.path, manifest: fake.manifest });
    const committedRoot = join(ROOT, "exaix-go", "testdata", "conformance", "acceptance-bullets");
    const committed = await readSelection(join(committedRoot, "suite.json"));
    const regenerated = await readSelection(join(target, "suite.json"));
    assertEquals(regenerated.schema_version, 1);
    assertEquals(regenerated.generator_version, "1");
    const committedGeneration = join(committedRoot, "generations", committed.generation);
    const regeneratedGeneration = join(target, "generations", regenerated.generation);
    const committedManifest = await readManifest(join(committedGeneration, "manifest.json"));
    const regeneratedManifest = await readManifest(join(regeneratedGeneration, "manifest.json"));
    assertEquals(regeneratedManifest.cases, committedManifest.cases);
    assertEquals(regeneratedManifest.schema_version, 1);
    for await (const entry of Deno.readDir(join(committedGeneration, "cases"))) {
      assertEquals(
        await Deno.readTextFile(join(regeneratedGeneration, "cases", entry.name)),
        await Deno.readTextFile(join(committedGeneration, "cases", entry.name)),
      );
    }
  });
});

Deno.test("go-port-conformance: a version 2 suite emits typed cases with the reference and the Go outcome", async () => {
  await withTempDir(async (dir) => {
    const fake = await snapshot(dir);
    const target = join(dir, "suite");
    await generateSuite({
      suite: "fixture",
      target,
      snapshot: fake.path,
      manifest: fake.manifest,
      suites: FIXTURE_SUITES,
    });
    const selection = await readSelection(join(target, "suite.json"));
    assertEquals(selection.schema_version, 2);
    assertEquals(selection.generator_version, "2");
    const generation = join(target, "generations", selection.generation);
    assertEquals((await readManifest(join(generation, "manifest.json"))).schema_version, 2);
    assertEquals(await Deno.readTextFile(join(generation, "cases", "old-octal.json")), GOLDEN_CASE);
  });
});

Deno.test("go-port-conformance: a version 2 case rejects an unknown expectation kind", async () => {
  await withTempDir(async (dir) => {
    const fake = await snapshot(dir);
    const results: ICaseResultV2[] = JSON.parse('[{"id":"old-octal","reference":{"kind":"maybe"}}]');
    await assertRejects(
      () => prepareGeneration(dir, "fixture", results, fake.manifest, FIXTURE_SUITES),
      Error,
      "expectation kind",
    );
    const issues: ICaseResultV2[] = JSON.parse(
      '[{"id":"old-octal","reference":{"kind":"issues","issues":[{"path":[1.5],"code":"x"}]}}]',
    );
    await assertRejects(
      () => prepareGeneration(dir, "fixture", issues, fake.manifest, FIXTURE_SUITES),
      Error,
      "issue path",
    );
  });
});

Deno.test("go-port-conformance: a version 2 outcome needs its value or issue list", async () => {
  await withTempDir(async (dir) => {
    const fake = await snapshot(dir);
    const noValue: ICaseResultV2[] = JSON.parse('[{"id":"old-octal","reference":{"kind":"value"}}]');
    await assertRejects(
      () => prepareGeneration(dir, "fixture", noValue, fake.manifest, FIXTURE_SUITES),
      Error,
      "no value",
    );
    const noList: ICaseResultV2[] = JSON.parse('[{"id":"old-octal","reference":{"kind":"issues"}}]');
    await assertRejects(
      () => prepareGeneration(dir, "fixture", noList, fake.manifest, FIXTURE_SUITES),
      Error,
      "no issue list",
    );
    const nullValue: ICaseResultV2[] = JSON.parse('[{"id":"old-octal","reference":{"kind":"value","value":null}}]');
    const prepared = await prepareGeneration(dir, "fixture", nullValue, fake.manifest, FIXTURE_SUITES);
    assertEquals(typeof prepared.digest, "string");
  });
});
