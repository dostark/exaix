#!/usr/bin/env -S deno run -A
/**
 * @module CheckCodeStyle
 * @path packages/lint-policy/src/checkers/check_code_style.ts
 * @description Scans all .ts and .tsx files for code style violations defined in docs/CODE_STYLE.md.
 * @architectural-layer Tooling
 * @dependencies [typescript, @std/fs, @std/path, zod, @dostark/unslop-ts]
 * @related-files [packages/lint-policy/src/checkers/check_magic_values.ts]
 * @public Exports are the unit-test surface of this module.
 *
 * Usage:
 *   deno run -A packages/lint-policy/src/checkers/check_code_style.ts [path] [--root=<dir>]
 *
 * The repository root comes from `--root=` or the working directory. Run it from the
 * repository root, as the `check:style` task does.
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, globToRegExp, join, normalize, relative } from "@std/path";
import { classifyPath, type ICatalog, type JsonValue, type PathClass, ruleSettings } from "@dostark/unslop-ts";
import {
  DuplicateTypeOptionsSchema,
  findDuplicateTypes,
  validateTypeAllowEntries,
} from "@dostark/unslop-ts/whole-tree";
import { EXAIX_REGISTRY } from "../rule_packs.ts";
import { POLICY_CATALOG } from "../policy_config.ts";
import {
  LAYOUT,
  RE_PACKAGE_NAME_CAPTURE,
  RE_PACKAGE_ROOT_ENTRYPOINT,
  RE_PACKAGE_SRC_CAPTURE,
  RE_PACKAGE_TESTS_CAPTURE,
} from "../repo_layout.ts";

/** Resolves the repository root from `--root=` or the working directory. */
function resolveRepoRoot(): string {
  const rootArg = Deno.args.find((arg) => arg.startsWith("--root="));
  return rootArg ? normalize(rootArg.slice("--root=".length)) : normalize(Deno.cwd());
}

const REPO_ROOT = resolveRepoRoot();

const CATALOG: ICatalog = POLICY_CATALOG;

/** Classifies a repository-relative path with the shared catalog scopes. */
export function classifyRepoPath(repoPath: string): PathClass {
  return classifyPath(repoPath, CATALOG.scopes);
}

/** Walker skip list, from the catalog `ignore` globs (each carries a reason). */
const IGNORE_GLOBS = (CATALOG.ignore ?? []).map((entry) =>
  globToRegExp(entry.glob, { extended: true, globstar: true })
);

const GLOB_CACHE = new Map<string, RegExp>();

function globRegex(glob: string): RegExp {
  let regex = GLOB_CACHE.get(glob);
  if (!regex) {
    regex = globToRegExp(glob, { extended: true, globstar: true });
    GLOB_CACHE.set(glob, regex);
  }
  return regex;
}

function matchesAnyGlob(repoPath: string, globs: string[]): boolean {
  return globs.some((glob) => globRegex(glob).test(repoPath));
}

/** Resolves a rule's effective severity for a path, or null when the rule does not apply. */
function ruleEnabled(catalog: ICatalog, ruleName: string, repoPath: string): "error" | "warn" | null {
  const settings = ruleSettings(catalog, ruleName, EXAIX_REGISTRY);
  if (settings.severity === "off") return null;
  const pathClass = classifyPath(repoPath, catalog.scopes);
  if (pathClass === "fixture") return null;
  if (settings.scope === "test" && pathClass !== "test") return null;
  if (settings.scope === "prod" && pathClass !== "prod") return null;
  if (settings.include && !matchesAnyGlob(repoPath, settings.include)) return null;
  if (settings.exclude && matchesAnyGlob(repoPath, settings.exclude)) return null;
  return settings.severity;
}

interface Rule {
  name: string;
  regex: RegExp;
  message: string;
}

interface ITestingShimExportInfo {
  alias: string;
  exportedNames: Set<string>;
}

interface IPublicPackageAlias {
  alias: string;
  entryPath: string;
  rootPath: string;
  packageRoot: string;
}

const ROOT_OWNED_PARENT_EXPORT_ALIASES = new Set([
  "@exaix/core/types",
]);

const RETIRED_ROOT_HEADER_RELATED_FILES = new Set([
  ...LAYOUT.retiredRootHeaderRelatedFiles,
]);

function isPackageRootEntrypoint(path: string): boolean {
  return RE_PACKAGE_ROOT_ENTRYPOINT.test(path);
}

function parseHeaderRelatedFiles(headerText: string): string[] {
  const match = headerText.match(/@related-files\s*\[([\s\S]*?)\]/);
  if (!match) {
    return [];
  }

  return match[1].split(",")
    .map((entry) => entry.trim())
    .map((entry) => entry.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function parseNamedSymbols(clause: string): string[] {
  return clause.split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean)
    .map((symbol) => symbol.replace(/^type\s+/, ""))
    .map((symbol) => symbol.split(/\s+as\s+/)[0]?.trim() ?? "")
    .filter(Boolean);
}

function isRepoRelativeSpecifier(specifier: string): boolean {
  return !/^[a-z]+:/i.test(specifier) && !specifier.startsWith("//");
}

/** How many preceding source lines to scan for the enclosing `editionType` guard. */
const EDITION_GUARD_LOOKBACK_LINES = 12;

/** A dynamic import of @exaix-team/* or the daemon's bootstrap_team module. */
function isTeamDynamicImportLine(line: string): boolean {
  return /\bimport\s*\(\s*["'](@exaix-team\/|\.\/src\/bootstrap_team)/.test(line);
}

/** True when the import sits in one of the two sanctioned edition-dispatch entry points.
 *  Those points include the Team-edition counterparts under exaix-team/.
 *  They use the same dispatch mechanism and carry the same edition-gated dynamic import. */
function isEditionDispatchEntry(repoPath: string): boolean {
  return LAYOUT.editionAppPrefixes.some((prefix) => repoPath.startsWith(prefix));
}

/**
 * True when an `editionType` guard appears within the preceding-lines window.
 * The guard proves the dynamic import is reached only in a non-Solo run.
 * Without it the module would load unconditionally at module scope.
 */
function precededByEditionGuard(precedingLines: string[]): boolean {
  const window = precedingLines.slice(-EDITION_GUARD_LOOKBACK_LINES);
  return window.some((l) => /\beditionType\s*(?:===?|!==?)\s*EDITION_/.test(l));
}

/**
 * True for a genuinely edition-gated dynamic Team import.
 * It sits in a dispatch entry, is dynamic, and is preceded by an `editionType` guard.
 * It is the only allowed upper-edition value reference in lower-edition source.
 * A Solo source-run never executes it, so the Team module never loads.
 *
 * Without an edition guard the import would load Team code even in Solo.
 * A deploy ships source, not a compiled binary, so the guard keeps Solo clean.
 * See dev/Exaix_Edition_Architecture.md.
 */
function isGuardedEditionDynamicImport(repoPath: string, line: string, precedingLines: string[]): boolean {
  return isEditionDispatchEntry(repoPath) &&
    isTeamDynamicImportLine(line) &&
    precededByEditionGuard(precedingLines);
}

/** Edition tier prefixes, read from the `edition-leak` catalog entry. */
interface IEditionTiers {
  readonly soloTier: number;
  readonly teamTier: number;
  readonly enterpriseTier: number;
  readonly soloPrefixes: string[];
  readonly teamPrefixes: string[];
  readonly enterprisePrefixes: string[];
  readonly teamAppPaths: string[];
}

function stringListOption(value: JsonValue, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : fallback;
}

const EDITION_TIER_OPTIONS = ruleSettings(CATALOG, "edition-leak", EXAIX_REGISTRY).options;

export const EDITION_TIERS: IEditionTiers = {
  soloTier: Number(EDITION_TIER_OPTIONS.soloTier ?? 0),
  teamTier: Number(EDITION_TIER_OPTIONS.teamTier ?? 1),
  enterpriseTier: Number(EDITION_TIER_OPTIONS.enterpriseTier ?? 2),
  soloPrefixes: stringListOption(EDITION_TIER_OPTIONS.soloPrefixes, [LAYOUT.packageRoot, LAYOUT.appRoot]),
  teamPrefixes: stringListOption(EDITION_TIER_OPTIONS.teamPrefixes, [LAYOUT.teamRoot]),
  enterprisePrefixes: stringListOption(EDITION_TIER_OPTIONS.enterprisePrefixes, [LAYOUT.enterpriseRoot]),
  teamAppPaths: stringListOption(EDITION_TIER_OPTIONS.teamAppPaths, [LAYOUT.teamAppBootstrap]),
};

/**
 * Edition tier of a repo path. Higher number = higher (more restricted) tier.
 * `tiers` comes from the catalog's `edition-leak` options, so callers share one source.
 */
export function editionTierOfPath(repoPath: string, tiers: IEditionTiers): number | null {
  if (tiers.enterprisePrefixes.some((prefix) => repoPath.startsWith(prefix))) return tiers.enterpriseTier;
  if (tiers.teamPrefixes.some((prefix) => repoPath.startsWith(prefix))) return tiers.teamTier;
  if (tiers.teamAppPaths.some((prefix) => repoPath === prefix || repoPath.startsWith(prefix))) return tiers.teamTier;
  if (tiers.soloPrefixes.some((prefix) => repoPath.startsWith(prefix))) return tiers.soloTier;
  return null; // scripts/, tests/, etc. — not an edition-tiered module
}

/** Edition tier of an import specifier, or null when it is not edition-tiered. */
function editionTierOfSpecifier(specifier: string): number | null {
  if (/(^|\/)exaix-enterprise(\/|$)|^@exaix-enterprise(\/|$)/.test(specifier)) {
    return EDITION_TIERS.enterpriseTier;
  }
  if (/(^|\/)exaix-team(\/|$)|^@exaix-team(\/|$)/.test(specifier)) {
    return EDITION_TIERS.teamTier;
  }
  return null;
}

/**
 * True when a module imports from a higher edition tier than its own.
 * That leak couples a lower edition's source to code licensed separately.
 * One example is a Solo app importing BSL Team code.
 * The tier order is packages/ and apps/, then exaix-team/, then exaix-enterprise/.
 *
 * Test files are exempt, because integration tests may exercise higher tiers.
 * Type-only imports are exempt, because they are erased at compile.
 * A dynamic Team import in a dispatch entry is exempt when a guard precedes it.
 * A dynamic import without a guard is not exempt.
 * It would load Team code even in a Solo run.
 * The guard check reads `precedingLines`, the source above `line`.
 */
export function isEditionLeakImport(
  repoPath: string,
  line: string,
  precedingLines: string[] = [],
): boolean {
  const sourceTier = editionTierOfPath(repoPath, EDITION_TIERS);
  if (sourceTier === null) return false;
  if (
    repoPath.includes(LAYOUT.testsSegment) ||
    repoPath.includes(LAYOUT.testingSegment) ||
    repoPath.endsWith("_test.ts") ||
    repoPath.endsWith(".test.ts")
  ) {
    return false;
  }
  // type-only imports are erased at compile time and never enter a bundle.
  if (/^\s*import\s+type\b/.test(line)) return false;
  // the only sanctioned upper-edition value reference: an edition-GUARDED dynamic import.
  if (isGuardedEditionDynamicImport(repoPath, line, precedingLines)) return false;

  const specMatch = line.match(/(?:from|import)\s*\(?\s*["']([^"']+)["']/);
  const specifier = specMatch?.[1];
  if (!specifier) return false;

  const targetTier = editionTierOfSpecifier(specifier);
  if (targetTier === null) return false;
  return targetTier > sourceTier;
}

function discoverPackageTestingAliases(): Map<string, string> {
  const aliases = new Map<string, string>();
  const packagesDir = join(REPO_ROOT, "packages");

  try {
    for (const entry of Deno.readDirSync(packagesDir)) {
      if (!entry.isDirectory) continue;
      const testingDir = join(packagesDir, entry.name, "testing");
      try {
        const stat = Deno.statSync(testingDir);
        if (stat.isDirectory) {
          aliases.set(entry.name, `@exaix/${entry.name}/testing`);
        }
      } catch {
        // No public testing surface for this package.
      }
    }
  } catch {
    // Repository layout unavailable; keep alias map empty.
  }

  return aliases;
}

function discoverPublicPackageAliases(): IPublicPackageAlias[] {
  const aliases: IPublicPackageAlias[] = [];
  const denoJsonPath = join(REPO_ROOT, "deno.json");

  try {
    // SAFETY: deno.json is local config, and only its optional imports map is read.
    const denoJson = JSON.parse(Deno.readTextFileSync(denoJsonPath)) as {
      imports?: Record<string, string>;
    };

    for (const [alias, mappedPath] of Object.entries(denoJson.imports ?? {})) {
      if ((!alias.startsWith("@exaix/") && !alias.startsWith("@exaix-team/")) || alias.endsWith("/")) {
        continue;
      }
      if (!isRepoRelativeSpecifier(mappedPath)) {
        continue;
      }

      const entryPath = normalize(mappedPath.replace(/^\.\//, ""));
      if (!entryPath.startsWith(LAYOUT.packageRoot) && !entryPath.startsWith(LAYOUT.teamRoot)) {
        continue;
      }

      // A root package is two segments deep relative to the repository root.
      // A Team package or app sits one level deeper under exaix-team/.
      const rootSegments = entryPath.startsWith(LAYOUT.teamRoot) ? 3 : 2;
      const segments = entryPath.split("/");
      const packageName = segments[rootSegments - 1];
      if (!packageName || segments.length <= rootSegments) {
        continue;
      }

      const packageRoot = normalize(segments.slice(0, rootSegments).join("/"));
      const rootPath = normalize(dirname(entryPath));
      aliases.push({ alias, entryPath, rootPath, packageRoot });
    }
  } catch {
    // Root import-map metadata unavailable; keep alias list empty.
  }

  return aliases.sort((a, b) => {
    if (b.alias.length !== a.alias.length) {
      return b.alias.length - a.alias.length;
    }

    return b.rootPath.length - a.rootPath.length;
  });
}

function findCanonicalPackageAlias(normalizedImport: string, importerRepoPath: string): IPublicPackageAlias | null {
  for (const aliasInfo of publicPackageAliases) {
    if (importerRepoPath.startsWith(`${aliasInfo.packageRoot}/`)) {
      continue;
    }

    if (normalizedImport === aliasInfo.entryPath) {
      return aliasInfo;
    }

    if (
      aliasInfo.rootPath !== aliasInfo.packageRoot &&
      normalizedImport.startsWith(`${aliasInfo.rootPath}/`)
    ) {
      return aliasInfo;
    }
  }

  return null;
}

function findCanonicalPackageAliasForSpecifier(importPath: string): IPublicPackageAlias | null {
  for (const aliasInfo of publicPackageAliases) {
    if (aliasInfo.rootPath === aliasInfo.packageRoot) {
      continue;
    }

    if (importPath.startsWith(`${aliasInfo.alias}/`)) {
      return aliasInfo;
    }
  }

  return null;
}

function findPromotedSubpackageAliasForParentEntrypoint(
  normalizedImport: string,
  importerRepoPath: string,
): IPublicPackageAlias | null {
  if (!isPackageRootEntrypoint(importerRepoPath)) {
    return null;
  }

  const packageRoot = importerRepoPath.split("/").slice(0, 2).join("/");
  for (const aliasInfo of publicPackageAliases) {
    if (
      aliasInfo.packageRoot !== packageRoot ||
      aliasInfo.rootPath === aliasInfo.packageRoot ||
      ROOT_OWNED_PARENT_EXPORT_ALIASES.has(aliasInfo.alias)
    ) {
      continue;
    }

    if (normalizedImport === aliasInfo.entryPath || normalizedImport.startsWith(`${aliasInfo.rootPath}/`)) {
      return aliasInfo;
    }
  }

  return null;
}

function discoverRootTestingShimExports(): Map<string, ITestingShimExportInfo> {
  const shimExports = new Map<string, ITestingShimExportInfo>();
  const helpersDir = join(REPO_ROOT, "tests", "helpers");
  const exportRegex = /export(?:\s+type)?\s*{([\s\S]*?)}\s*from\s*["'](@exaix\/[^"']+\/testing)["']/g;

  try {
    for (const entry of Deno.readDirSync(helpersDir)) {
      if (!entry.isFile || !entry.name.endsWith(".ts")) continue;

      const absolutePath = join(helpersDir, entry.name);
      const repoPath = `${LAYOUT.rootTestHelpers}${entry.name}`;
      const source = Deno.readTextFileSync(absolutePath);

      for (const match of source.matchAll(exportRegex)) {
        const alias = match[2];
        const exportedNames = parseNamedSymbols(match[1]);
        const existing = shimExports.get(repoPath) ?? { alias, exportedNames: new Set<string>() };
        existing.alias = alias;
        exportedNames.forEach((name) => existing.exportedNames.add(name));
        shimExports.set(repoPath, existing);
      }
    }
  } catch {
    // Root helper directory unavailable; keep shim map empty.
  }

  return shimExports;
}

function resolveRepoImportPath(importerRepoPath: string, importPath: string): string | null {
  if (importPath.startsWith(".")) {
    return normalize(join(dirname(importerRepoPath), importPath));
  }
  if (importPath.startsWith(LAYOUT.packageRoot) || importPath.startsWith(LAYOUT.testsRoot)) {
    return normalize(importPath);
  }

  return null;
}

function getPackageTestingAliasForTestImport(normalizedImport: string): { packageName: string; alias: string } | null {
  const match = normalizedImport.match(RE_PACKAGE_TESTS_CAPTURE);
  if (!match) {
    return null;
  }

  const packageName = match[1];
  const alias = packageTestingAliases.get(packageName);
  if (!alias) {
    return null;
  }

  return { packageName, alias };
}

const packageTestingAliases = discoverPackageTestingAliases();
const rootTestingShimExports = discoverRootTestingShimExports();
const publicPackageAliases = discoverPublicPackageAliases();

const args = new Set(Deno.args);
const convertWarnings = args.has("--convert-warnings-to-errors");

if (args.has("--help") || args.has("-h")) {
  console.log(`Exaix Code Style Checker

Usage:

  deno run ${LAYOUT.packageRoot}lint-policy/${LAYOUT.srcRoot}checkers/check_code_style.ts [options] [paths...]

Options:
  --help, -h          Show this help message

  --convert-warnings-to-errors  Convert all warnings to errors

Description:
  Scans all .ts and .tsx files in the Exaix repository for code style violations
  defined in docs/CODE_STYLE.md. Exits with code 1 if any errors are found.
  `);
  Deno.exit(0);
}

// Layer-aware constant imports, checked on the syntax tree.
//
// The check fires when a file in package P value-imports a symbol from a
// domain-implementation package Q.
// That pattern suggests the orchestrator bypasses the service boundary.
//
// Domain-implementation packages export classes, command constants and runtime
// primitives.
// Framework and API packages export interfaces, types, enums and event names.
//
// The check uses the TypeScript compiler API, not regular expressions.
// It handles multi-line imports, type-only imports and per-binding type annotations.

/**
 * Framework/API packages that export shared contracts — value imports
 * from these are always OK.
 */
const LAYER_LEAK_FRAMEWORK = new Set([
  "@exaix/core",
  "@exaix/schemas",
  // The shared package holds the constants below core and schemas, so it is part of the same contract layer.
  "@exaix/shared",
  "@exaix/ai",
  "@exaix/cli",
  "@exaix/tui",
  "@exaix/testing",
]);

/** Known bridge files — exempt from layer-leak checks. */
const LAYER_LEAK_EXEMPT = new Set(LAYOUT.layerLeakExempt.map((entry) => entry.path));

/**
 * Detects a file that value-imports a class from another domain package.
 * It looks for a `new` call on that class.
 *
 * The check is structural and names no symbols.
 * It parses all import declarations and maps each imported name to its package.
 * Then it walks every `NewExpression` node.
 * A constructor that matches an imported value from another domain package is flagged.
 */
function isFrameworkSpecifier(specifier: string): boolean {
  if (LAYER_LEAK_FRAMEWORK.has(specifier)) return true;
  for (const p of LAYER_LEAK_FRAMEWORK) {
    if (specifier.startsWith(p + "/")) return true;
  }
  return false;
}

function isDomainImportSpecifier(specifier: string, myPackage: string): boolean {
  if (!specifier.startsWith("@exaix/")) return false;
  if (isFrameworkSpecifier(specifier)) return false;
  if (
    specifier.startsWith("@exaix/ai-") || specifier.startsWith("@exaix-team/") ||
    specifier.startsWith("@exaix/tui/") || specifier.startsWith("@exaix/cli/")
  ) return false;
  const targetPkg = specifier.match(/^@exaix\/([^/]+)/)?.[1];
  return Boolean(targetPkg) && targetPkg !== myPackage;
}

function importBindingNames(
  bindings: ts.NamedImports,
  specifier: string,
  sourceFile: ts.SourceFile,
): Array<{ name: string; specifier: string; line: number }> {
  const result: Array<{ name: string; specifier: string; line: number }> = [];
  for (const el of bindings.elements) {
    if (el.isTypeOnly) continue;
    const name = el.name.text;
    if (/^I[A-Z]/.test(name)) continue; // I-prefixed = interface, not a constant
    result.push({ name, specifier, line: sourceFile.getLineAndCharacterOfPosition(el.getStart()).line + 1 });
  }
  return result;
}

function domainImportBindings(
  node: ts.Node,
  myPackage: string,
  sourceFile: ts.SourceFile,
): Array<{ name: string; specifier: string; line: number }> | null {
  if (!ts.isImportDeclaration(node)) return null;
  const specNode = node.moduleSpecifier;
  if (!ts.isStringLiteral(specNode)) return null;
  if (!isDomainImportSpecifier(specNode.text, myPackage)) return null;
  const clause = node.importClause;
  if (!clause || clause.isTypeOnly) return null;
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return null;
  return importBindingNames(bindings, specNode.text, sourceFile);
}

function collectDomainImports(
  sourceFile: ts.SourceFile,
  myPackage: string,
): Map<string, { specifier: string; line: number }> {
  const imported = new Map<string, { specifier: string; line: number }>();
  ts.forEachChild(sourceFile, (node) => {
    const bindings = domainImportBindings(node, myPackage, sourceFile);
    if (!bindings) return;
    for (const binding of bindings) imported.set(binding.name, { specifier: binding.specifier, line: binding.line });
  });
  return imported;
}

function findNewExpressionNames(node: ts.Node, names: Set<string>): void {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) names.add(node.expression.text);
  ts.forEachChild(node, (child) => findNewExpressionNames(child, names));
}

function reportConcreteCrossDomain(
  newNames: Set<string>,
  imported: Map<string, { specifier: string; line: number }>,
  sourceFile: ts.SourceFile,
  repoPath: string,
): void {
  for (const name of newNames) {
    const info = imported.get(name);
    if (!info) continue;
    const prefix = convertWarnings ? "ERROR" : "WARN";
    console.log(
      `${prefix} [concrete-cross-domain] ${sourceFile.fileName}:${info.line} – ` +
        `Concrete class '${name}' imported from '${info.specifier}' ` +
        `and instantiated via \`new ${name}(\` in a different-domain file ` +
        `(${repoPath}). Accept an interface via DI instead of importing ` +
        `the concrete class. See docs/CODE_STYLE.md#di-and-interfaces (DI) and docs/CODE_STYLE.md#layer-aware-constant-imports.`,
    );
    if (convertWarnings) errorCount++;
    else warnCount++;
  }
}

function removeNamesUsedInPropertyAccess(
  sourceFile: ts.SourceFile,
  imported: Map<string, { specifier: string; line: number }>,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      imported.delete(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function removeNamesUsedInCalls(
  sourceFile: ts.SourceFile,
  imported: Map<string, { specifier: string; line: number }>,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      imported.delete(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function reportLayerConstantLeaks(
  imported: Map<string, { specifier: string; line: number }>,
  sourceFile: ts.SourceFile,
  repoPath: string,
): void {
  for (const [name, info] of imported) {
    const prefix = convertWarnings ? "ERROR" : "WARN";
    console.log(
      `${prefix} [layer-constant-leak] ${sourceFile.fileName}:${info.line} – ` +
        `Constant-like value '${name}' imported from '${info.specifier}' ` +
        `in a different-domain file (${repoPath}). ` +
        `Low-level constants belong behind the service that owns them; ` +
        `avoid importing them in composition-root code. ` +
        `See docs/CODE_STYLE.md#layer-aware-constant-imports.`,
    );
    if (convertWarnings) errorCount++;
    else warnCount++;
  }
}

function checkLayerLeaks(sourceFile: ts.SourceFile, repoPath: string): void {
  if (!repoPath.startsWith(LAYOUT.packageRoot)) return;
  if (
    repoPath.includes(LAYOUT.testsSegment) || repoPath.includes(LAYOUT.testingSegment) || repoPath.endsWith("_test.ts")
  ) return;
  if (LAYER_LEAK_EXEMPT.has(repoPath)) return;

  const pkgMatch = repoPath.match(RE_PACKAGE_NAME_CAPTURE);
  if (!pkgMatch) return;
  const myPackage = pkgMatch[1];

  // Step 1: imported names from other domain packages.
  const imported = collectDomainImports(sourceFile, myPackage);
  if (imported.size === 0) return;

  // Step 2: names used as constructors (new X(...)).
  const newNames = new Set<string>();
  findNewExpressionNames(sourceFile, newNames);

  // Step 2b: flag concrete instantiation of foreign classes.
  reportConcreteCrossDomain(newNames, imported, sourceFile, repoPath);
  for (const name of newNames) imported.delete(name);

  // Steps 3-4: drop names used in property access (X.Y) and calls (X(...)).
  removeNamesUsedInPropertyAccess(sourceFile, imported);
  removeNamesUsedInCalls(sourceFile, imported);

  // Step 5: remaining names are constant-like.
  reportLayerConstantLeaks(imported, sourceFile, repoPath);
}

// The rules match the code style guidelines in docs/CODE_STYLE.md.
// A violation prints a plain-language explanation.
// The script exits non-zero when it finds any error, so hooks and CI can gate on it.
const rules: Rule[] = [
  // The former [mit-team-import] regex rule is superseded.
  // The [edition-leak] check in checkFile() replaces it with the full tier order.
  // That order runs Solo, then Team, then Enterprise.
  // Type-only and edition-gated dynamic imports stay exempt.
  // See isEditionLeakImport().
  //
  // The former [layer-constant-leak] regex rule is also superseded, by checkLayerLeaks().
  // That check is AST-based and uses the TypeScript compiler API.
  {
    name: "edition-conditional-outside-composer",
    // Forbid edition conditionals (edition ===, edition !==, EXAIX_EDITION)
    // outside the edition composer. Edition-selection logic must be contained
    // in the composer — core packages and apps must not branch on edition.
    regex: /EXAIX_EDITION|\bedition\s*(?:===?|!==?)/,
    message:
      "Edition conditionals (edition === / EXAIX_EDITION) are only allowed inside the edition composer. Move edition-selection logic to the composer, or check the composer for inadvertent edition branching in core code.",
  },
];

/** Script rule ids implemented as inline checks (not in the `rules` array). */
const INLINE_SCRIPT_RULE_IDS = [
  "duplicate-constant",
  "duplicate-type",
  "module-header-tag",
  "edition-leak",
  "script-placement",
  "package-boundary",
  "package-related-files-boundary",
  "package-subpath-promotion",
  "package-testing-import",
  "package-canonical-import",
  "package-instantiates-event-logger",
  "package-concrete-logger-type",
  "package-uses-config-reader",
  "concrete-cross-domain",
  "layer-constant-leak",
];

/** Every script rule id the checker implements: the `rules` array plus the inline checks. */
export const IMPLEMENTED_SCRIPT_RULE_IDS: ReadonlySet<string> = new Set([
  ...rules.map((rule) => rule.name),
  ...INLINE_SCRIPT_RULE_IDS,
]);

let errorCount = 0;
let warnCount = 0;

/** Module header tag and script placement checks (docs/CODE_STYLE.md#module-structure and docs/CODE_STYLE.md#utility-scripts). */
function checkModuleHeader(path: string, repoPath: string, lines: string[], headerFound: boolean): void {
  if (!headerFound) return;
  if (path.includes(LAYOUT.testsSegment)) return;

  const headerLines = lines.slice(0, 15).join("\n");
  for (const tag of ["@module", "@path", "@description"]) {
    if (!headerLines.includes(tag)) {
      console.log(`ERROR [module-header-tag] ${path}:1 – Header is missing mandatory '${tag}' tag.`);
      errorCount++;
    }
  }

  if (repoPath.startsWith(LAYOUT.packageRoot)) {
    for (const relatedFile of parseHeaderRelatedFiles(headerLines)) {
      if (!RETIRED_ROOT_HEADER_RELATED_FILES.has(relatedFile)) continue;
      console.log(
        `ERROR [package-related-files-boundary] ${path}:1 – Package-owned module headers must not reference retired root compatibility paths in '@related-files': '${relatedFile}'. Point to the package-owned source-of-truth module instead.`,
      );
      errorCount++;
    }
  }

  checkScriptPlacement(path);
}

/** Maintenance-script placement check (docs/CODE_STYLE.md#utility-scripts). */
function checkScriptPlacement(path: string): void {
  if (!path.includes(LAYOUT.scriptsSegment) || path.includes(LAYOUT.testsSegment)) return;
  const fileName = path.split("/").pop() || "";
  if (fileName.startsWith("debug_") || fileName.startsWith("tmp_")) {
    console.log(
      `ERROR [script-placement] ${path}:1 – Debug or temporary scripts must be located outside the '${LAYOUT.scriptsRoot}' directory.`,
    );
    errorCount++;
  }
}

function isConfigServiceConfigUsage(trimmedLine: string, line: string): boolean {
  const isImport = trimmedLine.startsWith("import") && trimmedLine.includes("ConfigService") &&
    trimmedLine.includes("@exaix/core");
  const isUsage = !trimmedLine.startsWith("import") && line.match(/\bnew\s+ConfigService\s*\(/) !== null;
  return isImport || isUsage;
}

/** Reports the package-purity violations for one source line (docs/CODE_STYLE.md#package-module-purity). */
function reportPackagePurityViolations(repoPath: string, line: string, trimmedLine: string, idx: number): void {
  if (line.match(/\bnew\s+EventLogger\s*\(/)) {
    console.log(
      `ERROR [package-instantiates-event-logger] ${repoPath}:${
        idx + 1
      } – Package source modules must not instantiate EventLogger. Accept IEventLogger as an optional constructor parameter injected by the service layer.`,
    );
    errorCount++;
  }

  if (
    trimmedLine.startsWith("import") &&
    trimmedLine.match(/\bEventLogger\b/) &&
    trimmedLine.match(/from\s+["']@exaix\/core/)
  ) {
    const prefix = convertWarnings ? "ERROR" : "WARN";
    console.log(
      `${prefix} [package-concrete-logger-type] ${repoPath}:${
        idx + 1
      } – Package source modules should import IEventLogger (the interface) instead of the concrete EventLogger class. Decouples the package from the runtime logger implementation.`,
    );
    if (convertWarnings) errorCount++;
    else warnCount++;
  }

  if (isConfigServiceConfigUsage(trimmedLine, line)) {
    const prefix = convertWarnings ? "ERROR" : "WARN";
    console.log(
      `${prefix} [package-uses-config-reader] ${repoPath}:${
        idx + 1
      } – Package source modules must not instantiate ConfigService. Receive a Config value as a constructor parameter instead.`,
    );
    if (convertWarnings) errorCount++;
    else warnCount++;
  }
}

/** Package module purity (docs/CODE_STYLE.md#package-module-purity): no runtime infrastructure in package src/. */
function checkPackagePurity(repoPath: string, lines: string[]): void {
  const match = repoPath.match(RE_PACKAGE_SRC_CAPTURE);
  if (!match || match[1] === "core" || repoPath.startsWith(LAYOUT.mcpServerPrefix)) return;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("//") || trimmedLine.startsWith("*") || trimmedLine.startsWith("/*")) continue;
    reportPackagePurityViolations(repoPath, line, trimmedLine, idx);
  }
}

/**
 * Collects the 1-based line numbers that lie inside a template literal.
 * The parsed AST supplies the ranges, not a backtick count.
 * A backtick in a regex, string, or comment can no longer flip the state.
 */
function collectTemplateLiteralLines(sourceFile: ts.SourceFile): Set<number> {
  const lines = new Set<number>();
  function visit(node: ts.Node): void {
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      for (let line = startLine; line <= endLine; line++) lines.add(line);
      return;
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return lines;
}

/**
 * True for a line that is only a `//`, `/*`, or `*` comment.
 * Code-shape rules then do not read comment prose as code.
 */
const SOURCE_UNITS: Array<{ path: string; text: string }> = [];

async function checkFile(path: string) {
  const text = await Deno.readTextFile(path);
  SOURCE_UNITS.push({ path: relative(REPO_ROOT, path), text });
  checkFileFromText(path, text, CATALOG);
}

/** Whole-tree duplicate type-contract pass, run after the per-file checks. */
function runDuplicateTypePass(): void {
  const settings = ruleSettings(CATALOG, "duplicate-type", EXAIX_REGISTRY);
  const options = DuplicateTypeOptionsSchema.parse(settings.options);
  const include = settings.include ?? [];
  const prodUnits = SOURCE_UNITS.filter((unit) =>
    classifyRepoPath(unit.path) === "prod" &&
    (include.length === 0 || matchesAnyGlob(unit.path, include))
  );
  for (const duplicate of findDuplicateTypes(prodUnits, options)) {
    console.log(
      `ERROR [duplicate-type] ${duplicate.laterFile} – '${duplicate.name}' duplicates ${duplicate.firstFile}. Keep one owner and import it.`,
    );
    errorCount++;
  }
  for (const name of validateTypeAllowEntries(prodUnits, options)) {
    console.log(`ERROR [duplicate-type] the allow entry '${name}' matches no current duplicate.`);
    errorCount++;
  }
  if (SOURCE_UNITS.length > 0) console.log("✅ Duplicate type-contract pass complete.");
}

interface IStyleRuleContext {
  readonly path: string;
  readonly repoPath: string;
  readonly lines: string[];
  readonly catalog: ICatalog;
  readonly templateLiteralLines: Set<number>;
}

/** Prints a regex-rule violation and counts it. */
function reportRegexViolation(rule: Rule, severity: "error" | "warn", idx: number, ctx: IStyleRuleContext): void {
  const actualSeverity = convertWarnings ? "error" : severity;
  const prefix = actualSeverity === "error" ? "ERROR" : "WARN";
  console.log(`${prefix} [${rule.name}] ${ctx.path}:${idx + 1} – ${rule.message}`);
  if (actualSeverity === "error") errorCount++;
  else warnCount++;
}

/** Evaluates one rule against one line, reporting any violation. */
function evaluateStyleRuleLine(
  rule: Rule,
  severity: "error" | "warn",
  line: string,
  idx: number,
  ctx: IStyleRuleContext,
): void {
  if (ctx.templateLiteralLines.has(idx + 1)) return;
  if (rule.regex.test(line)) reportRegexViolation(rule, severity, idx, ctx);
}

/** Evaluates every catalog regex rule over the file's lines. */
function evaluateStyleRules(ctx: IStyleRuleContext): void {
  for (const rule of rules) {
    const severity = ruleEnabled(ctx.catalog, rule.name, ctx.repoPath);
    if (!severity) continue;
    for (let idx = 0; idx < ctx.lines.length; idx++) {
      evaluateStyleRuleLine(rule, severity, ctx.lines[idx], idx, ctx);
    }
  }
}

function packageBoundaryLabel(isTestFile: boolean, packageRoot: string): string {
  return isTestFile ? `Package tests under '${packageRoot}/${LAYOUT.testsRoot}'` : `Package module '${packageRoot}'`;
}

interface ICrossPackageImport {
  readonly normalizedImport: string;
  readonly packageRoot: string;
  readonly isTestFile: boolean;
  readonly importPath: string;
  readonly label: string;
}

/** Reports a relative import that reaches code in another package. */
function reportCrossPackageImport(repoPath: string, idx: number, info: ICrossPackageImport): void {
  const isCrossPackage = info.normalizedImport.startsWith(LAYOUT.packageRoot) &&
    !info.normalizedImport.startsWith(`${info.packageRoot}/`) &&
    !(info.isTestFile && info.normalizedImport.includes(LAYOUT.testsSegment)) &&
    !(info.packageRoot === LAYOUT.testingPackageRootBare && info.normalizedImport.startsWith(LAYOUT.aiTestAllow));
  if (!isCrossPackage) return;
  console.log(
    `ERROR [package-boundary] ${repoPath}:${
      idx + 1
    } – ${info.label} must not import code from another package ('${info.importPath}').`,
  );
  errorCount++;
}

/** Reports package-boundary violations for a relative import inside a package. */
function reportPackageBoundary(repoPath: string, line: string, idx: number): void {
  if (!repoPath.startsWith(LAYOUT.packageRoot)) return;
  const match = line.match(/from\s+["']([^"']+)["']/) || line.match(/^\s*import\s+["']([^"']+)["']/);
  const importPath = match?.[1];
  if (!importPath || !importPath.startsWith("..")) return;
  const normalizedImport = normalize(join(dirname(repoPath), importPath));
  const packageRoot = repoPath.split("/").slice(0, 2).join("/");
  const isTestFile = repoPath.includes(LAYOUT.testsSegment);
  const label = packageBoundaryLabel(isTestFile, packageRoot);

  if (normalizedImport.startsWith(LAYOUT.srcRoot)) {
    if (repoPath.startsWith(LAYOUT.mcpServerPrefix) || repoPath.startsWith(LAYOUT.mcpTestsPrefix)) return;
    console.log(
      `ERROR [package-boundary] ${repoPath}:${
        idx + 1
      } – ${label} must not import from the retired root ${LAYOUT.srcRoot} directory: '${importPath}'. Use @exaix/ package aliases instead.`,
    );
    errorCount++;
    return;
  }
  if (normalizedImport.startsWith(LAYOUT.testsRoot) && !normalizedImport.startsWith(LAYOUT.rootTestHelpers)) {
    if (!isTestFile) return;
    console.log(
      `ERROR [package-boundary] ${repoPath}:${
        idx + 1
      } – Package tests under '${packageRoot}/${LAYOUT.testsRoot}' must not import test fixtures from the root ${LAYOUT.testsRoot} directory: '${importPath}'.`,
    );
    errorCount++;
    return;
  }
  reportCrossPackageImport(repoPath, idx, { normalizedImport, packageRoot, isTestFile, importPath, label });
}

function reportPromotedSubpackage(
  repoPath: string,
  line: string,
  idx: number,
  normalizedImport: string,
  importPath: string,
): void {
  if (!/^\s*export\b/.test(line) || !isPackageRootEntrypoint(repoPath)) return;
  const promoted = findPromotedSubpackageAliasForParentEntrypoint(normalizedImport, repoPath);
  if (!promoted) return;
  console.log(
    `ERROR [package-subpath-promotion] ${repoPath}:${
      idx + 1
    } – Parent package entrypoints must not re-export canonical subpackage surfaces. Export this API from '${promoted.alias}' instead of promoting '${importPath}' through '${repoPath}'.`,
  );
  errorCount++;
}

function reportPackageTestingImport(
  repoPath: string,
  idx: number,
  normalizedImport: string,
  importPath: string,
): void {
  const info = getPackageTestingAliasForTestImport(normalizedImport);
  if (!info) return;
  const owningRoot = `${LAYOUT.packageRoot}${info.packageName}/${LAYOUT.testsRoot}`;
  if (repoPath.startsWith(owningRoot)) return;
  console.log(
    `ERROR [package-testing-import] ${repoPath}:${
      idx + 1
    } – Import package-specific test support from '${info.alias}' instead of deep-importing '${importPath}' from '${owningRoot}'.`,
  );
  errorCount++;
}

function reportPackageCanonicalAlias(
  repoPath: string,
  idx: number,
  normalizedImport: string,
  importPath: string,
): void {
  const info = findCanonicalPackageAlias(normalizedImport, repoPath);
  if (!info) return;
  console.log(
    `ERROR [package-canonical-import] ${repoPath}:${
      idx + 1
    } – Import from '${info.alias}' instead of deep-importing the package-owned path '${importPath}'.`,
  );
  errorCount++;
}

function reportCanonicalSpecifierAliases(repoPath: string, idx: number, importPath: string): void {
  const specifierInfo = findCanonicalPackageAliasForSpecifier(importPath);
  if (specifierInfo) {
    console.log(
      `ERROR [package-canonical-import] ${repoPath}:${
        idx + 1
      } – Import from '${specifierInfo.alias}' instead of deep-importing the canonical package subpath '${importPath}'.`,
    );
    errorCount++;
    return;
  }
  const teamAlias = publicPackageAliases.find(
    (a) => a.alias.startsWith("@exaix-team") && a.rootPath === a.packageRoot && importPath.startsWith(`${a.alias}/`),
  );
  if (!teamAlias) return;
  console.log(
    `ERROR [package-canonical-import] ${repoPath}:${
      idx + 1
    } – Import from '${teamAlias.alias}' instead of deep-importing the canonical package subpath '${importPath}'.`,
  );
  errorCount++;
}

/** Reports canonical-alias and subpath-promotion import violations for a line. */
function reportCanonicalImports(repoPath: string, line: string, idx: number): void {
  const match = line.match(/from\s+["']([^"']+)["']/) || line.match(/^\s*import\s+["']([^"']+)["']/);
  const importPath = match?.[1];
  if (!importPath) return;
  const normalizedImport = resolveRepoImportPath(repoPath, importPath);
  if (normalizedImport) {
    reportPromotedSubpackage(repoPath, line, idx, normalizedImport, importPath);
    reportPackageTestingImport(repoPath, idx, normalizedImport, importPath);
    reportPackageCanonicalAlias(repoPath, idx, normalizedImport, importPath);
  }
  reportCanonicalSpecifierAliases(repoPath, idx, importPath);
}

/** Reports a lower-edition module importing a higher edition (source/build leak). */
function reportEditionLeak(repoPath: string, line: string, lines: string[], idx: number): void {
  if (!isEditionLeakImport(repoPath, line, lines.slice(0, idx))) return;
  console.log(
    `ERROR [edition-leak] ${repoPath}:${
      idx + 1
    } – Lower-edition module must not import a higher edition: '${line.trim()}'. A Solo build must not reference Team/Enterprise code. Use a type-only import for types, or an edition-gated (editionType-guarded) dynamic import() in a dispatch entry; otherwise extract the shared contract into ${LAYOUT.packageRoot}core.`,
  );
  errorCount++;
}

/** Runs every style check over one source unit, with `catalog` supplying the settings. */
interface IScanState {
  inMultiLineComment: boolean;
  inMultiLineImport: boolean;
  inTypeDeclaration: boolean;
  protectedBraceCount: number;
  headerFound: boolean;
  firstContentLineNum: number;
}

interface IScanResult {
  readonly headerFound: boolean;
}

/** Returns the net brace count of one trimmed line. */
function countBraces(trimmed: string): number {
  const openers = (trimmed.match(/{/g) || []).length;
  const closers = (trimmed.match(/}/g) || []).length;
  return openers - closers;
}

/** True when the line starts a single-line or multi-line import statement. */
function isImportStartLine(line: string): boolean {
  return (/^\s*import\b/.test(line) && !/^\s*import(\.|\s*\(|\s*:)/.test(line)) ||
    /^\s*export\s+\*\s+from\b/.test(line) ||
    /^\s*export\s+{[^}]*}\s+from\b/.test(line) ||
    /^\s*export\s+type\s+{[^}]*}\s+from\b/.test(line);
}

/** True when the line starts a type, interface, enum, or declare block. */
function isTypeStartLine(line: string): boolean {
  return /^\s*((export|declare)\s+)?(type|interface|enum)\b/.test(line) ||
    /^\s*declare\s+(const|let|var|function|class)\b/.test(line);
}

/** Tracks comment and header state. Returns true when the line is comment content. */
function handleCommentLine(trimmed: string, idx: number, state: IScanState): boolean {
  if (state.inMultiLineComment) {
    if (trimmed.includes("*/")) {
      state.inMultiLineComment = false;
      if (state.firstContentLineNum === -1 && idx < 10) state.headerFound = true;
    }
    return true;
  }
  if (trimmed.startsWith("/*")) {
    if (state.firstContentLineNum === -1 && idx < 5) state.headerFound = true;
    if (!trimmed.includes("*/")) state.inMultiLineComment = true;
    return true;
  }
  if (trimmed.startsWith("//")) {
    if (state.firstContentLineNum === -1 && idx < 5) state.headerFound = true;
    return true;
  }
  return false;
}

/** Collects names from an ongoing multi-line import. Returns true when still inside one. */
function handleMultiLineImportContinue(trimmed: string, state: IScanState): boolean {
  if (!state.inMultiLineImport) return false;
  if (trimmed.includes("} from")) state.inMultiLineImport = false;
  return true;
}

/** Tracks a protected brace block. Returns true when the line is inside one. */
function handleProtectedBlock(trimmed: string, state: IScanState): boolean {
  if (state.protectedBraceCount <= 0) return false;
  state.protectedBraceCount += countBraces(trimmed);
  if (state.protectedBraceCount === 0 && state.inTypeDeclaration) state.inTypeDeclaration = false;
  return true;
}

/** Tracks a multi-line type declaration. Returns true when the line is inside one. */
function handleTypeDeclarationContinue(line: string, trimmed: string, state: IScanState): boolean {
  if (!state.inTypeDeclaration) return false;
  state.protectedBraceCount += countBraces(trimmed);
  if (
    state.protectedBraceCount === 0 &&
    (trimmed.endsWith(";") || (trimmed.endsWith("}") && !trimmed.includes("{")) || /^\s*}\s*;?\s*$/.test(line))
  ) {
    state.inTypeDeclaration = false;
  }
  return true;
}

/** Handles comment, shebang, import, brace, and template-literal skip lines. */
function skipLeadingBlock(
  line: string,
  trimmed: string,
  idx: number,
  state: IScanState,
  templateLiteralLines: Set<number>,
): boolean {
  if (!trimmed) return true;
  if (handleCommentLine(trimmed, idx, state)) return true;
  if (trimmed.startsWith("#!")) return true;
  if (state.firstContentLineNum === -1) state.firstContentLineNum = idx + 1;
  if (handleMultiLineImportContinue(trimmed, state)) return true;
  if (handleProtectedBlock(trimmed, state)) return true;
  if (templateLiteralLines.has(idx + 1)) return true;
  return handleTypeDeclarationContinue(line, trimmed, state);
}

/** Runs every import-line check. */
function scanImportLine(
  path: string,
  line: string,
  trimmed: string,
  idx: number,
  lines: string[],
  isImportStart: boolean,
  state: IScanState,
): void {
  if (isImportStart) {
    if (trimmed.includes("{") && !trimmed.includes("} from")) state.inMultiLineImport = true;
  }

  const relativePath = path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path;

  reportEditionLeak(relativePath, line, lines, idx);
  reportPackageBoundary(relativePath, line, idx);
  reportCanonicalImports(relativePath, line, idx);

  if (state.inMultiLineImport && trimmed.includes("} from")) state.inMultiLineImport = false;
}

/** Tracks the start of a type, interface, or enum block so the later checks skip its body. */
function scanTypeStart(trimmed: string, state: IScanState): void {
  state.protectedBraceCount += countBraces(trimmed);
  if (state.protectedBraceCount > 0 || (!trimmed.endsWith(";") && !trimmed.endsWith("}"))) {
    state.inTypeDeclaration = true;
  }
}

/** Pre-scans one source unit, collecting import and interface placement state. */
function scanFileLines(
  path: string,
  lines: string[],
  templateLiteralLines: Set<number>,
): IScanResult {
  const state: IScanState = {
    inMultiLineComment: false,
    inMultiLineImport: false,
    inTypeDeclaration: false,
    protectedBraceCount: 0,
    headerFound: false,
    firstContentLineNum: -1,
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();

    if (skipLeadingBlock(line, trimmed, idx, state, templateLiteralLines)) continue;

    const isImportStart = isImportStartLine(line);
    if (isImportStart || state.inMultiLineImport) {
      scanImportLine(path, line, trimmed, idx, lines, isImportStart, state);
      continue;
    }
    if (isTypeStartLine(line)) {
      scanTypeStart(trimmed, state);
      continue;
    }
  }

  return {
    headerFound: state.headerFound,
  };
}

function checkFileFromText(path: string, text: string, catalog: ICatalog): void {
  const repoPath = path.startsWith(REPO_ROOT + "/") ? path.slice(REPO_ROOT.length + 1) : path;
  const lines = text.split(/\r?\n/);
  // Single parse per file: the layer-leak check and the template-literal line
  // ranges both read from this SourceFile.
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

  // AST-based layer-aware constant import check (supersedes the old regex rule)
  checkLayerLeaks(sourceFile, repoPath);

  const templateLiteralLines = collectTemplateLiteralLines(sourceFile);

  const scan = scanFileLines(path, lines, templateLiteralLines);

  for (let idx = 0; idx < lines.length; idx++) {
    if (templateLiteralLines.has(idx + 1)) {
      continue;
    }

    const line = lines[idx];
    const namedImportMatch = line.match(/^\s*import(?:\s+type)?\s*{([^}]*)}\s*from\s+["']([^"']+)["'];?/);
    if (!namedImportMatch) {
      continue;
    }

    const importClause = namedImportMatch[1];
    const importPath = namedImportMatch[2];
    const normalizedImport = resolveRepoImportPath(repoPath, importPath);
    if (!normalizedImport) {
      continue;
    }

    const shimInfo = rootTestingShimExports.get(normalizedImport);
    if (!shimInfo) {
      continue;
    }

    const importedSymbols = parseNamedSymbols(importClause);
    const offendingSymbols = importedSymbols.filter((symbol) => shimInfo.exportedNames.has(symbol));
    if (offendingSymbols.length === 0) {
      continue;
    }

    console.log(
      `ERROR [package-testing-import] ${repoPath}:${idx + 1} – Import ${
        offendingSymbols.join(", ")
      } from '${shimInfo.alias}' instead of routing package-owned test support through '${importPath}'.`,
    );
    errorCount++;
  }

  checkModuleHeader(path, repoPath, lines, scan.headerFound);

  // Package Module Purity (docs/CODE_STYLE.md#package-module-purity)
  checkPackagePurity(repoPath, lines);

  evaluateStyleRules({
    path,
    repoPath,
    lines,
    catalog,
    templateLiteralLines,
  });
}

export interface IFinding {
  readonly severity: "error" | "warn";
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

const FINDING_LINE = /^(ERROR|WARN) \[([^\]]+)\] (.*):(\d+) – (.*)$/;

/** Runs every style check over one source unit and returns findings, without printing. */
export function checkSource(repoPath: string, text: string, catalog: ICatalog): IFinding[] {
  const captured: string[] = [];
  const originalLog = console.log;
  const savedErrors = errorCount;
  const savedWarnings = warnCount;
  console.log = (...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    checkFileFromText(repoPath, text, catalog);
  } finally {
    console.log = originalLog;
    errorCount = savedErrors;
    warnCount = savedWarnings;
  }
  return captured
    .flatMap((entry) => entry.split("\n"))
    .map((line) => line.match(FINDING_LINE))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      severity: match[1] === "ERROR" ? "error" : "warn",
      rule: match[2],
      file: match[3],
      line: Number(match[4]),
      message: match[5],
    }));
}

/** The tags a rule declares in the catalog (empty when the id is unknown). */
function ruleTags(catalog: ICatalog, ruleName: string): readonly string[] {
  return catalog.rules[ruleName]?.tags ?? [];
}

/** Parses `--tags=` or `--tags <list>`. Exits 2 on an unknown tag. */
function parseTagFilter(catalog: ICatalog): Set<string> | null {
  const equalsArg = Deno.args.find((arg) => arg.startsWith("--tags="));
  let raw: string | undefined = equalsArg?.slice("--tags=".length);
  if (raw === undefined) {
    const index = Deno.args.indexOf("--tags");
    if (index !== -1) raw = Deno.args[index + 1];
  }
  if (raw === undefined) return null;
  const tags = raw.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  const known = new Set(Object.keys(catalog.tagVocabulary));
  for (const tag of tags) {
    if (!known.has(tag)) {
      console.error(`Unknown tag '${tag}'. Known tags: ${[...known].sort().join(", ")}.`);
      Deno.exit(2);
    }
  }
  return new Set(tags);
}

/** True when a captured finding line's rule carries at least one selected tag. */
function findingMatchesTags(catalog: ICatalog, line: string, tags: Set<string>): boolean {
  const match = line.match(FINDING_LINE);
  if (!match) return false;
  return ruleTags(catalog, match[2]).some((tag) => tags.has(tag));
}

/** Prints the tag-filtered findings and per-tag counts. Exits 1 on any error. */
function emitTaggedFindings(buffered: string[], tags: Set<string>): void {
  errorCount = 0;
  warnCount = 0;
  const perTag = new Map<string, { errors: number; warnings: number }>();
  for (const tag of tags) perTag.set(tag, { errors: 0, warnings: 0 });

  for (const line of buffered) {
    if (!findingMatchesTags(CATALOG, line, tags)) continue;
    console.log(line);
    const match = line.match(FINDING_LINE);
    const isError = match?.[1] === "ERROR";
    if (isError) errorCount++;
    else warnCount++;
    for (const tag of ruleTags(CATALOG, match?.[2] ?? "")) {
      if (!tags.has(tag)) continue;
      const counts = perTag.get(tag)!;
      if (isError) counts.errors++;
      else counts.warnings++;
    }
  }

  const summary = [...tags].sort().map((tag) => {
    const counts = perTag.get(tag)!;
    return `${tag}: ${counts.errors} error(s), ${counts.warnings} warning(s)`;
  }).join("; ");
  console.log(
    `\nstyle check completed (tags: ${[...tags].sort().join(",")}): ${errorCount} error(s), ${warnCount} warning(s)`,
  );
  console.log(`per-tag: ${summary}`);
  if (errorCount > 0) Deno.exit(1);
}

const WALK_EXTENSIONS = [".ts", ".tsx"];

/** Walks the requested paths and runs every enabled rule over each file. */
async function runAllChecks(manualPaths: string[]): Promise<void> {
  if (manualPaths.length > 0) {
    for (const p of manualPaths) {
      const fullPath = p.startsWith("/") ? p : join(Deno.cwd(), p);
      try {
        const stat = await Deno.stat(fullPath);
        if (stat.isFile) {
          await checkFile(fullPath);
        } else {
          for await (
            const entry of walk(fullPath, {
              includeDirs: false,
              exts: WALK_EXTENSIONS,
              followSymlinks: false,
              skip: IGNORE_GLOBS,
            })
          ) {
            await checkFile(entry.path);
          }
        }
      } catch (e) {
        console.error(`Error checking path ${p}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return;
  }

  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: WALK_EXTENSIONS,
      followSymlinks: false,
      skip: IGNORE_GLOBS,
    })
  ) {
    if (!entry.isFile) {
      continue;
    }
    await checkFile(entry.path);
  }
}

async function main() {
  // Request read permission for the repo root if not already granted
  await Deno.permissions.request({ name: "read", path: REPO_ROOT });

  const tagIndex = Deno.args.indexOf("--tags");
  const tagValueIndex = tagIndex !== -1 ? tagIndex + 1 : -1;
  const manualPaths = Deno.args.filter((arg, i) => !arg.startsWith("-") && i !== tagValueIndex);

  const tagFilter = parseTagFilter(CATALOG);
  if (tagFilter) {
    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      captured.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      await runAllChecks(manualPaths);
    } finally {
      console.log = originalLog;
    }
    emitTaggedFindings(captured, tagFilter);
    return;
  }

  await runAllChecks(manualPaths);
  // The duplicate-type pass needs the whole tree, so it runs only on the unscoped run.
  if (manualPaths.length === 0) runDuplicateTypePass();

  console.log(`\nstyle check completed: ${errorCount} error(s), ${warnCount} warning(s)`);
  if (errorCount > 0) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
