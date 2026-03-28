/**
 * @module BuildAgentsIndexTest
 * @path tests/build_agents_index_test.ts
 * @description Verifies the logic for generating the agent registry index, ensuring
 * that all discovered agent metadata is correctly aggregated for runtime lookups.
 */

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.203.0/assert/mod.ts";
import { PortalOperation } from "../../src/shared/enums.ts";

import { buildIndex, chunkText, extractFrontmatter } from "../scripts/build_agents_index.ts";

Deno.test("build_agents_index creates manifest and chunks (skips if no write access)", async () => {
  const perm = await Deno.permissions.query({ name: PortalOperation.WRITE as "write", path: ".copilot/chunks" });
  if (perm.state !== "granted") {
    console.warn("Skipping buildIndex test because write permission to .copilot/chunks is not granted");
    return;
  }

  await buildIndex();
  assertExists(".copilot/manifest.json");
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

Deno.test("chunkText splits paragraphs into separate chunks when size is small", () => {
  const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
  const chunks = chunkText(text, 20);
  assertEquals(chunks.length, 3);
  assertEquals(chunks[0], "First paragraph.");
  assertEquals(chunks[1], "Second paragraph.");
  assertEquals(chunks[2], "Third paragraph.");
});

Deno.test("chunkText merges paragraphs until size limit is exceeded", () => {
  const text = ["aaaaa", "bbbbb", "ccccc", "ddddd"].join("\n\n");
  // size 12 -> 'aaaaa' (5) + "\n\n" (2) + 'bbbbb' (5) = 12 => fits
  const chunks = chunkText(text, 12);
  // expect first chunk contains first two paragraphs, others split accordingly
  assert(chunks.length >= 2);
  assertEquals(chunks[0], "aaaaa\n\nbbbbb");
});

Deno.test("chunkText returns long paragraph as single chunk even if over size", () => {
  const long = "x".repeat(1000);
  const chunks = chunkText(long, 200);
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].length, 1000);
});
