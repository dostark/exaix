/**
 * @module BuildAgentsIndexTest
 * @path tests/agents/build_agents_index_test.ts
 * @description Verifies the logic for generating the agent registry index, ensuring
 * that all discovered agent metadata is correctly aggregated for runtime lookups.
 * The generator writes into a throwaway directory, so the test never mutates the
 * committed `.copilot/manifest.json` or `.copilot/DOCS.md`.
 */

import { assert } from "@std/assert";
import { join } from "@std/path";

import { buildIndex, extractFrontmatter } from "../../scripts/build_agents_index.ts";
import { withTempDir } from "@exaix/testing";

Deno.test("build_agents_index writes the manifest and DOCS index into the target dir", async () => {
  await withTempDir(async (outDir) => {
    await buildIndex(false, outDir);

    const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json")));
    assert(Array.isArray(manifest.docs) && manifest.docs.length > 0, "manifest should contain docs");

    const docs = await Deno.readTextFile(join(outDir, "DOCS.md"));
    assert(docs.includes("## Task → Doc"), "DOCS index should contain the task table");
  });
});

Deno.test("extractFrontmatter returns the frontmatter block as string", () => {
  const md = `---\ntitle: Test\nversion: 1.0\n---\n\n# Content\n`;
  const fm = extractFrontmatter(md);
  assert(fm !== null);
  assert(fm!.includes("title: Test"));
  assert(fm!.includes("version: 1.0"));
});

Deno.test("no test calls buildIndex without an output directory, so test runs never rewrite committed docs", async () => {
  // A file list from git stays stable while other tests create and delete temporary directories.
  const listed = await new Deno.Command("git", {
    args: ["ls-files", "--cached", "--others", "--exclude-standard", "--", "tests"],
    stdout: "piped",
  }).output();
  const files = new TextDecoder().decode(listed.stdout).split("\n").filter((path) => path.endsWith(".ts"));
  const offenders: string[] = [];
  for (const path of files) {
    if (path.endsWith("build_agents_index_test.ts")) continue;
    const source = await Deno.readTextFile(path).catch((error) => {
      // A concurrent test can delete its temporary file between the listing and the read.
      if (error instanceof Deno.errors.NotFound) return "";
      throw error;
    });
    if (/\bbuildIndex\(\s*(?:true|false)?\s*\)/.test(source)) offenders.push(path);
  }
  assert(
    files.length > 0 && offenders.length === 0,
    `buildIndex() with the default output directory rewrites .copilot/manifest.json and DOCS.md: ${
      offenders.join(", ")
    }`,
  );
});
