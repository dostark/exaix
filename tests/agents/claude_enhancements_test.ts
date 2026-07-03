/**
 * @module ClaudeEnhancementsTest
 * @path tests/agents/claude_enhancements_test.ts
 * @description Verifies agent documentation structural integrity.
 */

import { assert, assertEquals, assertExists } from "@std/assert";

Deno.test("Claude enhancements: verify required files exist", async () => {
  const files = [
    ".copilot/cross-reference.md",
    ".copilot/README.md",
  ];

  for (const file of files) {
    const stat = await Deno.stat(file);
    assert(stat.isFile, `${file} should exist and be a file`);
  }
});

Deno.test("Claude enhancements: verify cross-reference.md structure", async () => {
  const crossRefMd = await Deno.readTextFile(".copilot/cross-reference.md");

  assert(crossRefMd.includes("## Task → Agent Doc Quick Reference"), "Should have task mapping table");
  assert(crossRefMd.includes("## Search by Topic"), "Should have topic search section");
});

Deno.test("Claude enhancements: verify manifest includes docs", async () => {
  const manifestText = await Deno.readTextFile(".copilot/manifest.json");
  const manifest = JSON.parse(manifestText);

  assert(manifest.docs, "Manifest should have 'docs' array");
  assert(Array.isArray(manifest.docs), "Manifest 'docs' should be an array");

  const paths = manifest.docs.map((d: { path: string }) => d.path);
  assert(paths.includes(".copilot/cross-reference.md"), "Manifest should include cross-reference.md");

  const crossRefDoc = manifest.docs.find((d: { path: string }) => d.path === ".copilot/cross-reference.md");
  assertExists(crossRefDoc, "cross-reference.md should be in manifest");
  assertEquals(crossRefDoc.short_summary.length > 0, true, "cross-reference.md should have short_summary");
});

Deno.test("Claude enhancements: verify no sensitive data in docs", async () => {
  const files: string[] = [];
  const secretPatterns = [
    /AKIA[A-Z0-9]{16}/,
    /sk-[a-zA-Z0-9]{32,}/,
    /ghp_[a-zA-Z0-9]{36}/,
    /ghs_[a-zA-Z0-9]{36}/,
  ];

  for await (const entry of Deno.readDir(".copilot")) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      files.push(`.copilot/${entry.name}`);
    }
  }

  for (const file of files) {
    const content = await Deno.readTextFile(file);
    for (const pattern of secretPatterns) {
      assert(!pattern.test(content), `${file} should not contain actual secrets matching ${pattern}`);
    }
  }
});
