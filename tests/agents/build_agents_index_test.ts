/**
 * @module BuildAgentsIndexTest
 * @path tests/agents/build_agents_index_test.ts
 * @description Verifies the logic for generating the agent registry index, ensuring
 * that all discovered agent metadata is correctly aggregated for runtime lookups.
 */

import { assert } from "@std/assert";

import { buildIndex, extractFrontmatter } from "../../scripts/build_agents_index.ts";

Deno.test("build_agents_index creates manifest", async () => {
  await buildIndex();
  const mf = JSON.parse(await Deno.readTextFile(".copilot/manifest.json"));
  assert(Array.isArray(mf.docs) && mf.docs.length > 0, "manifest should contain docs");
});

Deno.test("extractFrontmatter returns the frontmatter block as string", () => {
  const md = `---\ntitle: Test\nversion: 1.0\n---\n\n# Content\n`;
  const fm = extractFrontmatter(md);
  assert(fm !== null);
  assert(fm!.includes("title: Test"));
  assert(fm!.includes("version: 1.0"));
});
