#!/usr/bin/env -S deno run -A
/**
 * @module CheckUnusedExports
 * @path scripts/check_unused_exports.ts
 * @description AST-based check that finds exported declarations never imported
 * by other production files. Usage:
 *   deno run -A scripts/check_unused_exports.ts [--strict]
 *
 *   --strict  Reports only exports NOT re-exported through any barrel AND not
 *             imported — strong dead-code signal (CI grade).
 *   default   Reports all exports with zero production imports (for review).
 */

import ts from "typescript";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, normalize } from "@std/path";

const REPO_ROOT = normalize(join(dirname(fromFileUrl(import.meta.url)), ".."));
const STRICT_MODE = Deno.args.includes("--strict");

// ── File filtering ─────────────────────────────────────────────────────────

function isTestFilePath(repoPath: string): boolean {
  return repoPath.includes("/tests/") ||
    repoPath.endsWith("_test.ts") ||
    repoPath.endsWith(".test.ts") ||
    repoPath.includes("/testing/");
}

function isProductionRoot(repoPath: string): boolean {
  return repoPath.startsWith("packages/") ||
    repoPath.startsWith("packages-team/") ||
    repoPath.startsWith("apps/");
}

function isPackageEntrypoint(repoPath: string): boolean {
  return repoPath.endsWith("/mod.ts") || repoPath.endsWith("/index.ts");
}

function isEntryPoint(repoPath: string): boolean {
  return repoPath.endsWith("/main.ts");
}

// ── AST helpers ────────────────────────────────────────────────────────────

function hasExportModifier(node: ts.Node): boolean {
  if (!("modifiers" in node)) return false;
  const mods = (node as { modifiers?: ts.Modifier[] }).modifiers;
  return mods ? mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) : false;
}

function getExportName(node: ts.Node): string | null {
  if (ts.isClassDeclaration(node) && node.name) return node.name.text;
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) return decl.name.text;
    }
    return null;
  }
  if (ts.isInterfaceDeclaration(node) && node.name) return node.name.text;
  if (ts.isTypeAliasDeclaration(node) && node.name) return node.name.text;
  if (ts.isEnumDeclaration(node) && node.name) return node.name.text;
  return null;
}

function isIfaceOrType(node: ts.Node): boolean {
  return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
}

function isNamedReExport(node: ts.Node): node is ts.ExportDeclaration & {
  moduleSpecifier: ts.StringLiteral;
  exportClause: ts.NamedExports;
} {
  return ts.isExportDeclaration(node) &&
    !!node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) &&
    !!node.exportClause && ts.isNamedExports(node.exportClause);
}

function isWildcardReExport(node: ts.Node): node is ts.ExportDeclaration & {
  moduleSpecifier: ts.StringLiteral;
} {
  return ts.isExportDeclaration(node) &&
    !!node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) &&
    !node.exportClause;
}

function hasPublicJSDoc(text: string): boolean {
  return /@public\b/.test(text);
}

// ── Name pattern helpers (relaxed mode only) ───────────────────────────────

function isProviderMetadata(name: string): boolean {
  return /^PROVIDER_[A-Z]+_(DESCRIPTION|CAPABILITIES|STRENGTHS|COST_TIER)$/.test(name);
}

function isTestHelper(name: string): boolean {
  return /(Mock|Stub|TestHelper|TestHarness|TestContext)$/.test(name) ||
    /^mock[A-Z]/.test(name) ||
    /^create.*(Mock|Stub|Test)$/.test(name);
}

function isEntryPointName(name: string): boolean {
  return /^(run|start|launch|main)[A-Z]/.test(name);
}

function isTestExport(name: string): boolean {
  return name.startsWith("__test_");
}

// ── Resolve relative import paths ──────────────────────────────────────────

function resolveImport(importerRepoPath: string, importPath: string): string | null {
  if (importPath.startsWith(".")) {
    return normalize(join(dirname(importerRepoPath), importPath));
  }
  return null;
}

// ── Data structures ────────────────────────────────────────────────────────

interface IExportSite {
  repoPath: string;
  line: number;
  isBarrelPassThrough: boolean;
  isTypeDecl: boolean;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const sourceCache = new Map<string, { text: string; sourceFile: ts.SourceFile | null }>();
  const exportMap = new Map<string, IExportSite[]>();
  const importMap = new Map<string, Set<string>>();
  const allProdFiles: string[] = [];

  // Step 1: collect all production .ts files
  for await (
    const entry of walk(REPO_ROOT, {
      includeDirs: false,
      exts: [".ts"],
      followSymlinks: false,
      skip: [
        /\.git/,
        /node_modules/,
        /\.copilot/,
        /\.exa/,
        /Blueprints/,
        /Memory/,
        /Workspace/,
        /Portals/,
        /coverage/,
        /exaix-dev-docs/,
        /exaix-enterprise/,
        /tests\/scenario_framework/,
      ],
    })
  ) {
    const repoPath = entry.path.startsWith(REPO_ROOT + "/") ? entry.path.slice(REPO_ROOT.length + 1) : entry.path;
    if (isTestFilePath(repoPath)) continue;
    if (!isProductionRoot(repoPath)) continue;
    allProdFiles.push(repoPath);
    sourceCache.set(repoPath, { text: await Deno.readTextFile(entry.path), sourceFile: null });
  }

  // Step 2: parse all files — collect imports + exports
  for (const repoPath of allProdFiles) {
    const cached = sourceCache.get(repoPath)!;
    const sourceFile = ts.createSourceFile(repoPath, cached.text, ts.ScriptTarget.Latest, true);
    cached.sourceFile = sourceFile;

    // ── imports ──
    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isImportDeclaration(node) || !node.importClause) return;
      const clause = node.importClause;

      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          if (el.isTypeOnly) continue;
          const name = el.name.text;
          if (!importMap.has(name)) importMap.set(name, new Set());
          importMap.get(name)!.add(repoPath);
        }
      }
      if (clause.name) {
        const name = clause.name.text;
        if (!importMap.has(name)) importMap.set(name, new Set());
        importMap.get(name)!.add(repoPath);
      }
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        const name = clause.namedBindings.name.text;
        if (!importMap.has(name)) importMap.set(name, new Set());
        importMap.get(name)!.add(repoPath);
      }
    });

    // ── exports ──
    ts.forEachChild(sourceFile, (node) => {
      if (isNamedReExport(node)) {
        for (const el of node.exportClause.elements) {
          const name = el.name.text;
          const line = sourceFile.getLineAndCharacterOfPosition(el.getStart()).line + 1;
          if (!exportMap.has(name)) exportMap.set(name, []);
          exportMap.get(name)!.push({
            repoPath,
            line,
            isBarrelPassThrough: isPackageEntrypoint(repoPath),
            isTypeDecl: false,
          });
        }
        return;
      }
      if (ts.isExportAssignment(node)) return;
      if (hasExportModifier(node)) {
        const name = getExportName(node);
        if (!name) return;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        if (!exportMap.has(name)) exportMap.set(name, []);
        exportMap.get(name)!.push({
          repoPath,
          line,
          isBarrelPassThrough: false,
          isTypeDecl: isIfaceOrType(node),
        });
      }
    });
  }

  // Step 3: handle export * from "..."
  for (const repoPath of allProdFiles) {
    if (!isPackageEntrypoint(repoPath)) continue;
    const cached = sourceCache.get(repoPath)!;
    const sourceFile = cached.sourceFile!;

    ts.forEachChild(sourceFile, (node) => {
      if (!isWildcardReExport(node)) return;
      const targetRaw = node.moduleSpecifier.text;
      const targetPath = resolveImport(repoPath, targetRaw);
      if (!targetPath) return;

      const targetKey = targetPath.replace(/\.ts$/, "");
      let targetSource: ts.SourceFile | null = null;
      for (const [key, cached] of sourceCache) {
        if (key.replace(/\.ts$/, "") === targetKey) {
          targetSource = cached.sourceFile;
          break;
        }
      }
      if (!targetSource) return;

      ts.forEachChild(targetSource, (child) => {
        function addBarrelEntry(name: string, isType: boolean) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          if (!exportMap.has(name)) exportMap.set(name, []);
          const existing = exportMap.get(name)!;
          if (!existing.some((s) => s.repoPath === repoPath && s.isBarrelPassThrough)) {
            existing.push({ repoPath, line, isBarrelPassThrough: true, isTypeDecl: isType });
          }
        }

        if (hasExportModifier(child)) {
          const name = getExportName(child);
          if (name) addBarrelEntry(name, isIfaceOrType(child));
        }
        if (isNamedReExport(child)) {
          for (const el of child.exportClause.elements) {
            addBarrelEntry(el.name.text, false);
          }
        }
      });
    });
  }

  // Step 4: identify @public files
  const publicFiles = new Set<string>();
  for (const repoPath of allProdFiles) {
    const cached = sourceCache.get(repoPath)!;
    if (hasPublicJSDoc(cached.text)) publicFiles.add(repoPath);
  }

  // Step 5: report unwired exports
  let errorCount = 0;

  for (const [name, sites] of exportMap) {
    if (importMap.has(name)) continue;

    const nonTypeSites = sites.filter((s) => !s.isTypeDecl);
    if (nonTypeSites.length === 0) continue;

    for (const site of nonTypeSites) {
      if (site.isBarrelPassThrough) continue;
      if (name.startsWith("I") && name.length > 1 && name[1] === name[1]?.toUpperCase()) continue;
      if (publicFiles.has(site.repoPath)) continue;
      if (isEntryPoint(site.repoPath)) continue;

      if (STRICT_MODE) {
        // Strict: only flag if NOT re-exported through any barrel
        // A barrel pass-through site exists for this name → it's intentional public API
        const hasBarrel = sites.some((s) => s.isBarrelPassThrough);
        if (hasBarrel) continue;

        // Skip known registry-wired directories
        if (site.repoPath.startsWith("packages/tui/") || site.repoPath.startsWith("apps/tui/")) continue;
        if (site.repoPath.startsWith("packages-team/")) continue;
        if (site.repoPath.startsWith("packages/schemas/")) continue;
        // apps/daemon/src/ and apps/common/ — dynamically imported by edition composer
        if (site.repoPath.startsWith("apps/daemon/src/") || site.repoPath.startsWith("apps/common/")) continue;
        // CLI commands — registered by string name, used interactively, not imported
        if (site.repoPath.includes("/commands/") || site.repoPath.includes("/handlers/")) continue;
        if (isPackageEntrypoint(site.repoPath)) continue;
        if (isProviderMetadata(name)) continue;
        if (isTestHelper(name)) continue;
        if (isEntryPointName(name)) continue;
        if (isTestExport(name)) continue;

        console.log(
          `ERROR [unwired-export] ${site.repoPath}:${site.line} – ` +
            `'${name}' is exported, NOT re-exported through any barrel, and never imported. ` +
            `This is likely dead code or was never wired. Remove it or wire it.`,
        );
        errorCount++;
      } else {
        // Relaxed: report everything
        console.log(
          `WARN [unwired-export] ${site.repoPath}:${site.line} – ` +
            `'${name}' is exported but never imported by production code.`,
        );
        errorCount++;
      }
    }
  }

  if (errorCount === 0) {
    console.log("✅ No unwired exports found.");
    return;
  }

  if (STRICT_MODE) {
    console.log(`\n❌ ${errorCount} strictly unwired export(s) — likely dead code. Fix before commit.`);
    Deno.exit(1);
  } else {
    console.log(`\n⚠️  ${errorCount} unwired export(s) found (relaxed mode).`);
    console.log("  Run with --strict for CI-grade dead-code detection.");
    const byDir = new Map<string, number>();
    for (const [name, sites] of exportMap) {
      if (importMap.has(name)) continue;
      for (const site of sites) {
        if (site.isBarrelPassThrough || site.isTypeDecl) continue;
        if (name.startsWith("I") && name.length > 1 && name[1] === name[1]?.toUpperCase()) continue;
        const dir = site.repoPath.split("/").slice(0, 2).join("/");
        byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
      }
    }
    console.log("\nTop directories:");
    for (const [dir, count] of [...byDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${dir}: ${count}`);
    }
  }
}

if (import.meta.main) {
  main();
}
