#!/usr/bin/env -S deno run -A
/**
 * @module FixBoolAsserts
 * @path scripts/fix_bool_asserts.ts
 * @description One-off typed codemod that rewrites boolean-wrapped substring assertions.
 * @related-files [unslop-ts/src/rules/test_assertion_rules.ts, tests/scripts/fix_bool_asserts_test.ts]
 *
 * Usage:
 *   deno run -A scripts/fix_bool_asserts.ts [roots...] [--check]
 *
 * The codemod is idempotent. A second run changes nothing.
 */

import ts from "typescript";
import { walk } from "@std/fs";

/** A site the codemod could not rewrite. */
interface ISkippedSite {
  readonly line: number;
  readonly reason: string;
}

/** The outcome of a codemod run over one source text. */
interface IFixResult {
  readonly text: string;
  readonly changed: number;
  readonly skipped: readonly ISkippedSite[];
}

interface IReplacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const STRING_INCLUDES = "assertStringIncludes";
const ARRAY_INCLUDES = "assertArrayIncludes";
const MATCH = "assertMatch";
const ASSERT_FALSE = "assertFalse";
const ASSERT_FUNCTIONS = new Set(["assertEquals", "assertStrictEquals"]);
const SUBSTRING_METHODS = new Set(["includes", "startsWith", "endsWith"]);
const DEFAULT_ROOTS = ["packages", "apps", "tests", "scripts"];
const SKIP_DIRECTORIES = [".git", "node_modules", "dist", "coverage"];

/** The called name for an identifier or a property access, or null. */
function calleeNameOf(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

/** The receiver and the single argument of a `receiver.method(argument)` subject call. */
function subjectPartsOf(
  subjectCall: ts.CallExpression,
): { receiver: ts.Expression; argument: ts.Expression } | null {
  if (!ts.isPropertyAccessExpression(subjectCall.expression)) return null;
  if (subjectCall.arguments.length !== 1) return null;
  const argument = subjectCall.arguments[0];
  if (!ts.isExpression(argument)) return null;
  return { receiver: subjectCall.expression.expression, argument };
}

/** The substring method name of a subject call, or null. */
function subjectMethodOf(subjectCall: ts.CallExpression): string | null {
  const expression = subjectCall.expression;
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const name = expression.name.text;
  return SUBSTRING_METHODS.has(name) ? name : null;
}

function isStringLike(checker: ts.TypeChecker, node: ts.Expression): boolean {
  return (checker.getTypeAtLocation(node).flags & ts.TypeFlags.StringLike) !== 0;
}

function textArgumentOf(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Escapes the characters that carry meaning in a regular-expression literal. */
function escapeForRegExp(text: string): string {
  // Escape `/` and line terminators too, or the emitted regular-expression literal breaks.
  return text
    .replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function messageSuffixOf(call: ts.CallExpression): string {
  if (call.arguments.length < 3) return "";
  const message = call.arguments[2];
  return ts.isExpression(message) ? `, ${message.getText()}` : "";
}

/** The replacement call text, or a skip reason. */
function rewriteCall(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  subjectCall: ts.CallExpression,
  method: string,
  negated: boolean,
): { text: string } | { skip: string } {
  if (negated) {
    // A negated assertion needs no type knowledge, so the subject may stay untyped.
    return { text: `${ASSERT_FALSE}(${subjectCall.getText()}${messageSuffixOf(call)})` };
  }
  const parts = subjectPartsOf(subjectCall);
  if (parts === null) return { skip: "the subject call is not a one-argument method call" };
  const receiver = parts.receiver.getText();
  const argument = parts.argument.getText();
  const message = messageSuffixOf(call);
  const arrayLike = checker.isArrayType(checker.getTypeAtLocation(parts.receiver));
  if (method === "includes") {
    if (isStringLike(checker, parts.receiver)) {
      return { text: `${STRING_INCLUDES}(${receiver}, ${argument}${message})` };
    }
    if (arrayLike) return { text: `${ARRAY_INCLUDES}(${receiver}, [${argument}]${message})` };
    return { skip: `the subject type is ${checker.typeToString(checker.getTypeAtLocation(parts.receiver))}` };
  }
  if (!isStringLike(checker, parts.receiver)) {
    return { skip: `the subject type is ${checker.typeToString(checker.getTypeAtLocation(parts.receiver))}` };
  }
  const literal = textArgumentOf(parts.argument);
  if (literal === null) return { skip: "the match argument is not a string literal" };
  const escaped = escapeForRegExp(literal);
  const pattern = method === "startsWith" ? `^${escaped}` : `${escaped}$`;
  return { text: `${MATCH}(${receiver}, /${pattern}/${message})` };
}

/** Collects the replacements and skipped sites for one source file. */
function collectFixes(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): { replacements: IReplacement[]; skipped: ISkippedSite[] } {
  const replacements: IReplacement[] = [];
  const skipped: ISkippedSite[] = [];
  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      const name = calleeNameOf(node.expression);
      const subject = node.arguments[0];
      if (name !== null && ASSERT_FUNCTIONS.has(name) && ts.isCallExpression(subject)) {
        const second = node.arguments[1].kind;
        if (second === ts.SyntaxKind.TrueKeyword || second === ts.SyntaxKind.FalseKeyword) {
          const method = subjectMethodOf(subject);
          if (method !== null) {
            const outcome = rewriteCall(checker, node, subject, method, second === ts.SyntaxKind.FalseKeyword);
            if ("text" in outcome) {
              replacements.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: outcome.text });
            } else {
              skipped.push({ line: lineOf(node), reason: outcome.skip });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { replacements, skipped };
}

/** Applies the replacements from the end of the text, dropping any overlap. */
function applyReplacements(
  text: string,
  replacements: readonly IReplacement[],
): { text: string; applied: number } {
  const ordered = [...replacements].sort((a, b) => b.start - a.start);
  let result = text;
  let applied = 0;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const replacement of ordered) {
    if (replacement.end > lastStart) continue;
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
    lastStart = replacement.start;
    applied++;
  }
  return { text: result, applied };
}

/** Rewrites one parsed source file. */
function fixSourceFile(sourceFile: ts.SourceFile, checker: ts.TypeChecker, text: string): IFixResult {
  const { replacements, skipped } = collectFixes(sourceFile, checker);
  const applied = applyReplacements(text, replacements);
  return { text: applied.text, changed: applied.applied, skipped };
}

function compilerOptions(): ts.CompilerOptions {
  return {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  };
}

/** Builds a program from in-memory files, reading the standard library from disk. */
function createInMemoryProgram(files: Map<string, string>): ts.Program {
  const options = compilerOptions();
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const inMemory = files.get(fileName);
    if (inMemory !== undefined) return ts.createSourceFile(fileName, inMemory, languageVersion, true);
    return readSource(fileName, languageVersion, onError, shouldCreate);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => files.has(fileName) || fileExists(fileName);
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => files.get(fileName) ?? readFile(fileName);
  return ts.createProgram([...files.keys()], options, host);
}

/** Rewrites one source text through a single-file in-memory program. */
export function fixSourceText(fileName: string, text: string): IFixResult {
  const program = createInMemoryProgram(new Map([[fileName, text]]));
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) return { text, changed: 0, skipped: [] };
  return fixSourceFile(sourceFile, program.getTypeChecker(), text);
}

/** Collects the `.ts` and `.tsx` files under the given roots. */
async function collectTypeScriptFiles(roots: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const root of roots) {
    try {
      for await (
        const entry of walk(root, {
          exts: [".ts", ".tsx"],
          includeDirs: false,
          skip: SKIP_DIRECTORIES.map((name) => new RegExp(`[/\\\\]${name}[/\\\\]`)),
        })
      ) {
        if (!entry.path.endsWith(".d.ts")) files.push(entry.path);
      }
    } catch {
      // A root that does not exist contributes no files.
    }
  }
  return files.sort();
}

async function main(): Promise<void> {
  const checkOnly = Deno.args.includes("--check");
  const roots = Deno.args.filter((arg) => !arg.startsWith("--"));
  const targetRoots = roots.length > 0 ? roots : DEFAULT_ROOTS;
  const paths = await collectTypeScriptFiles(targetRoots);
  const contents = new Map<string, string>();
  for (const path of paths) contents.set(path, await Deno.readTextFile(path));

  const program = createInMemoryProgram(contents);
  const checker = program.getTypeChecker();
  let changedFiles = 0;
  let skippedTotal = 0;
  for (const path of paths) {
    const sourceFile = program.getSourceFile(path);
    const text = contents.get(path);
    if (!sourceFile || text === undefined) continue;
    const result = fixSourceFile(sourceFile, checker, text);
    skippedTotal += result.skipped.length;
    if (result.changed === 0) continue;
    changedFiles++;
    if (!checkOnly) await Deno.writeTextFile(path, result.text);
    console.error(`${checkOnly ? "would fix" : "fixed"} ${path} (${result.changed})`);
  }
  console.error(`fix_bool_asserts: ${changedFiles} file(s), ${skippedTotal} skipped site(s)`);
  if (checkOnly && changedFiles > 0) Deno.exit(1);
}

if (import.meta.main) await main();
