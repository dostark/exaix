#!/usr/bin/env -S deno run -A
/**
 * @module CheckEventStrings
 * @path scripts/check_event_strings.ts
 * @description Inline Event String Detector — scans TypeScript production sources
 * for IEventLogger method calls (info/warn/error/fatal/debug) where the first
 * argument is a string literal instead of a DomainEventType member.
 *
 * Usage:
 *   deno run --allow-read scripts/check_event_strings.ts
 *   deno run --allow-read scripts/check_event_strings.ts --include-tests
 *
 * Exit codes:
 *   0 — no violations found
 *   1 — one or more violations found
 */

import { walk } from "@std/fs";
import { relative } from "@std/path";

const args = new Set(Deno.args);
const includeTests = args.has("--include-tests");

const SKIP_FILES = new Set([
  "domain_event_types.ts",
]);

const TEST_PATTERNS = [/_test\.ts$/, /\/tests\//, /^tests\//];

// Matches IEventLogger calls with a string-literal first argument, on identifiers whose
// name ends with "logger"/"Logger" (avoids display.info(), console.error(), etc.), and
// only flags strings starting with a lowercase letter (event type convention).
const LOGGER_INLINE_PATTERN =
  /\b\w*[Ll]og(?:ger)?\s*\.\s*(?:info|warn|error|fatal|debug)\s*\(\s*["'][a-z][a-zA-Z0-9._/:-]*/;

// Matches EventRegistry.emit() calls where the event type argument (2nd arg)
// is a string literal: .emit("sourceId", "event.string", ...)
const REGISTRY_EMIT_INLINE_PATTERN = /\.emit\s*\(\s*["'][^"']+["']\s*,\s*["'][a-z][a-zA-Z0-9._/-]*/;

// Lines that are part of the DomainEventType definition itself (const object entries)
const DOMAIN_EVENT_ENTRY_PATTERN = /^\s+\w+:\s*["']/;

interface Violation {
  file: string;
  line: number;
  col: number;
  text: string;
  kind: string;
}

const violations: Violation[] = [];
const scannedFiles: number[] = [];

for (const dir of ["packages", "exaix-team", "apps"]) {
  let dirExists = true;
  try {
    await Deno.stat(dir);
  } catch {
    dirExists = false;
  }
  if (!dirExists) continue;

  for await (const entry of walk(dir, { exts: [".ts"], followSymlinks: false })) {
    if (SKIP_FILES.has(entry.name)) continue;
    if (!includeTests && TEST_PATTERNS.some((p) => p.test(entry.path))) continue;

    const content = await Deno.readTextFile(entry.path);
    const lines = content.split("\n");
    scannedFiles.push(1);

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();

      // Skip comment lines
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        continue;
      }

      // Skip DomainEventType const object entries (the definition file itself is already
      // excluded, but guard against similar patterns elsewhere)
      if (DOMAIN_EVENT_ENTRY_PATTERN.test(raw)) continue;

      const colLogger = LOGGER_INLINE_PATTERN.exec(raw);
      if (colLogger) {
        violations.push({
          file: relative(".", entry.path),
          line: i + 1,
          col: colLogger.index + 1,
          text: trimmed.slice(0, 120),
          kind: "logger-inline-string",
        });
        continue;
      }

      const colRegistry = REGISTRY_EMIT_INLINE_PATTERN.exec(raw);
      if (colRegistry) {
        violations.push({
          file: relative(".", entry.path),
          line: i + 1,
          col: colRegistry.index + 1,
          text: trimmed.slice(0, 120),
          kind: "registry-emit-inline-string",
        });
      }
    }
  }
}

const fileCount = scannedFiles.reduce((a, b) => a + b, 0);

if (violations.length === 0) {
  console.log(`✅ No inline event string literals found (${fileCount} files scanned).`);
  Deno.exit(0);
}

console.error(`\n❌ Found ${violations.length} inline event string literal(s) in ${fileCount} files:\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}:${v.col}  [${v.kind}]`);
  console.error(`    ${v.text}`);
  console.error();
}
console.error("Replace inline strings with DomainEventType members from @exaix/core/events.");
console.error("See CODE_STYLE.md#event-type-strings and docs/Reference_Data.md#event-taxonomy.");
Deno.exit(1);
