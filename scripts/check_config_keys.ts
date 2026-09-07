#!/usr/bin/env -S deno run -A
/**
 * @module CheckConfigKeys
 * @path scripts/check_config_keys.ts
 * @description CI gate that scans for duplicate configurable({key: "..."}) calls
 *   across the codebase. Fails if any key is registered in two or more files.
 *
 * Usage:
 *   deno run -A scripts/check_config_keys.ts
 *
 * Exit codes:
 *   0 — no duplicate keys found
 *   1 — one or more duplicate keys detected
 */
import { walk } from "@std/fs";
import { join } from "@std/path";

const ROOT = new URL("..", import.meta.url).pathname;

const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /\.exa/,
  /coverage/,
  /dist/,
];

const configurableKeyPattern = /configurable\(\s*\{[^}]*?key\s*:\s*"([^"]+)"/g;

const keyToFiles = new Map<string, string[]>();

async function scanFile(filePath: string): Promise<void> {
  const content = await Deno.readTextFile(filePath);
  const relativePath = join(
    filePath.slice(ROOT.length),
  );
  for (const match of content.matchAll(configurableKeyPattern)) {
    const key = match[1];
    const existing = keyToFiles.get(key) ?? [];
    existing.push(relativePath);
    keyToFiles.set(key, existing);
  }
}

async function main(): Promise<void> {
  const sourceDirs = ["packages", "apps", "exaix-team"];
  const entries: string[] = [];

  for (const dir of sourceDirs) {
    for await (
      const entry of walk(join(ROOT, dir), {
        exts: [".ts"],
        skip: EXCLUDE_PATTERNS,
      })
    ) {
      if (entry.isFile && !entry.name.endsWith("_test.ts")) {
        entries.push(entry.path);
      }
    }
  }

  await Promise.all(entries.map(scanFile));

  let hasDuplicates = false;
  const sortedKeys = [...keyToFiles.keys()].sort();

  for (const key of sortedKeys) {
    const files = keyToFiles.get(key)!;
    if (files.length > 1) {
      if (!hasDuplicates) {
        console.error("❌ Duplicate configurable keys detected:\n");
        hasDuplicates = true;
      }
      console.error(`  "${key}" registered in ${files.length} files:`);
      for (const file of files) {
        console.error(`    - ${file}`);
      }
      console.error();
    }
  }

  if (hasDuplicates) {
    Deno.exit(1);
  }

  const totalKeys = keyToFiles.size;
  console.log(`✅ No duplicate configurable keys found (${totalKeys} unique key(s) across ${entries.length} file(s)).`);
}

if (import.meta.main) {
  await main();
}
