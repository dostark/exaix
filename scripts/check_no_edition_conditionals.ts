#!/usr/bin/env -S deno run -A

/**
 * @module CheckNoEditionConditionals
 * @path scripts/check_no_edition_conditionals.ts
 * Usage: deno run -A scripts/check_no_edition_conditionals.ts
 * @description Lightweight check: edition conditionals (edition === / EXAIX_EDITION)
 * may only appear in edition-aware directories. Phase 115 Step 9b.
 */

// app entries are edition-dispatch points (apps/daemon/main.ts, apps/exactl/src/init.ts)
const ALLOWED = [
  "apps/common",
  "packages-team",
  "exaix-enterprise",
  "scripts",
  ".github",
  "apps/daemon",
  "apps/exactl",
  "tests",
];
const SKIP = [".git", "node_modules", "dist", ".exa", "_archive"];
const PATTERN = 'EXAIX_EDITION|\\bedition\\s*===\\s*"';

let violations = 0;

for await (const entry of Deno.readDir(".")) {
  if (!entry.isDirectory || SKIP.includes(entry.name)) continue;
  const cmd = new Deno.Command("grep", {
    args: ["-rn", "--include=*.ts", "--include=*.js", "-E", PATTERN, entry.name],
    // Some dev shells export LD_LIBRARY_PATH; inheriting it makes subprocess spawn a
    // permission-sensitive op that this script's `--allow-run=grep` grant doesn't cover,
    // so scrub it for the child (same convention as check_edition_graph.ts).
    env: { LD_LIBRARY_PATH: "" },
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
