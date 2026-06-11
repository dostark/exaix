/**
 * @module KnowledgeDocsTest
 * @path tests/docs/knowledge_readme_test.ts
 * @description Verifies the project's knowledge documentation, ensuring that
 * directory structures and RAG-based search usage are correctly described.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { MemoryBankSource, MemoryScope } from "@exaix/core";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");

async function readMemoryBanksDoc(): Promise<string> {
  const docPath = join(REPO_ROOT, "docs", "Memory_Banks.md");
  return await Deno.readTextFile(docPath);
}

async function docExists(filename: string): Promise<boolean> {
  try {
    const docPath = join(REPO_ROOT, filename);
    const stat = await Deno.stat(docPath);
    return stat.isFile;
  } catch {
    return false;
  }
}

// ============================================================================
// Documentation Existence Tests
// ============================================================================

Deno.test("Memory Banks documentation exists", async () => {
  const exists = await docExists("docs/Memory_Banks.md");
  assert(exists, "docs/Memory_Banks.md should exist");
});

// ============================================================================
// Memory Banks Documentation Content Tests
// ============================================================================

Deno.test("Memory Banks documentation documents directory structure", async () => {
  const doc = await readMemoryBanksDoc();

  assertStringIncludes(doc, "Projects");
  assertStringIncludes(doc, "Execution");
  assertStringIncludes(doc, "Memory/");
});

Deno.test("Memory Banks documentation documents CLI usage", async () => {
  const doc = await readMemoryBanksDoc();
  assertStringIncludes(doc, "exactl memory");
});

Deno.test("Memory Banks documentation has main title", async () => {
  const doc = await readMemoryBanksDoc();

  assert(
    doc.startsWith("# ") || doc.includes("\n# "),
    "Memory Banks documentation should have a main title",
  );
});

Deno.test("Memory Banks documentation documents directory purposes", async () => {
  const doc = await readMemoryBanksDoc();
  const lower = doc.toLowerCase();

  // Should explain what each directory is for
  const hasProjects = lower.includes(MemoryScope.PROJECT);
  const hasExecution = lower.includes(MemoryBankSource.EXECUTION);

  assert(hasProjects && hasExecution, "Documentation should document directory purposes");
});
