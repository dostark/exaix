#!/usr/bin/env -S deno run -A
/**
 * @module FixBoolAsserts
 * @path scripts/fix_bool_asserts.ts
 * @description Conservative typed codemod that rewrites boolean-wrapped substring assertions in test files.
 *   It rewrites only calls bound to the standard assertion module, keeps array predicates in a named result,
 *   maintains the assertion imports and lists every site it leaves unchanged.
 * @architectural-layer Tooling
 * @dependencies [typescript, zod, @std/fs, @std/path, @exaix/lint-policy]
 * @related-files [unslop-ts/src/rules/test_assertion_rules.ts, tests/scripts/fix_bool_asserts_test.ts]
 *
 * Usage:
 *   deno run -A scripts/fix_bool_asserts.ts [roots...] [--check]
 *   deno run -A scripts/fix_bool_asserts.ts --files-manifest=<json-path> [--check]
 *
 * A manifest is a JSON array of repository-relative test file paths. Manifest mode writes only those files.
 * Root mode walks the roots and rewrites only the files that the lint policy classes as test files.
 * The codemod is idempotent. A second run changes nothing.
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { isAbsolute, join, normalize, relative, SEPARATOR } from "@std/path";
import { classifyRepoPath } from "@exaix/lint-policy";
import { z } from "zod";

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

/** How a source file binds the names of the standard assertion module. */
interface IAssertBindings {
  /** Local name to the canonical exported name, for every named import. */
  readonly named: ReadonlyMap<string, string>;
  /** Local names of namespace imports. */
  readonly namespaces: ReadonlySet<string>;
  /** The first runtime declaration that carries named imports, or null. */
  readonly declaration: ts.ImportDeclaration | null;
}

/** A resolved assertion callee: its canonical name and the namespace it was reached through, if any. */
interface IBoundCallee {
  readonly canonical: string;
  readonly namespace: string | null;
}

/** One boolean-wrapped assertion that the lint rule reports. */
interface IBooleanAssertion {
  readonly call: ts.CallExpression;
  readonly callee: IBoundCallee;
  readonly subject: ts.CallExpression;
  readonly method: string;
  readonly negated: boolean;
  readonly message: ts.Expression | null;
}

const STRING_INCLUDES = "assertStringIncludes";
const MATCH = "assertMatch";
const ASSERT_FALSE = "assertFalse";
const BARE_ASSERT = "assert";
const EQUALITY_FUNCTIONS = new Set(["assertEquals", "assertStrictEquals"]);
const SUBSTRING_METHODS = new Set(["includes", "startsWith", "endsWith"]);
const ASSERT_MODULE = /^(jsr:)?@std\/assert(@[^/]+)?$/;
const DEFAULT_ROOTS = ["packages", "apps", "tests", "scripts", "exaix-team"];
const CONSUMER_ROOTS = new Set([...DEFAULT_ROOTS, "exaix-enterprise"]);
const SKIP_DIRECTORIES = [".git", "node_modules", "dist", "coverage"];
const MANIFEST_FLAG = "--files-manifest=";
const NAMED_RESULT_BASE = "includesResult";
const USAGE_EXIT_CODE = 2;
const TEST_CLASS = "test";
const ManifestEntry = z.string().min(1);

/** The called name for an identifier or a property access, or null. */
function calleeNameOf(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

/** Reads the top-level imports of the standard assertion module. */
function readBindings(sourceFile: ts.SourceFile): IAssertBindings {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  let declaration: ts.ImportDeclaration | null = null;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!ASSERT_MODULE.test(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    declaration ??= statement;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      named.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
  }
  return { named, namespaces, declaration };
}

/** Binds a callee to the standard assertion module, or returns null when it is not provably bound. */
function bindCallee(bindings: IAssertBindings, callee: ts.Expression): IBoundCallee | null {
  if (ts.isIdentifier(callee)) {
    const canonical = bindings.named.get(callee.text);
    return canonical === undefined ? null : { canonical, namespace: null };
  }
  if (
    ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
    bindings.namespaces.has(callee.expression.text)
  ) {
    return { canonical: callee.name.text, namespace: callee.expression.text };
  }
  return null;
}

function isStringLike(checker: ts.TypeChecker, node: ts.Expression): boolean {
  return (checker.getTypeAtLocation(node).flags & ts.TypeFlags.StringLike) !== 0;
}

function typeTextOf(checker: ts.TypeChecker, node: ts.Expression): string {
  return checker.typeToString(checker.getTypeAtLocation(node));
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

/** The shape of a `receiver.method(...)` substring subject, or null. */
function substringSubjectOf(node: ts.Expression): { call: ts.CallExpression; method: string } | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const method = node.expression.name.text;
  return SUBSTRING_METHODS.has(method) ? { call: node, method } : null;
}

/** Everything a rewrite needs to emit text and to record the imports that the new text requires. */
interface IEmitContext {
  readonly bindings: IAssertBindings;
  readonly required: Set<string>;
  readonly usedIdentifiers: Set<string>;
}

/** The text that calls a canonical assertion the way the original call reached its module. */
function emitCallee(context: IEmitContext, canonical: string, namespace: string | null): string {
  if (namespace !== null) return `${namespace}.${canonical}`;
  for (const [local, imported] of context.bindings.named) {
    if (imported === canonical) return local;
  }
  context.required.add(canonical);
  return canonical;
}

/** The first free name for a result, so that it cannot shadow or collide with any identifier in the file. */
function freshResultName(used: Set<string>): string {
  let name = NAMED_RESULT_BASE;
  for (let suffix = 2; used.has(name); suffix++) name = `${NAMED_RESULT_BASE}${suffix}`;
  used.add(name);
  return name;
}

function messageSuffixOf(message: ts.Expression | null): string {
  return message === null ? "" : `, ${message.getText()}`;
}

/** Parses an assertion call into the boolean-wrapped shape that the rule reports, or null. */
function booleanAssertionOf(
  bindings: IAssertBindings,
  call: ts.CallExpression,
): { assertion: IBooleanAssertion } | { unbound: string } | null {
  const name = calleeNameOf(call.expression);
  const first = call.arguments.length > 0 ? substringSubjectOf(call.arguments[0]) : null;
  if (name === null || first === null) return null;
  const bound = bindCallee(bindings, call.expression);
  const canonical = bound?.canonical ?? name;
  const wrapper = EQUALITY_FUNCTIONS.has(canonical);
  const secondKind = call.arguments[1]?.kind;
  const isBoolean = secondKind === ts.SyntaxKind.TrueKeyword || secondKind === ts.SyntaxKind.FalseKeyword;
  if (!(canonical === BARE_ASSERT || (wrapper && isBoolean))) return null;
  if (bound === null) {
    return { unbound: `the ${call.expression.getText()} binding is not imported from @std/assert` };
  }
  const message = call.arguments[wrapper ? 2 : 1];
  return {
    assertion: {
      call,
      callee: bound,
      subject: first.call,
      method: first.method,
      negated: wrapper && secondKind === ts.SyntaxKind.FalseKeyword,
      message: message !== undefined && ts.isExpression(message) ? message : null,
    },
  };
}

/** True when a statement sits in a list, so that one statement can become two. */
function isStatementListItem(statement: ts.Node): boolean {
  const parent = statement.parent;
  return ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent) || ts.isCaseClause(parent) ||
    ts.isDefaultClause(parent);
}

/** The replacement of a string-typed `true` assertion, or a skip reason. */
function stringRewrite(
  context: IEmitContext,
  assertion: IBooleanAssertion,
  receiver: ts.Expression,
): { text: string } | { skip: string } {
  const args = assertion.subject.arguments;
  const message = messageSuffixOf(assertion.message);
  const namespace = assertion.callee.namespace;
  if (args.length !== 1) return { skip: `the ${assertion.method} call passes a position argument` };
  if (assertion.method === "includes") {
    const callee = emitCallee(context, STRING_INCLUDES, namespace);
    return { text: `${callee}(${receiver.getText()}, ${args[0].getText()}${message})` };
  }
  const literal = textArgumentOf(args[0]);
  if (literal === null) return { skip: "the match argument is not a string literal" };
  const escaped = escapeForRegExp(literal);
  const pattern = assertion.method === "startsWith" ? `^${escaped}` : `${escaped}$`;
  return { text: `${emitCallee(context, MATCH, namespace)}(${receiver.getText()}, /${pattern}/${message})` };
}

/** The replacement of an array `includes` assertion: the predicate stays in a named boolean. */
function arrayRewrite(
  context: IEmitContext,
  assertion: IBooleanAssertion,
  sourceText: string,
): { text: string; start: number; end: number } | { skip: string } {
  const statement = assertion.call.parent;
  if (!ts.isExpressionStatement(statement) || !isStatementListItem(statement)) {
    return { skip: "the assertion is not a statement in a list, so a named result cannot be inserted" };
  }
  const start = statement.getStart();
  const lineStart = sourceText.lastIndexOf("\n", start - 1) + 1;
  const indent = sourceText.slice(lineStart, start);
  if (indent.trim() !== "") return { skip: "the assertion shares its line with other code" };
  const name = freshResultName(context.usedIdentifiers);
  const callee = assertion.call.expression.getText();
  const wrapper = EQUALITY_FUNCTIONS.has(assertion.callee.canonical);
  const direction = assertion.negated ? "false" : "true";
  const rewritten = wrapper
    ? `${callee}(${name}, ${direction}${messageSuffixOf(assertion.message)});`
    : `${callee}(${name}${messageSuffixOf(assertion.message)});`;
  const declaration = `const ${name}: boolean = ${assertion.subject.getText()};`;
  return { text: `${declaration}\n${indent}${rewritten}`, start, end: statement.getEnd() };
}

/** Plans the edit for one boolean-wrapped assertion. */
function planEdit(
  checker: ts.TypeChecker,
  context: IEmitContext,
  assertion: IBooleanAssertion,
  sourceText: string,
): IReplacement | { skip: string } {
  const expression = assertion.subject.expression;
  if (!ts.isPropertyAccessExpression(expression)) return { skip: "the subject call is not a method call" };
  const receiver = expression.expression;
  const start = assertion.call.getStart();
  const end = assertion.call.getEnd();
  if (assertion.negated) {
    // A negated assertion keeps its predicate whole, so no type knowledge is needed.
    const callee = emitCallee(context, ASSERT_FALSE, assertion.callee.namespace);
    const message = messageSuffixOf(assertion.message);
    return { start, end, text: `${callee}(${assertion.subject.getText()}${message})` };
  }
  if (assertion.method === "includes" && checker.isArrayType(checker.getTypeAtLocation(receiver))) {
    return arrayRewrite(context, assertion, sourceText);
  }
  if (!isStringLike(checker, receiver)) return { skip: `the subject type is ${typeTextOf(checker, receiver)}` };
  const outcome = stringRewrite(context, assertion, receiver);
  return "skip" in outcome ? outcome : { start, end, text: outcome.text };
}

/** The identifiers that a file declares or uses, so that a new name cannot collide with any of them. */
function identifiersOf(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** How often each name is referenced outside the import declarations and property-name positions. */
function referenceCounts(sourceFile: ts.SourceFile, names: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, 0);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    const isPropertyName = ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) &&
      node.parent.name === node;
    if (ts.isIdentifier(node) && !isPropertyName && counts.has(node.text)) {
      counts.set(node.text, (counts.get(node.text) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return counts;
}

/** Applies the replacements from the end of the text, dropping any overlap. */
function applyReplacements(text: string, replacements: readonly IReplacement[]): { text: string; applied: number } {
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

/** Renders one import specifier of the standard assertion module. */
function specifierText(local: string, imported: string): string {
  return local === imported ? local : `${imported} as ${local}`;
}

/** Rebuilds the named-import declaration: adds the required names and drops names that became unused. */
function rewriteImports(
  rewritten: string,
  fileName: string,
  original: IAssertBindings,
  options: { required: ReadonlySet<string>; usedBefore: ReadonlySet<string> },
): string {
  const declaration = original.declaration;
  if (declaration === null) return rewritten;
  const after = ts.createSourceFile(fileName, rewritten, ts.ScriptTarget.ES2022, true);
  const counts = referenceCounts(after, original.named.keys());
  const kept: string[] = [];
  const present = new Set<string>();
  for (const [local, imported] of original.named) {
    present.add(imported);
    // Only a name that this run emptied of references is dropped. A name that was already unused stays.
    if ((counts.get(local) ?? 0) > 0 || !options.usedBefore.has(local)) kept.push(specifierText(local, imported));
  }
  const added = [...options.required].filter((name) => !present.has(name)).sort();
  const specifiers = [...kept, ...added];
  const declarationAfter = after.statements.find((statement): statement is ts.ImportDeclaration =>
    ts.isImportDeclaration(statement) && statement.getText() === declaration.getText()
  );
  if (declarationAfter === undefined) return rewritten;
  const start = declarationAfter.getStart();
  const end = declarationAfter.getEnd();
  if (specifiers.length === 0) {
    return rewritten.slice(0, start) + rewritten.slice(rewritten[end] === "\n" ? end + 1 : end);
  }
  const text = `import { ${specifiers.join(", ")} } from ${declarationAfter.moduleSpecifier.getText()};`;
  return rewritten.slice(0, start) + text + rewritten.slice(end);
}

/** Rewrites one parsed source file. */
function fixSourceFile(sourceFile: ts.SourceFile, checker: ts.TypeChecker, text: string): IFixResult {
  const bindings = readBindings(sourceFile);
  const context: IEmitContext = { bindings, required: new Set(), usedIdentifiers: identifiersOf(sourceFile) };
  const before = referenceCounts(sourceFile, bindings.named.keys());
  const usedBefore = new Set([...before].filter(([, count]) => count > 0).map(([name]) => name));
  const replacements: IReplacement[] = [];
  const skipped: ISkippedSite[] = [];
  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const parsed = booleanAssertionOf(bindings, node);
      if (parsed !== null && "unbound" in parsed) {
        skipped.push({ line: lineOf(node), reason: parsed.unbound });
      } else if (parsed !== null) {
        const plan = planEdit(checker, context, parsed.assertion, text);
        if ("skip" in plan) skipped.push({ line: lineOf(node), reason: plan.skip });
        else replacements.push(plan);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const applied = applyReplacements(text, replacements);
  if (applied.applied === 0) return { text, changed: 0, skipped };
  const withImports = rewriteImports(applied.text, sourceFile.fileName, bindings, {
    required: context.required,
    usedBefore,
  });
  return { text: withImports, changed: applied.applied, skipped };
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

/** True when the lint policy classes the repository-relative path as a test file. */
function isTestPath(repoPath: string): boolean {
  return classifyRepoPath(repoPath) === TEST_CLASS;
}

/** Why one manifest entry is not acceptable, or null when it is. */
async function entryProblem(entry: string, root: string, realRoot: string): Promise<string | null> {
  if (normalize(entry) !== entry || isAbsolute(entry) || entry.startsWith("..") || entry.includes("\\")) {
    return `${entry}: not a canonical repository-relative path`;
  }
  if (!/\.tsx?$/.test(entry) || entry.endsWith(".d.ts")) return `${entry}: not a TypeScript source file`;
  if (!CONSUMER_ROOTS.has(entry.split("/")[0])) return `${entry}: outside the consumer roots`;
  const classification = classifyRepoPath(entry);
  if (classification !== TEST_CLASS) {
    return `${entry}: a ${classification === "prod" ? "production" : classification} file`;
  }
  let real: string;
  try {
    const info = await Deno.stat(join(root, entry));
    if (!info.isFile) return `${entry}: not a file`;
    real = await Deno.realPath(join(root, entry));
  } catch {
    return `${entry}: missing or unreadable`;
  }
  const inside = relative(realRoot, real);
  if (inside.startsWith("..") || isAbsolute(inside) || !CONSUMER_ROOTS.has(inside.split(SEPARATOR)[0])) {
    return `${entry}: resolves to ${real}, outside the consumer roots`;
  }
  return null;
}

/** Validates a manifest and resolves with its files. It rejects before any caller can write. */
export async function validateFileManifest(manifestText: string, root: string): Promise<string[]> {
  let parsed: ReturnType<typeof JSON.parse>;
  try {
    parsed = JSON.parse(manifestText);
  } catch {
    throw new Error("the manifest is malformed JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("the manifest must be a JSON array of paths");
  if (parsed.length === 0) throw new Error("the manifest is empty");
  const problems: string[] = [];
  const seen = new Set<string>();
  const entries: string[] = [];
  const realRoot = await Deno.realPath(root);
  for (const entry of parsed) {
    if (!ManifestEntry.safeParse(entry).success) {
      problems.push(`${JSON.stringify(entry)}: every entry must be a non-empty string`);
      continue;
    }
    if (seen.has(entry)) {
      problems.push(`${entry}: duplicate entry`);
      continue;
    }
    seen.add(entry);
    const problem = await entryProblem(entry, root, realRoot);
    if (problem === null) entries.push(entry);
    else problems.push(problem);
  }
  if (problems.length > 0) throw new Error(`the manifest is not acceptable:\n  ${problems.join("\n  ")}`);
  return entries;
}

/** Collects the test-scope `.ts` and `.tsx` files under the given roots. */
async function collectTestFiles(roots: readonly string[]): Promise<string[]> {
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
        if (!entry.path.endsWith(".d.ts") && isTestPath(entry.path)) files.push(entry.path);
      }
    } catch {
      // A root that does not exist contributes no files.
    }
  }
  return files.sort();
}

/** The files a run covers: the validated manifest, or the test files under the roots. */
async function targetFiles(args: readonly string[]): Promise<string[]> {
  const flag = args.find((arg) => arg.startsWith(MANIFEST_FLAG));
  const roots = args.filter((arg) => !arg.startsWith("--"));
  if (flag === undefined) return await collectTestFiles(roots.length > 0 ? roots : DEFAULT_ROOTS);
  if (roots.length > 0) throw new Error("a manifest and roots cannot be combined");
  const manifestText = await Deno.readTextFile(flag.slice(MANIFEST_FLAG.length));
  return await validateFileManifest(manifestText, Deno.cwd());
}

/** Runs the codemod over the target files and resolves with the exit code. */
async function main(args: readonly string[]): Promise<number> {
  const checkOnly = args.includes("--check");
  let paths: string[];
  try {
    paths = await targetFiles(args);
  } catch (error) {
    console.error(`fix_bool_asserts: ${error instanceof Error ? error.message : String(error)}`);
    return USAGE_EXIT_CODE;
  }
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
    for (const site of result.skipped) console.error(`residual ${path}:${site.line}: ${site.reason}`);
    if (result.changed === 0) continue;
    changedFiles++;
    if (!checkOnly) await Deno.writeTextFile(path, result.text);
    console.error(`${checkOnly ? "would fix" : "fixed"} ${path} (${result.changed})`);
  }
  console.error(`fix_bool_asserts: ${changedFiles} file(s), ${skippedTotal} skipped site(s)`);
  return checkOnly && changedFiles > 0 ? 1 : 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
