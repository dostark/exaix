#!/usr/bin/env -S deno run -A
/**
 * @module CheckOptionalParams
 * @path scripts/check_optional_params.ts
 * @description Finds optional parameters whose optionality doesn't match actual usage:
 *   - UNUSED_OPTIONAL: param is marked ? but never passed by any caller (wiring gap / dead param)
 *   - REDUNDANT_OPTIONAL: param is marked ? but ALL callers pass it (should be required)
 *   - BARE_OPTIONAL: param optional via a bare `?` token OR a bare `| undefined` union
 *     (the two are equivalent) without the Opt<T, Reason> wrapper — optionality must be
 *     codified via Opt, never a bare `?` or a bare `| undefined`
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

export interface IFuncDecl {
  name: string;
  params: FuncParam[];
  optionalCount: number;
  requiredCount: number;
  file: string;
  line: number;
  /** Whether each optional param is referenced in the function body */
  optionalUsedInBody: boolean[];
}

const args = new Set(Deno.args);
const includeTests = args.has("--include-tests");
const verbose = args.has("--verbose");
const failOnViolations = args.has("--fail");
const autoFix = args.has("--fix");
const stagedOnly = args.has("--staged");

if (args.has("--help") || args.has("-h")) {
  console.log(`Optional Parameter Usage Checker

Usage:
  deno run -A scripts/check_optional_params.ts [options]

Options:
   --include-tests    Include test files in scan (default: false)
   --verbose          Show per-call-site breakdown
   --fail             Exit non-zero when violations found (default: advisory).
                      NOTE: BARE_OPTIONAL is advisory in full-repo mode — the
                      pre-existing bare-optional params (? or | undefined) are
                      grandfathered; only --staged enforces it (file-level ratchet).
   --staged           Scan only staged .ts files and enforce ONLY the BARE_OPTIONAL
                      rule (file-level: every bare ?/| undefined param in a staged
                      file must be Opt<T, Reason>, incl. pre-existing ones).
                      Drives cleanup — touching a file obliges converting its optionals.
   --fix              Remove ? from REDUNDANT_OPTIONAL params (makes them required)
   --help, -h         Show this help message
`);
  Deno.exit(0);
}

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

// Data structures

interface FuncParam {
  name: string;
  index: number; // 0-based position in the parameter list
  isOptional: boolean; // true if has ? token OR has default value
  hasQuestionToken: boolean; // true only if explicitly marked with ?
  qTokenPos: number; // -1 if no ? token, else position in source file
  typeEndPos: number; // position after the last char of the type annotation
  intentional: boolean; // true if param type is wrapped with Opt<T>
  bareOptional: boolean; // true if optional via bare `?` or bare `| undefined` (not Opt)
  typeText: string; // rendered type annotation (for the hint message)
}

interface CallSite {
  name: string;
  argCount: number;
  file: string;
  line: number;
}

export enum ViolationKind {
  REDUNDANT_OPTIONAL = "REDUNDANT_OPTIONAL",
  UNUSED_OPTIONAL = "UNUSED_OPTIONAL",
  MARKED_NOT_OPTIONAL = "MARKED_NOT_OPTIONAL",
  BARE_OPTIONAL = "BARE_OPTIONAL",
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
  qTokenPos: number; // position of ? token in source, -1 if unknown
  typeEndPos: number; // position after the type annotation, -1 if unknown
}

// Helpers

function isTestFilePath(filePath: string): boolean {
  return filePath.includes("/tests/") || filePath.endsWith("_test.ts");
}

function isScriptOrFixturePath(filePath: string): boolean {
  return filePath.includes("/scripts/") || filePath.includes("/tests/fixtures/");
}

/** Check if a parameter is wrapped with Opt<T> type marker. */
export function isOptType(param: ts.ParameterDeclaration): boolean {
  if (!param.type) return false;
  if (!ts.isTypeReferenceNode(param.type)) return false;
  const typeName = ts.isIdentifier(param.type.typeName) ? param.type.typeName.text : "";
  return typeName === "Opt";
}

/**
 * Check if a parameter declares optionality "bare" — i.e. WITHOUT the Opt<T, Reason>
 * wrapper — in either of the two semantically-equivalent forms:
 *   1. a `?` token:            `param?: T`
 *   2. a `| undefined` union:  `param: T | undefined` (incl. `T | null | undefined`)
 * Both mean "optional, no codified reason" and must be rewritten as `param?: Opt<T, Reason.*>`.
 * Opt-wrapped params (even `param?: Opt<T, R>` or an Opt whose inner type contains `undefined`)
 * are compliant and never flagged. A default-valued param (`param = x`) is a distinct,
 * intentional form and is out of scope here.
 */
export function hasBareOptional(param: ts.ParameterDeclaration): boolean {
  if (isOptType(param)) return false;
  if (param.questionToken) return true;
  if (param.type && ts.isUnionTypeNode(param.type)) {
    return param.type.types.some((t) => t.kind === ts.SyntaxKind.UndefinedKeyword);
  }
  return false;
}

/**
 * Build the BARE_OPTIONAL hint for a param, showing the exact Opt<T, Reason> rewrite for
 * whichever bare form it uses (`?` or `| undefined`). `typeText` is the rendered annotation
 * ("" when a `?`-param has no explicit type, e.g. `param?`).
 */
function bareOptionalMessage(p: { name: string; typeText: string; hasQuestionToken: boolean }): string {
  const inner = p.typeText.replace(/\s*\|\s*undefined\b/, "").trim();
  const q = p.hasQuestionToken ? "?" : "";
  const shown = p.typeText.length > 0 ? `\`${p.name}${q}: ${p.typeText}\`` : `\`${p.name}?\` (implicit type)`;
  const innerHint = inner.length > 0 ? inner : "T";
  return `'${p.name}' is optional without a codified reason (${shown}) — declare it with the Opt ` +
    `wrapper: \`${p.name}?: Opt<${innerHint}, Reason.*>\` (import Opt + Reason from @exaix/core/types; ` +
    `pick a Reason that fits, e.g. TraceAbsent / OptionalInput / OptionalContext). ` +
    `A bare \`?\` and a bare \`| undefined\` are equivalent and both require Opt.`;
}

/** Check if a parameter is intentionally optional via type wrapper. */
function isOpt(param: ts.ParameterDeclaration): boolean {
  return isOptType(param);
}

/** Check if a node (or its children) references a given parameter name. */
function paramNameUsedInBody(body: ts.FunctionBody, paramName: string, _sourceFile: ts.SourceFile): boolean {
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

// Collectors

export function collectFunctions(
  sourceFile: ts.SourceFile,
  funcs: Map<string, IFuncDecl[]>,
): void {
  function visit(node: ts.Node): void {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) ||
        ts.isConstructorDeclaration(node) || ts.isFunctionExpression(node))
    ) {
      // Named functions/methods keep their identifier so call-sites can match them.
      // Constructors and anonymous function-expressions have no matchable call-name; give
      // them a unique synthetic name so the caller-dependent rules (REDUNDANT/UNUSED) see
      // zero callers and skip, while the caller-independent type-shape rules
      // (BARE_OPTIONAL, MARKED_NOT_OPTIONAL) still run on their params.
      const declaredName = node.name && ts.isIdentifier(node.name) ? node.name.text : null;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const name = declaredName ?? `__anon@${sourceFile.fileName}:${line}`;

      const params: FuncParam[] = [];
      for (let i = 0; i < node.parameters.length; i++) {
        const p = node.parameters[i];
        const pName = ts.isIdentifier(p.name) ? p.name.text : null;
        if (!pName) continue;
        const hasQt = !!p.questionToken;
        params.push({
          name: pName,
          index: i,
          isOptional: hasQt || !!p.initializer,
          hasQuestionToken: hasQt,
          qTokenPos: p.questionToken ? p.questionToken.pos : -1,
          typeEndPos: p.type ? p.type.end : -1,
          intentional: isOpt(p),
          bareOptional: hasBareOptional(p),
          typeText: p.type ? p.type.getText(sourceFile) : "",
        });
      }

      const optionalCount = params.filter((p) => p.isOptional).length;
      const bareOptionalCount = params.filter((p) => p.bareOptional).length;
      // Skip only when the function has no optionality signal at all — neither a `?`/default
      // optional nor a bare-optional param the BARE_OPTIONAL rule must flag (a bare
      // `| undefined` union carries no `?`, so `optionalCount` alone would miss it).
      if (optionalCount === 0 && bareOptionalCount === 0) {
        ts.forEachChild(node, visit);
        return;
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

      const decl: IFuncDecl = {
        name,
        params,
        optionalCount,
        requiredCount: params.length - optionalCount,
        file: sourceFile.fileName,
        line,
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

// Analysis

interface MatchedFunc {
  decl: IFuncDecl;
  calls: CallSite[];
}

function matchCallsToFuncs(
  funcs: Map<string, IFuncDecl[]>,
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

/**
 * Caller-INDEPENDENT type-shape rules, run once over EVERY collected declaration (not the
 * call-matched representative). This matters because `matchCallsToFuncs` keeps only one decl
 * per function name; iterating that deduped set would silently miss same-named methods across
 * classes. These rules only inspect a param's own type shape, so they need no call sites.
 *   BARE_OPTIONAL — optional via a bare `?` or a bare `| undefined` union, not Opt<T, Reason>.
 *   MARKED_NOT_OPTIONAL — an Opt<T, Reason> wrapper on a param that is not actually optional.
 */
export function collectTypeShapeViolations(funcs: Map<string, IFuncDecl[]>): Violation[] {
  const violations: Violation[] = [];
  for (const decls of funcs.values()) {
    for (const decl of decls) {
      // A param is "non-trailing" if any later param in the same signature is required
      // (no `?`, no default). TypeScript forbids a `?` before a required param, so an
      // Opt<T, Reason> in that position CANNOT carry a `?` — it is written bare and is the
      // only valid form. Such params are exempt from MARKED_NOT_OPTIONAL below.
      const lastRequiredIndex = decl.params.reduce((acc, p, i) => (p.isOptional ? acc : i), -1);
      for (const p of decl.params) {
        if (p.bareOptional) {
          violations.push({
            kind: ViolationKind.BARE_OPTIONAL,
            message: bareOptionalMessage(p),
            funcFile: decl.file,
            funcLine: decl.line,
            optionalParam: p.name,
            callerCount: 0,
            callersPassing: 0,
            callersOmitting: 0,
            qTokenPos: p.qTokenPos,
            typeEndPos: p.typeEndPos,
          });
        }
        // MARKED_NOT_OPTIONAL: an Opt<T, Reason> marker on a param that is not actually
        // optional — a lie — UNLESS the param is non-trailing (a required param follows it),
        // where a bare Opt is the only TS-legal way to express "accepts undefined".
        const isNonTrailing = p.index < lastRequiredIndex;
        if (p.intentional && !p.isOptional && !isNonTrailing) {
          violations.push({
            kind: ViolationKind.MARKED_NOT_OPTIONAL,
            message:
              `'${p.name}' uses Opt<${p.name}, R> but is not optional — add ? or a default value to match the marker's intent`,
            funcFile: decl.file,
            funcLine: decl.line,
            optionalParam: p.name,
            callerCount: 0,
            callersPassing: 0,
            callersOmitting: 0,
            qTokenPos: p.qTokenPos,
            typeEndPos: p.typeEndPos,
          });
        }
      }
    }
  }
  return violations;
}

/** Caller-DEPENDENT rules (REDUNDANT_OPTIONAL, UNUSED_OPTIONAL) over the call-matched set. */
function analyze(matched: MatchedFunc[]): Violation[] {
  const violations: Violation[] = [];

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
      // Only flag ? params, not =default params (defaults are intentionally optional)
      // Skip params wrapped with Opt<T> — those are marked by-design
      if (callersPassing === callerCount && optParam.hasQuestionToken && !optParam.intentional) {
        violations.push({
          kind: ViolationKind.REDUNDANT_OPTIONAL,
          message: `'${optParam.name}' is optional (?) but all ${callerCount} callers pass it — should be required`,
          funcFile: decl.file,
          funcLine: decl.line,
          optionalParam: optParam.name,
          callerCount,
          callersPassing,
          callersOmitting,
          qTokenPos: optParam.qTokenPos,
          typeEndPos: optParam.typeEndPos,
        });
      }

      // UNUSED_OPTIONAL: no caller passes a value AND the param is used in body
      // (unused + not in body is dead code, lower severity)
      if (callersPassing === 0 && isUsedInBody && !optParam.intentional) {
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
          qTokenPos: optParam.qTokenPos,
          typeEndPos: optParam.typeEndPos,
        });
      }
    }
  }

  return violations;
}

// Reporter

function report(violations: Violation[]): void {
  const redundant = violations.filter((v) => v.kind === ViolationKind.REDUNDANT_OPTIONAL);
  const unused = violations.filter((v) => v.kind === ViolationKind.UNUSED_OPTIONAL);
  const markedNotOptional = violations.filter((v) => v.kind === ViolationKind.MARKED_NOT_OPTIONAL);
  const bareOptional = violations.filter((v) => v.kind === ViolationKind.BARE_OPTIONAL);

  if (bareOptional.length > 0) {
    console.error(
      "🟣 BARE_OPTIONAL — param optional via bare `?` or `| undefined` (not Opt<T, Reason>):\n",
    );
    for (const v of bareOptional) {
      const shortPath = relative(REPO_ROOT, v.funcFile);
      console.error(`  ${shortPath}:${v.funcLine}`);
      console.error(`    ${v.message}`);
    }
    console.error("");
  }

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

  if (markedNotOptional.length > 0) {
    console.error("🟠 MARKED_NOT_OPTIONAL — param uses Opt<T,R> but is not actually optional:\n");
    for (const v of markedNotOptional) {
      const shortPath = relative(REPO_ROOT, v.funcFile);
      console.error(`  ${shortPath}:${v.funcLine}`);
      console.error(`    ${v.message}`);
    }
    console.error("");
  }

  if (violations.length === 0) {
    console.log("✅ No optional-parameter usage mismatches detected");
  }
}

// Staged mode (BARE_OPTIONAL enforcement on new code)

/** Repo-root-relative paths of staged (added/copied/modified) `.ts`/`.tsx` files. */
async function stagedTsFiles(): Promise<string[]> {
  const out = await new Deno.Command("git", {
    args: ["diff", "--cached", "--name-only", "--diff-filter=ACM"],
    cwd: REPO_ROOT,
    // See scripts/check_edition_graph.ts for why LD_LIBRARY_PATH is scrubbed here.
    env: { LD_LIBRARY_PATH: "" },
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!out.success) return [];
  return new TextDecoder().decode(out.stdout)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => (l.endsWith(".ts") || l.endsWith(".tsx")))
    .filter((l) => !l.includes("/.copilot/") && !l.includes("/.exa/") && !l.includes("/types/"))
    .filter((l) => !isScriptOrFixturePath(l) && (includeTests || !isTestFilePath(l)))
    .map((l) => join(REPO_ROOT, l));
}

/**
 * Enforce ONLY the BARE_OPTIONAL rule on the staged file set — a FILE-level ratchet.
 * Whenever a `.ts` file is staged (added or modified), every bare-optional param in it must
 * adopt Opt<T, Reason> — where "bare-optional" is a `?` token OR a `| undefined` union (the two
 * are semantically equivalent), including ones that pre-date this change. This deliberately
 * drives cleanup of the grandfathered set: touching a file obliges converting its bare optionals.
 * The full-repo run reports them all as advisory (never fails), so untouched files are not
 * forced; only files you are already editing are held to the rule.
 */
async function runStaged(): Promise<void> {
  const files = await stagedTsFiles();
  const funcs = new Map<string, IFuncDecl[]>();
  for (const filePath of files) {
    const source = await Deno.readTextFile(filePath);
    const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    collectFunctions(sf, funcs);
  }
  const bareOptional = collectTypeShapeViolations(funcs)
    .filter((v) => v.kind === ViolationKind.BARE_OPTIONAL);
  if (bareOptional.length === 0) {
    console.log("✅ No bare-optional (`?` or `| undefined`) params in staged files.");
    Deno.exit(0);
  }
  report(bareOptional);
  console.error(
    `${bareOptional.length} bare-optional param(s) in staged file(s) — ` +
      `staging a file obliges converting all of its bare optionals. Wrap each in Opt<T, Reason.*> ` +
      `(import Opt + Reason from @exaix/core/types). Untouched files are exempt (advisory in the full-repo run).`,
  );
  Deno.exit(1);
}

// Main

async function main(): Promise<void> {
  if (stagedOnly) {
    await runStaged();
    return;
  }

  const funcs = new Map<string, IFuncDecl[]>();
  const calls: CallSite[] = [];

  const tsFiles: string[] = [];

  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: [".ts", ".tsx"],
      followSymlinks: false,
      skip: [/[/\\]\.git[/\\]/, /[/\\]node_modules[/\\]/, /[/\\]dist[/\\]/, /[/\\]coverage[/\\]/],
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

  // Third pass: match and analyze. Type-shape rules run over ALL decls (not the deduped
  // call-matched set); caller-dependent rules run over the matched set.
  const matched = matchCallsToFuncs(funcs, calls);
  const violations = [...collectTypeShapeViolations(funcs), ...analyze(matched)];

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

  if (autoFix) {
    const redundant = violations.filter((v) => v.kind === ViolationKind.REDUNDANT_OPTIONAL);
    if (redundant.length > 0) {
      let fixedCount = 0;
      const fileSources = new Map<string, string>();
      const sorted = [...redundant].filter((v) => v.qTokenPos >= 0).sort((a, b) => b.qTokenPos - a.qTokenPos);
      for (const v of sorted) {
        if (!fileSources.has(v.funcFile)) {
          fileSources.set(v.funcFile, await Deno.readTextFile(v.funcFile));
        }
        const src = fileSources.get(v.funcFile)!;
        fileSources.set(v.funcFile, src.slice(0, v.qTokenPos) + src.slice(v.qTokenPos + 1));
        fixedCount++;
      }
      for (const [filePath, source] of fileSources) {
        await Deno.writeTextFile(filePath, source);
      }
      console.error(`✅ Auto-fixed ${fixedCount} REDUNDANT_OPTIONAL violation(s) across ${fileSources.size} file(s)`);
    }
  }

  // BARE_OPTIONAL is advisory in the full-repo run: the pre-existing bare-optional params
  // (bare `?` or `| undefined`) are grandfathered. Only --staged enforces it (on newly-touched
  // files), so the full-repo --fail gate counts only the caller-dependent rules.
  const enforceable = violations.filter((v) => v.kind !== ViolationKind.BARE_OPTIONAL);
  const bareOptionalCount = violations.length - enforceable.length;

  if (violations.length > 0) {
    report(violations);
    if (bareOptionalCount > 0) {
      console.error(
        `${bareOptionalCount} BARE_OPTIONAL (advisory — grandfathered; enforced on staged ` +
          `files via \`check:optional-params --staged\`. Wrap new ones in Opt<T, Reason.*>).`,
      );
    }
    if (failOnViolations) {
      if (enforceable.length > 0) {
        console.error(`${enforceable.length} enforceable violation(s) found`);
        Deno.exit(1);
      }
    } else if (!autoFix) {
      console.error(`${enforceable.length} enforceable violation(s) found (advisory — use --fail to enforce)`);
    }
  } else {
    report(violations);
  }
}

if (import.meta.main) {
  main();
}
