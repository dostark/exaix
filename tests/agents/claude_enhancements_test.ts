/**
 * @module ClaudeEnhancementsTest
 * @path tests/agents/claude_enhancements_test.ts
 * @description Verifies specialized documentation for Anthropic Claude agents,
 * ensuring structural quality and content completeness.
 */

// Unit tests to verify Step 10.5 Claude enhancements are properly implemented
// Usage: deno test --allow-read tests/agents/claude_enhancements_test.ts

import { assert, assertExists } from "@std/assert";
import { parse } from "@std/yaml";
import { inject } from "../../scripts/inject_agent_context.ts";
import type { JSONObject } from "@exaix/core/types/json.ts";

Deno.test("Claude enhancements: verify all required files exist", async () => {
  // Verify all enhanced files were created
  const files = [
    ".copilot/providers/claude.md",
    ".copilot/cross-reference.md",
    ".copilot/README.md",
  ];

  for (const file of files) {
    const stat = await Deno.stat(file);
    assert(stat.isFile, `${file} should exist and be a file`);
  }
});

Deno.test("Claude enhancements: verify all sections exist in claude.md", async () => {
  const claudeMd = await Deno.readTextFile(".copilot/providers/claude.md");

  // Verify required sections
  assert(claudeMd.includes("## Task-Specific System Prompts"), "Should have Task-Specific System Prompts section");
  assert(claudeMd.includes("### TDD Workflow"), "Should have TDD Workflow section");
  assert(claudeMd.includes("### Refactoring"), "Should have Refactoring section");
  assert(claudeMd.includes("### Debugging"), "Should have Debugging section");
  assert(claudeMd.includes("### Documentation"), "Should have Documentation section");
  assert(claudeMd.includes("## Thinking Protocol for Complex Tasks"), "Should have Thinking Protocol section");
  assert(claudeMd.includes("## Tool-Use Patterns for Claude"), "Should have Tool-Use Patterns section");
  assert(claudeMd.includes("## Common Pitfalls with Exaix"), "Should have Common Pitfalls section");

  // Verify examples
  assert(claudeMd.includes("initTestDbService"), "Should reference initTestDbService helper");
  assert(claudeMd.includes("createCliTestContext"), "Should reference createCliTestContext helper");
  assert(claudeMd.includes("<thinking>"), "Should include thinking tag example");

  // Verify at least 8 common pitfalls
  const pitfallsSection = claudeMd.split("## Common Pitfalls with Exaix")[1];
  const pitfallCount = (pitfallsSection.match(/###\s+\d+\./g) || []).length;
  assert(pitfallCount >= 8, `Should have at least 8 common pitfalls, found ${pitfallCount}`);
});

Deno.test("Claude enhancements: verify cross-reference.md structure", async () => {
  const crossRefMd = await Deno.readTextFile(".copilot/cross-reference.md");

  // Verify required sections
  assert(crossRefMd.includes("## Task → Agent Doc Quick Reference"), "Should have task mapping table");
  assert(crossRefMd.includes("## Search by Topic"), "Should have topic search section");
  assert(crossRefMd.includes("## Workflow Examples"), "Should have workflow examples section");

  // Verify it includes key task types (titles)
  assert(crossRefMd.includes("Exaix Test Development Guidelines"), "Should map Test Guidelines task");
  assert(crossRefMd.includes("Refactoring Skill"), "Should map Refactoring task");
  assert(crossRefMd.includes("Commit Skill"), "Should map Commit skill");
  assert(crossRefMd.includes("guidelines/"), "Should link to guidelines directory");

  // Verify it links to other docs
  assert(crossRefMd.includes("[guidelines/testing.md]"), "Should link to testing.md");
  assert(crossRefMd.includes("[guidelines/exaix-development.md]"), "Should link to exaix.md");
  assert(crossRefMd.includes("[providers/claude.md]"), "Should link to claude.md");
});

Deno.test("Claude enhancements: verify README.md has Quick Start Guide", async () => {
  const readmeMd = await Deno.readTextFile(".copilot/README.md");

  // Verify Quick Start Guide section exists
  assert(readmeMd.includes("How to Add a New Agent Doc"), "Should have 'How to Add a New Agent Doc' section");

  // Verify it includes the steps (Step 5 Build Embeddings removed)
  assert(readmeMd.includes("1. Create File in Appropriate Subfolder"), "Should have step 1");
  assert(readmeMd.includes("2. Add YAML Frontmatter"), "Should have step 2");
  assert(readmeMd.includes("3. Include Required Sections"), "Should have step 3");
  assert(readmeMd.includes("4. Regenerate Manifest"), "Should have step 4");
  assert(readmeMd.includes("5. Validate"), "Should have step 5");
  assert(readmeMd.includes("6. Test Retrieval"), "Should have step 6");

  // Verify frontmatter template
  assert(readmeMd.includes("identity:"), "Should include frontmatter template with agent field");
  assert(readmeMd.includes("scope:"), "Should include frontmatter template with scope field");
  assert(readmeMd.includes("short_summary:"), "Should include frontmatter template with short_summary field");

  // Verify common mistakes section
  assert(readmeMd.includes("Common Mistakes to Avoid"), "Should have Common Mistakes section");
});

Deno.test("Claude enhancements: verify frontmatter schema compliance", async () => {
  const files = [
    ".copilot/providers/claude.md",
    ".copilot/cross-reference.md",
  ];

  for (const filePath of files) {
    const content = await Deno.readTextFile(filePath);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assertExists(fmMatch, `${filePath} should have YAML frontmatter`);

    const fm = parse(fmMatch[1]) as JSONObject;

    // Verify required fields
    assert(fm.identity, `${filePath} should have 'identity' field`);
    assert(fm.scope, `${filePath} should have 'scope' field`);
    assert(fm.title, `${filePath} should have 'title' field`);
    assert(fm.short_summary, `${filePath} should have 'short_summary' field`);
    assert(fm.version, `${filePath} should have 'version' field`);

    // Verify short_summary length
    const summary = fm.short_summary as string;
    assert(summary.length <= 200, `${filePath} short_summary should be ≤200 chars, got ${summary.length}`);
  }
});

Deno.test("Claude enhancements: verify version updates", async () => {
  const claudeMd = await Deno.readTextFile(".copilot/providers/claude.md");
  const fmMatch = claudeMd.match(/^---\n([\s\S]*?)\n---/);
  assertExists(fmMatch);

  const fm = parse(fmMatch[1]) as JSONObject;

  // claude.md should be updated to v0.2 or higher (was expanded significantly)
  const version = fm.version as string;
  assert(version !== "0.1", "claude.md version should be updated from 0.1");
});

Deno.test("Claude enhancements: verify manifest includes new docs", async () => {
  const manifestText = await Deno.readTextFile(".copilot/manifest.json");
  const manifest = JSON.parse(manifestText);

  // Verify manifest structure
  assert(manifest.docs, "Manifest should have 'docs' array");
  assert(Array.isArray(manifest.docs), "Manifest 'docs' should be an array");

  // Verify new docs are in manifest
  const paths = manifest.docs.map((d: { path: string }) => d.path);
  assert(paths.includes(".copilot/cross-reference.md"), "Manifest should include cross-reference.md");

  // Verify updated docs have chunks
  const crossRefDoc = manifest.docs.find((d: { path: string }) => d.path === ".copilot/cross-reference.md");
  assertExists(crossRefDoc, "cross-reference.md should be in manifest");
  assert(Array.isArray(crossRefDoc.chunks), "cross-reference.md should have chunks array");
  assert(crossRefDoc.chunks.length > 0, "cross-reference.md should have at least 1 chunk");
});

Deno.test("Claude enhancements: verify chunks were generated", async () => {
  // Verify chunk files exist for new docs
  const chunkPatterns = [
    ".copilot/chunks/cross-reference.md.chunk",
  ];

  for (const pattern of chunkPatterns) {
    // Find at least one chunk file matching the pattern
    let found = false;
    for await (const entry of Deno.readDir(".copilot/chunks")) {
      if (entry.name.startsWith(pattern.replace(".copilot/chunks/", ""))) {
        found = true;
        // Verify chunk file is not empty
        const content = await Deno.readTextFile(`.copilot/chunks/${entry.name}`);
        assert(content.length > 0, `Chunk file ${entry.name} should not be empty`);
      }
    }
    assert(found, `Should have at least one chunk file matching ${pattern}`);
  }
});

Deno.test("Claude enhancements: verify context injection works", async () => {
  // This is a functional test of the inject_agent_context script
  // We'll test that it can find the new docs

  // Test cross-reference query
  const crossRefResult = await inject("general", "task mapping quick reference", 4);
  assert(crossRefResult.found, "Should find cross-reference doc");
  assert(
    crossRefResult.path?.includes("cross-reference.md") || crossRefResult.path?.includes("README.md"),
    "Should return cross-reference.md or README.md for task mapping query",
  );

  // Test TDD query
  const tddResult = await inject("claude", "TDD test patterns", 4);
  assert(tddResult.found, "Should find TDD-related doc");
  assert(
    tddResult.path?.includes("testing.md") || tddResult.path?.includes("exaix.md") ||
      tddResult.path?.includes("claude.md"),
    "Should return testing/exaix/claude doc for TDD query",
  );
});

Deno.test("Claude enhancements: verify no sensitive data in docs", async () => {
  // Verify that docs don't contain actual secrets
  const files = [
    ".copilot/providers/claude.md",
    ".copilot/cross-reference.md",
  ];

  const secretPatterns = [
    /AKIA[A-Z0-9]{16}/, // AWS access key
    /sk-[a-zA-Z0-9]{32,}/, // OpenAI API key pattern
    /ghp_[a-zA-Z0-9]{36}/, // GitHub personal access token
    /ghs_[a-zA-Z0-9]{36}/, // GitHub secret
  ];

  for (const file of files) {
    const content = await Deno.readTextFile(file);
    for (const pattern of secretPatterns) {
      assert(!pattern.test(content), `${file} should not contain actual secrets matching ${pattern}`);
    }
  }
});
