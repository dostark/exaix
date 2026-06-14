#!/usr/bin/env -S deno run -A

/**
 * @module CheckNoEditionConditionals
 * @path scripts/check_no_edition_conditionals.ts
 * Usage: deno run -A scripts/check_no_edition_conditionals.ts
 * @description Lightweight check: edition conditionals (edition === / EXAIX_EDITION)
 * may only appear in edition-aware directories. Phase 115 Step 9b.
 */

const ALLOWED = ["apps/common", "packages-team", "exaix-enterprise", "scripts", ".github"];
const SKIP = [".git", "node_modules", "dist", ".exa", "_archive"];
const PATTERN = 'EXAIX_EDITION|\\bedition\\s*===\\s*"';

let violations = 0;

for await (const entry of Deno.readDir(".")) {
  if (!entry.isDirectory || SKIP.includes(entry.name)) continue;
  const cmd = new Deno.Command("grep", {
    args: ["-rn", "--include=*.ts", "--include=*.js", "-E", PATTERN, entry.name],
    stdout: "piped",
    stderr: "null",
  });
  const { stdout } = await cmd.output();
  const out = new TextDecoder().decode(stdout);
  for (const line of out.split("\n").filter(Boolean)) {
    if (ALLOWED.some((p) => line.includes(p))) continue;
    console.error(`❌ ${line}`);
    violations++;
  }
}

if (violations > 0) {
  console.error(`Found ${violations} violation(s).`);
  Deno.exit(1);
}
console.log("✅ No edition conditionals outside allowed directories.");
