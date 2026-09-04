// deno-lint-ignore-file no-explicit-any
/**
 * @module CopilotAssertions
 * @path tests/helpers/copilot_assertions.ts
 * @description Provides specialized assertions for validating Copilot directives
 * and magic value externalization within the test suite.
 */

import { assert, assertExists } from "@std/assert";
import { parse } from "@std/yaml";

interface Frontmatter {
  agent?: string;
  scope: string;
  title: string;
  short_summary: string;
  version: string;
  [key: string]: any;
}

export async function assertFilesExist(files: string[]): Promise<void> {
  for (const file of files) {
    const stat = await Deno.stat(file);
    assert(stat.isFile, `${file} should exist and be a file`);
  }
}

export async function assertFrontmatterSchemaAndShortSummary(
  files: string[],
  options: { maxSummaryLength: number } = { maxSummaryLength: 200 },
): Promise<void> {
  for (const filePath of files) {
    const content = await Deno.readTextFile(filePath);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    assertExists(fmMatch, `${filePath} should have YAML frontmatter`);

    const fm = parse(fmMatch[1]) as Frontmatter;

    // Support both 'agent_role' (current) and 'agent' (legacy) field names
    assert(fm.agent_role || fm.agent, `${filePath} should have 'agent_role' or 'agent' field`);
    assert(fm.scope, `${filePath} should have scope`);
    assert(fm.title, `${filePath} should have title`);
    assert(fm.short_summary, `${filePath} should have short_summary`);
    assert(fm.version, `${filePath} should have version`);

    const summary = fm.short_summary as string;
    assert(
      summary.length <= options.maxSummaryLength,
      `${filePath} short_summary should be ≤${options.maxSummaryLength} chars, got ${summary.length}`,
    );
  }
}

export async function assertChunksWereGenerated(patterns: string[], chunkDir = ".copilot/chunks"): Promise<void> {
  for (const pattern of patterns) {
    let found = false;
    for await (const entry of Deno.readDir(chunkDir)) {
      if (!entry.isFile) continue;
      if (!entry.name.startsWith(pattern)) continue;
      found = true;

      const content = await Deno.readTextFile(`${chunkDir}/${entry.name}`);
      assert(content.length > 0, `Chunk file ${entry.name} should not be empty`);
    }
    assert(found, `Should have at least one chunk file matching ${pattern}`);
  }
}
