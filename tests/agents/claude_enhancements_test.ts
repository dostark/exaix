/**
 * @module ClaudeEnhancementsTest
 * @path tests/agents/claude_enhancements_test.ts
 * @description Verifies agent documentation structural integrity.
 */

import { assert } from "@std/assert";

Deno.test("Claude enhancements: verify required files exist", async () => {
  const files = [
    ".copilot/manifest.json",
    ".copilot/README.md",
  ];

  for (const file of files) {
    const stat = await Deno.stat(file);
    assert(stat.isFile, `${file} should exist and be a file`);
  }
});

Deno.test("Claude enhancements: verify manifest includes docs", async () => {
  const manifestText = await Deno.readTextFile(".copilot/manifest.json");
  const manifest = JSON.parse(manifestText);

  assert(manifest.docs, "Manifest should have 'docs' array");
  assert(Array.isArray(manifest.docs), "Manifest 'docs' should be an array");
  assert(manifest.docs.length > 0, "Manifest should have at least one doc entry");
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
