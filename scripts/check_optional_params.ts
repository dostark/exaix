#!/usr/bin/env -S deno run -A
/**
 * @module CheckOptionalParams
 * @path scripts/check_optional_params.ts
 * @description Finds optional parameters whose optionality doesn't match actual usage:
 *   - UNUSED_OPTIONAL: param is marked ? but never passed by any caller (wiring gap / dead param)
 *   - REDUNDANT_OPTIONAL: param is marked ? but ALL callers pass it (should be required)
 *
 * Uses heuristic name-based matching (no full type resolution), so results are
 * advisory — rename-matches only within the source tree.
 *
 * Usage:
 *   deno run -A scripts/check_optional_params.ts
 *   deno run -A scripts/check_optional_params.ts --include-tests
 *   deno run -A scripts/check_optional_params.ts --verbose
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

const args = new Set(Deno.args);
const includeTests = args.has("--include-tests");
const verbose = args.has("--verbose");
const failOnViolations = args.has("--fail");

if (args.has("--help") || args.has("-h")) {
  console.log(`Optional Parameter Usage Checker

Usage:
  deno run -A scripts/check_optional_params.ts [options]

Options:
  --include-tests    Include test files in scan (default: false)
  --verbose          Show per-call-site breakdown
  --fail             Exit non-zero when violations found (default: advisory)
  --help, -h         Show this help message
`);
  Deno.exit(0);
}

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

// ── Data structures ───────────────────────────────────────────────────────────

interface FuncParam {
  name: string;
  index: number; // 0-based position in the parameter list
  isOptional: boolean;
}

interface FuncDecl {
  name: string;
  params: FuncParam[];
  optionalCount: number;
  requiredCount: number;
  file: string;
  line: number;
  /** Whether each optional param is referenced in the function body */
  optionalUsedInBody: boolean[];
}

interface CallSite {
  name: string;
  argCount: number;
  file: string;
  line: number;
}

enum ViolationKind {
  REDUNDANT_OPTIONAL = "REDUNDANT_OPTIONAL",
  UNUSED_OPTIONAL = "UNUSED_OPTIONAL",
}

interface Violation {
  kind: ViolationKind;
  message: string;
  funcFile: string;
  funcLine: number;
  optionalParam: string;
  callerCount: number;
  callersPassing: number;
  callersOmitting: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTestFilePath(filePath: string): boolean {
  return filePath.includes("/tests/") || filePath.endsWith("_test.ts");
}

function isScriptOrFixturePath(filePath: string): boolean {
  return filePath.includes("/scripts/") || filePath.includes("/tests/fixtures/");
}

/** Check if a node (or its children) references a given parameter name. */
function paramNameUsedInBody(body: ts.FunctionBody, paramName: string, sourceFile: ts.SourceFile): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === paramName) {
      // Skip the parameter declaration itself (the identifier in the param list)
      if (node.parent && ts.isParameter(node.parent) && node.parent.name === node) {
        // This is the declaration — skip
      } else {
        found = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(body, visit);
  return found;
}

// ── Collectors ────────────────────────────────────────────────────────────────

function collectFunctions(
  sourceFile: ts.SourceFile,
  funcs: Map<string, FuncDecl[]>,
): void {
  function visit(node: ts.Node): void {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node))
    ) {
      // Skip anonymous/unnamed
      const name = node.name && ts.isIdentifier(node.name) ? node.name.text : null;
      if (!name) {
        ts.forEachChild(node, visit);
        return;
      }

      const params: FuncParam[] = [];
      for (let i = 0; i < node.parameters.length; i++) {
        const p = node.parameters[i];
        const pName = ts.isIdentifier(p.name) ? p.name.text : null;
        if (!pName) continue;
        params.push({
          name: pName,
          index: i,
          isOptional: !!p.questionToken || !!p.initializer,
        });
      }

      const optionalCount = params.filter((p) => p.isOptional).length;
      if (optionalCount === 0) {
        ts.forEachChild(node, visit);
        return; // No optional params — skip
      }

      const body = node.body;
      const optionalUsedInBody: boolean[] = [];
      for (const p of params) {
        if (p.isOptional && body && ts.isBlock(body)) {
          optionalUsedInBody.push(paramNameUsedInBody(body, p.name, sourceFile));
        } else {
          optionalUsedInBody.push(false);
        }
      }

      const decl: FuncDecl = {
        name,
        params,
        optionalCount,
        requiredCount: params.length - optionalCount,
        file: sourceFile.fileName,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        optionalUsedInBody,
      };

      if (!funcs.has(name)) funcs.set(name, []);
      funcs.get(name)!.push(decl);
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
}

function collectCallSites(
  sourceFile: ts.SourceFile,
  calls: CallSite[],
): void {
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      let name: string | null = null;

      if (ts.isIdentifier(expr)) {
        name = expr.text;
      } else if (
        ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)
      ) {
        name = expr.name.text;
      }

      if (name) {
        calls.push({
          name,
          argCount: node.arguments.length,
          file: sourceFile.fileName,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
}

// ── Analysis ──────────────────────────────────────────────────────────────────

interface MatchedFunc {
  decl: FuncDecl;
  calls: CallSite[];
}

function matchCallsToFuncs(
  funcs: Map<string, FuncDecl[]>,
  calls: CallSite[],
): MatchedFunc[] {
  const matched: MatchedFunc[] = [];

  for (const [name, decls] of funcs) {
    // Find all calls with matching name
    const matchingCalls = calls.filter((c) => c.name === name);

    // A function might be overloaded — use the declaration with the most params
    // as the "full" signature for comparison
    const fullDecl = decls.reduce((a, b) => a.params.length >= b.params.length ? a : b);

    matched.push({ decl: fullDecl, calls: matchingCalls });
  }

  return matched;
}

function analyze(matched: MatchedFunc[]): Violation[] {
  const violations: Violation[] = [];

  // Build a set of all public API exported names to reduce noise
  const publicApiNames = new Set<string>();

  for (const { decl, calls } of matched) {
    if (decl.optionalCount === 0) continue;

    // Count how many callers pass each optional param position
    const optionalPositions = decl.params
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.isOptional);

    for (const { p: optParam, i: optIndex } of optionalPositions) {
      // A caller "passes" the optional param if argCount > optIndex
      const callersPassing = calls.filter((c) => c.argCount > optIndex).length;
      const callersOmitting = calls.filter((c) => c.argCount <= optIndex).length;
      const callerCount = calls.length;

      // Skip if no calls found (can't determine)
      if (callerCount === 0) continue;

      // Check if param is used in body
      const isUsedInBody = decl.optionalUsedInBody[optIndex];

      // REDUNDANT_OPTIONAL: all callers pass a value for this param
      if (callersPassing === callerCount) {
        violations.push({
          kind: ViolationKind.REDUNDANT_OPTIONAL,
          message: `'${optParam.name}' is optional (?) but all ${callerCount} callers pass it — should be required`,
          funcFile: decl.file,
          funcLine: decl.line,
          optionalParam: optParam.name,
          callerCount,
          callersPassing,
          callersOmitting,
        });
      }

      // UNUSED_OPTIONAL: no caller passes a value AND the param is used in body
      // (unused + not in body is dead code, lower severity)
      if (callersPassing === 0 && isUsedInBody) {
        violations.push({
          kind: ViolationKind.UNUSED_OPTIONAL,
          message:
            `'${optParam.name}' is optional (?) with ${callerCount} calls, none pass it — but IS used in body; possible wiring gap`,
          funcFile: decl.file,
          funcLine: decl.line,
          optionalParam: optParam.name,
          callerCount,
          callersPassing,
          callersOmitting,
        });
      }
    }
  }

  return violations;
}

// ── Reporter ──────────────────────────────────────────────────────────────────

function report(violations: Violation[]): void {
  const redundant = violations.filter((v) => v.kind === ViolationKind.REDUNDANT_OPTIONAL);
  const unused = violations.filter((v) => v.kind === ViolationKind.UNUSED_OPTIONAL);

  if (redundant.length > 0) {
    console.error("🟡 REDUNDANT_OPTIONAL — param marked optional but ALL callers pass it:\n");
    for (const v of redundant) {
      const shortPath = relative(REPO_ROOT, v.funcFile);
      console.error(`  ${shortPath}:${v.funcLine}`);
      console.error(`    ${v.message}`);
      console.error(`    callers: ${v.callerCount} total, ${v.callersPassing} pass, ${v.callersOmitting} omit`);
    }
    console.error("");
  }

  if (unused.length > 0) {
    console.error("🔴 UNUSED_OPTIONAL — param optional AND used in body but NO caller passes it:\n");
    for (const v of unused) {
      const shortPath = relative(REPO_ROOT, v.funcFile);
      console.error(`  ${shortPath}:${v.funcLine}`);
      console.error(`    ${v.message}`);
      console.error(`    callers: ${v.callerCount} total, ${v.callersPassing} pass, ${v.callersOmitting} omit`);
    }
    console.error("");
  }

  if (violations.length === 0) {
    console.log("✅ No optional-parameter usage mismatches detected");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const funcs = new Map<string, FuncDecl[]>();
  const calls: CallSite[] = [];

  const tsFiles: string[] = [];

  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      followSymlinks: false,
      skip: [/^\.git$/, /^node_modules$/, /^dist$/, /^coverage$/],
    })
  ) {
    if (entry.path.includes("/.copilot/")) continue;
    if (entry.path.includes("/.exa/")) continue;
    if (entry.path.includes("/types/")) continue; // .d.ts type declarations
    if (isScriptOrFixturePath(entry.path)) continue;
    if (!includeTests && isTestFilePath(entry.path)) continue;
    tsFiles.push(entry.path);
  }

  // First pass: collect function declarations with optional params
  for (const filePath of tsFiles) {
    const source = await Deno.readTextFile(filePath);
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    collectFunctions(sourceFile, funcs);
  }

  // Second pass: collect all call sites
  for (const filePath of tsFiles) {
    const source = await Deno.readTextFile(filePath);
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    collectCallSites(sourceFile, calls);
  }

  // Third pass: match and analyze
  const matched = matchCallsToFuncs(funcs, calls);
  const violations = analyze(matched);

  if (verbose && violations.length > 0) {
    // Detailed per-function breakdown
    for (const { decl, calls: matchedCalls } of matched) {
      if (decl.optionalCount === 0) continue;
      // Skip functions with no violations
      const hasViolation = violations.some((v) => v.funcFile === decl.file && v.funcLine === decl.line);
      if (!hasViolation) continue;

      const shortPath = relative(REPO_ROOT, decl.file);
      console.error(
        `\n📋 ${shortPath}:${decl.line} — ${decl.name}(${
          decl.params.map((p) => p.name + (p.isOptional ? "?" : "")).join(", ")
        })`,
      );
      console.error(`   optional params: ${decl.optionalCount}, calls found: ${matchedCalls.length}`);

      if (matchedCalls.length > 0) {
        console.error(`   call sites:`);
        for (const c of matchedCalls) {
          const callFile = relative(REPO_ROOT, c.file);
          console.error(`     ${callFile}:${c.line} — ${c.name}(${c.argCount} args)`);
        }
      }
    }
    console.error("");
  }

  if (violations.length > 0) {
    report(violations);
    if (failOnViolations) {
      console.error(`${violations.length} violation(s) found`);
      Deno.exit(1);
    }
    console.error(`${violations.length} violation(s) found (advisory — use --fail to enforce)`);
  } else {
    report(violations);
  }
}

if (import.meta.main) {
  main();
}
