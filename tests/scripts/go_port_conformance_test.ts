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
  type ISnapshotManifest,
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
