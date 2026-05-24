/**
 * @module AgentContextScoringTest
 * @path tests/scripts/inject_agent_context_test.ts
 * @description Verifies the document scoring logic for agent context injection,
 * ensuring the most relevant metadata is extracted for prompt grounding.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";

import { inject } from "../../scripts/inject_agent_context.ts";
import { REPO_ROOT, withRepoRoot } from "@exaix/testing";
import { readFixtureTextSync } from "@exaix/testing";

// Helper to create temporary markdown files under .copilot/providers
async function writeAgentMarkdown(filename: string, content: string) {
  const dir = join(REPO_ROOT, ".copilot", "providers");
  await ensureDir(dir);
  const path = join(dir, filename);
  await Deno.writeTextFile(path, content);
  return path;
}

Deno.test("inject returns found=false when no matching agent docs", async () => {
  const res = await withRepoRoot(() => inject("nonexistent-agent", "something"));
  assertEquals(res.found, false);
});

Deno.test("inject finds best doc and extracts title/summary/snippet", async () => {
  const filename = `test-inject-${Date.now()}.md`;
  const unique = `snippet-unique-${Date.now()}`;
  const md = `---
identity: copilot
title: Test Agent
short_summary: A short summary
---

This paragraph contains ${unique} and should be the snippet extracted.

This is the second paragraph.`;

  const path = await writeAgentMarkdown(filename, md);

  try {
    const res = await withRepoRoot(() => inject("copilot", unique));
    assertEquals(res.found, true);
    assert(res.path?.endsWith(filename));
    assertEquals(res.title, "Test Agent");
    assertEquals(res.short_summary, "A short summary");
    assertEquals(res.snippet, `This paragraph contains ${unique} and should be the snippet extracted.`);
  } finally {
    await Deno.remove(path).catch(() => {});
  }
});

Deno.test("inject selects best-scoring document among multiple candidates", async () => {
  const f1 = `candidate-a-${Date.now()}.md`;
  const f2 = `candidate-b-${Date.now()}.md`;

  const md1 = readFixtureTextSync(import.meta.url, "scripts", "inject_agent_context_test", "md1.md");
  const md2 = readFixtureTextSync(import.meta.url, "scripts", "inject_agent_context_test", "md2.md");
  const p1 = await writeAgentMarkdown(f1, md1);
  const p2 = await writeAgentMarkdown(f2, md2);

  try {
    const res = await withRepoRoot(() => inject("copilot", "foobar again"));
    assertEquals(res.found, true);
    // should pick the higher scoring doc (md2)
    assert(res.path?.endsWith(f2));
    assertEquals(res.title, "High Score");
  } finally {
    await Deno.remove(p1).catch(() => {});
    await Deno.remove(p2).catch(() => {});
  }
});

Deno.test("script exits with code 2 and prints usage when no query provided", async () => {
  // Run as a subprocess without --query to trigger the usage exit
  const cmd = new Deno.Command("deno", {
    args: ["run", "--quiet", "--allow-read", join(REPO_ROOT, "scripts/inject_agent_context.ts")],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stderr } = await cmd.output();
  const errStr = new TextDecoder().decode(stderr);

  // deno run exits with code 2 when usage is missing
  assert(code === 2, `Expected exit code 2, got ${code}. stderr: ${errStr}`);
  assert(errStr.includes("Usage: --query <text> --agent <agent>"), `Expected usage message in stderr, got: ${errStr}`);
});

Deno.test("main prints found=false JSON when no doc matches", async () => {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--quiet",
      "--allow-read",
      join(REPO_ROOT, "scripts/inject_agent_context.ts"),
      "--query",
      "nope",
      "--agent",
      "nonexistent-agent",
    ],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout } = await cmd.output();
  const outStr = new TextDecoder().decode(stdout);

  assertEquals(code, 0);
  assert(outStr.includes('"found":false'));
});

Deno.test("inject handles docs missing title/short_summary", async () => {
  const filename = `test-inject-empty-meta-${Date.now()}.md`;
  const md = `---
identity: copilot
---

This doc has no title or short summary but has a paragraph.`;

  const path = await writeAgentMarkdown(filename, md);

  try {
    const res = await withRepoRoot(() => inject("copilot", "paragraph"));
    assertEquals(res.found, true);
    assertEquals(res.title, "");
    assertEquals(res.short_summary, "");
    assertEquals(res.snippet, "This doc has no title or short summary but has a paragraph.");
  } finally {
    await Deno.remove(path).catch(() => {});
  }
});
