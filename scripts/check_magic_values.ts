#!/usr/bin/env -S deno run --allow-read
// Copyright 2026 Exaix authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Magic Value Detector — scans TypeScript sources using the compiler API
 * AST to find repeated string/number literals that should be extracted
 * into named constants or enums.
 *
 * Thresholds (per-module / global):
 *   strings:  occurrences > 2  (local)  / > 3  (global)
 *   numbers:  occurrences > 3  (local)  / > 4  (global)
 *
 * Whitelisted values (never flagged):
 *   "", " ", "0", "1", "-1", "true", "false", "null", "undefined",
 *   numeric 0, 1, -1, 100, 1000
 */

import * as ts from "https://esm.sh/typescript@5.3.3";
import { walk } from "https://deno.land/std@0.200.0/fs/mod.ts";
import { dirname, fromFileUrl, join } from "https://deno.land/std@0.221.0/path/mod.ts";

// ── Configuration ────────────────────────────────────────────────────────────

const LOCAL_STRING_THRESHOLD = 2;
const GLOBAL_STRING_THRESHOLD = 3;
const LOCAL_NUMBER_THRESHOLD = 3;
const GLOBAL_NUMBER_THRESHOLD = 4;

const STRING_WHITELIST = new Set(["", " ", "\n", "\t", "\\n", "\\t", "true", "false", "null", "undefined"]);
const NUMBER_WHITELIST = new Set([0, 1, -1, 100, 1000]);

// Short strings that are likely intentional identifiers, not magic values
const SHORT_STRING_MIN_LENGTH = 3;

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

// ── Data structures ──────────────────────────────────────────────────────────

interface Occurrence {
  file: string;
  line: number;
}

type LiteralKind = "string" | "number";
type ViolationScope = "local" | "global";

interface ValueCounter {
  value: string;
  kind: LiteralKind;
  occurrences: Occurrence[];
  /** Per-file counts for local-scope detection */
  perFile: Map<string, number>;
}

interface Violation {
  file: string;
  line: number;
  value: string;
  kind: LiteralKind;
  occurrences: number;
  scope: ViolationScope;
}

// ── AST Visitor ──────────────────────────────────────────────────────────────

/**
 * Should this literal be skipped (whitelisted or irrelevant context)?
 */
function shouldSkip(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const parent = node.parent;
  if (!parent) return true;

  // Skip property names in object literals: { foo: "bar" } — "foo" is a name
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return true;

  // Skip enum member names
  if (ts.isEnumMember(parent) && parent.name === node) return true;

  // Skip import paths and module specifiers
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isModuleDeclaration(parent)) return true;

  // Skip decorator arguments (framework metadata)
  if (ts.isDecorator(parent)) return true;

  // Skip JSX attribute values
  if (ts.isJsxAttribute(parent) && parent.initializer === node) return true;

  // Skip template expression parts
  if (ts.isTemplateLiteralToken(node)) return true;

  // Skip type literal strings (e.g., literal type members in a union)
  if (ts.isLiteralTypeNode(parent)) return true;

  // Skip keys of type index signatures
  if (ts.isIndexedAccessTypeNode(parent)) return true;

  return false;
}

function collectLiterals(
  sourceFile: ts.SourceFile,
  globalCounters: Map<string, ValueCounter>,
  localCounters: Map<string, ValueCounter>,
): void {
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
      if (shouldSkip(node, sourceFile)) {
        ts.forEachChild(node, visit);
        return;
      }

      const rawText = node.getText(sourceFile);
      const kind = ts.isStringLiteral(node) ? "string" : "number";
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

      // Whitelist checks
      if (kind === "string") {
        const val = node.text;
        if (STRING_WHITELIST.has(val)) {
          ts.forEachChild(node, visit);
          return;
        }
        if (val.length < SHORT_STRING_MIN_LENGTH && !val.match(/^[a-z]/)) {
          ts.forEachChild(node, visit);
          return;
        }
      } else {
        const num = parseFloat(rawText);
        if (NUMBER_WHITELIST.has(num) || isNaN(num)) {
          ts.forEachChild(node, visit);
          return;
        }
      }

      const key = `${kind}:${rawText}`;

      // Global counting
      let global = globalCounters.get(key);
      if (!global) {
        global = { value: rawText, kind, occurrences: [], perFile: new Map() };
        globalCounters.set(key, global);
      }
      global.occurrences.push({ file: sourceFile.fileName, line });
      global.perFile.set(
        sourceFile.fileName,
        (global.perFile.get(sourceFile.fileName) || 0) + 1,
      );

      // Local (per-file) counting
      let local = localCounters.get(`${key}:${sourceFile.fileName}`);
      if (!local) {
        local = { value: rawText, kind, occurrences: [], perFile: new Map() };
        localCounters.set(`${key}:${sourceFile.fileName}`, local);
      }
      local.occurrences.push({ file: sourceFile.fileName, line });
      local.perFile.set(
        sourceFile.fileName,
        (local.perFile.get(sourceFile.fileName) || 0) + 1,
      );
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
}

// ── Reporting ────────────────────────────────────────────────────────────────

function detectViolations(
  globalCounters: Map<string, ValueCounter>,
  localCounters: Map<string, ValueCounter>,
): Violation[] {
  const violations: Violation[] = [];
  const reportedGlobal = new Set<string>();

  // Check local violations
  for (const [key, data] of localCounters) {
    const threshold = data.kind === "string" ? LOCAL_STRING_THRESHOLD : LOCAL_NUMBER_THRESHOLD;
    const count = data.perFile.values().next().value || 0;
    if (count > threshold) {
      const first = data.occurrences[0];
      violations.push({
        file: first.file,
        line: first.line,
        value: data.value,
        kind: data.kind,
        occurrences: count,
        scope: "local",
      });
    }
  }

  // Check global violations
  for (const [key, data] of globalCounters) {
    const threshold = data.kind === "string" ? GLOBAL_STRING_THRESHOLD : GLOBAL_NUMBER_THRESHOLD;
    if (data.occurrences.length > threshold && !reportedGlobal.has(key)) {
      reportedGlobal.add(key);
      const first = data.occurrences[0];
      violations.push({
        file: "GLOBAL",
        line: 0,
        value: data.value,
        kind: data.kind,
        occurrences: data.occurrences.length,
        scope: "global",
      });
    }
  }

  return violations;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const globalCounters = new Map<string, ValueCounter>();
  const localCounters = new Map<string, ValueCounter>();

  const tsFiles: string[] = [];

  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      followSymlinks: false,
      skip: [/^\.git$/, /^node_modules$/, /^dist$/, /^coverage$/, /check_magic_values\.ts$/],
    })
  ) {
    if (entry.path.includes("/.copilot/")) continue;
    if (entry.path.includes("/scripts/")) continue;
    if (entry.path.includes("/tests/fixtures/")) continue;
    tsFiles.push(entry.path);
  }

  for (const filePath of tsFiles) {
    const source = await Deno.readTextFile(filePath);
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    collectLiterals(sourceFile, globalCounters, localCounters);
  }

  const violations = detectViolations(globalCounters, localCounters);

  if (violations.length > 0) {
    console.error("❌ Magic value violations detected:\n");
    for (const v of violations) {
      const scopeTag = v.scope === "global" ? "GLOBAL" : "MODULE";
      console.error(
        `[${scopeTag}] ${v.value} (${v.kind}) appears ${v.occurrences}x — extract to named constant/enum`,
      );
      if (v.scope === "local") {
        console.error(`    at ${v.file}:${v.line}`);
      } else {
        const files = new Set(
          globalCounters.get(`${v.kind}:${v.value}`)?.occurrences.map((o) => o.file) || [],
        );
        console.error(`    across ${files.size} files (first: ${v.file})`);
      }
    }
    console.error(`\n${violations.length} violation(s) found`);
    Deno.exit(1);
  }

  console.log("✅ No magic value violations detected");
}

if (import.meta.main) {
  main();
}
