#!/usr/bin/env -S deno run -A
/**
 * @module CheckPhaseReferences
 * @path scripts/check_phase_references.ts
 * @description High-level document phase-reference detector — scans root-level .md
 * files (ARCHITECTURE.md, README.md, AGENTS.md, etc.) and docs/*.md for mentions of
 * concrete planning-phase numbers (e.g. "Phase 152"). Phase numbers are internal
 * planning artifacts and must not leak into user-facing or architecture documentation.
 *
 * Exempted: exaix-dev-docs/ (planning + dev docs), .copilot/ (agent docs), scripts/,
 * CHANGELOG.md, and any file in a directory that naturally references phases.
 *
 * Usage:
 *   deno run --allow-read scripts/check_phase_references.ts
 *
 * Exit codes:
 *   0 — no violations found
 *   1 — one or more violations found
 */

import { walk } from "@std/fs";
import { relative } from "@std/path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Phase number pattern: "Phase NNN" where NNN is 1-3 digits, or "PGAP-N" */
const PHASE_PATTERN = /\bPhase\s+\d{1,3}\b/;

async function main(): Promise<number> {
  let violations = 0;

  for await (const entry of walk(ROOT, {
    exts: [".md"],
    includeDirs: false,
    skip: [
      /[/\\]exaix-dev-docs[/\\]/,
      /[/\\]\.copilot[/\\]/,
      /[/\\]scripts[/\\]/,
      /[/\\]node_modules[/\\]/,
      /[/\\]\.git[/\\]/,
      /[/\\]docs[/\\]api[/\\]/,
      /[/\\]docs[/\\]planning[/\\]/,
      /CHANGELOG\.md$/,
    ],
  })) {
    const relPath = relative(ROOT, entry.path);

    // Only check root-level .md files and docs/*.md
    const isRootMd = !relPath.includes("/") && relPath.endsWith(".md");
    const isDocsMd = relPath.startsWith("docs/") || relPath.startsWith("ARCHITECTURE");
    if (!isRootMd && !isDocsMd) continue;

    const content = await Deno.readTextFile(entry.path);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(PHASE_PATTERN);
      if (match) {
        // Allow Phase in backtick-wrapped references or code examples
        const line = lines[i];
        const matchIdx = line.indexOf(match[0]);
        const beforeBacktick = line.lastIndexOf("`", matchIdx - 1);
        const afterBacktick = line.indexOf("`", matchIdx + match[0].length);
        const isCodeSpan = beforeBacktick !== -1 && afterBacktick !== -1;

        if (isCodeSpan) continue;

        console.error(
          `ERROR [phase-reference] ${relPath}:${i + 1} – ` +
          `Concrete phase reference found: "${match[0]}". ` +
          `Replace with a stable capability description.`,
        );
        violations++;
      }
    }
  }

  if (violations > 0) {
    console.error(`\n❌ ${violations} violation(s) found.`);
    return 1;
  }

  console.log("✅ No phase-reference violations found in high-level docs.");
  return 0;
}

Deno.exit(await main());
