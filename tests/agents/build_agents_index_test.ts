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

Deno.test("build_agents_index writes the manifest and DOCS index into the target dir", async () => {
  const outDir = await Deno.makeTempDir();
  try {
    await buildIndex(false, outDir);

    const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json")));
    assert(Array.isArray(manifest.docs) && manifest.docs.length > 0, "manifest should contain docs");

    const docs = await Deno.readTextFile(join(outDir, "DOCS.md"));
    assert(docs.includes("## Task → Doc"), "DOCS index should contain the task table");
  } finally {
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test("extractFrontmatter returns the frontmatter block as string", () => {
  const md = `---\ntitle: Test\nversion: 1.0\n---\n\n# Content\n`;
  const fm = extractFrontmatter(md);
  assert(fm !== null);
  assert(fm!.includes("title: Test"));
  assert(fm!.includes("version: 1.0"));
});
