#!/usr/bin/env -S deno run -A
/**
 * @module PackageImportMigration
 * @path scripts/package_import_migration.ts
 * @description Package import migration helper for moving named exports from one package to another.
 *
 * Usage:
 *   deno run --allow-read scripts/package_import_migration.ts [--edit] \
 *     <old-package> <new-package>
 *
 * Example:
 *   deno run --allow-read scripts/package_import_migration.ts \
 *     @exaix/core @exaix/tui
 *
 * With edits:
 *   deno run --allow-read scripts/package_import_migration.ts --edit \
 *     @exaix/core @exaix/tui
 */

import { walk } from "@std/fs";
import { dirname, extname, join } from "@std/path";

const REPO_ROOT = Deno.cwd();
const EDIT_MODE = Deno.args.includes("--edit");
const filteredArgs = Deno.args.filter((arg) => arg !== "--edit");
const OLD_PACKAGE = filteredArgs[0];
const NEW_PACKAGE = filteredArgs[1];
const DENO_CONFIG_PATH = join(REPO_ROOT, "deno.json");

interface JsonImportMap {
  imports?: ImportMap;
}

interface ImportMap {
  [key: string]: string;
}

interface ImportSpecifier {
  importedName: string;
  text: string;
}

async function readImportMap(): Promise<ImportMap> {
  try {
    const content = await Deno.readTextFile(DENO_CONFIG_PATH);
    const config = JSON.parse(content) as JsonImportMap;
    return (config.imports as ImportMap) ?? {};
  } catch {
    return {};
  }
}

function parseImportSpecifiers(importClause: string): ImportSpecifier[] {
  const match = importClause.match(/\{([\s\S]*)\}/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .map((specifier) => {
      const importedName = specifier.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      return { importedName, text: specifier };
    });
}

function parseExportNames(exportClause: string): string[] {
  return exportClause
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .map((specifier) => {
      const aliasMatch = specifier.match(/\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (aliasMatch) {
        return aliasMatch[1];
      }
      return specifier.replace(/^type\s+/, "").trim();
    });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isFile || stat.isDirectory;
  } catch {
    return false;
  }
}

async function tryResolveFile(path: string): Promise<string | null> {
  if (await fileExists(path)) {
    const stat = await Deno.lstat(path);
    if (stat.isFile) return path;
    if (stat.isDirectory) {
      const candidates = ["mod.ts", "mod.tsx", "index.ts", "index.tsx"];
      for (const candidate of candidates) {
        const candidatePath = join(path, candidate);
        if (await fileExists(candidatePath)) return candidatePath;
      }
    }
  }

  const candidates = [".ts", ".tsx", ".js", ".jsx"].map((ext) => `${path}${ext}`);
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  return null;
}

function mapImportSource(importSource: string, imports: ImportMap): string | null {
  if (imports[importSource]) {
    return imports[importSource];
  }

  const prefixCandidates = Object.keys(imports)
    .filter((key) => key.endsWith("/") && importSource.startsWith(key))
    .sort((a, b) => b.length - a.length);

  if (prefixCandidates.length > 0) {
    const prefix = prefixCandidates[0];
    return `${imports[prefix]}${importSource.slice(prefix.length)}`;
  }

  return null;
}

function toFsPath(resolvedPath: string): string {
  if (resolvedPath.startsWith("file://")) {
    return new URL(resolvedPath).pathname;
  }
  if (resolvedPath.startsWith("./") || resolvedPath.startsWith("../")) {
    return join(REPO_ROOT, resolvedPath);
  }
  if (resolvedPath.startsWith("/")) {
    return resolvedPath;
  }
  return join(REPO_ROOT, resolvedPath);
}

async function resolveModuleFile(importSource: string, imports: ImportMap): Promise<string | null> {
  const mappedPath = mapImportSource(importSource, imports) ?? importSource;
  const fsPath = toFsPath(mappedPath);
  return await tryResolveFile(fsPath);
}

async function resolveReexportSource(source: string, moduleDir: string, imports: ImportMap): Promise<string | null> {
  if (source.startsWith("./") || source.startsWith("../")) {
    return await tryResolveFile(join(moduleDir, source));
  }

  return await resolveModuleFile(source, imports);
}

async function collectExports(filePath: string, imports: ImportMap, visited: Set<string>): Promise<Set<string>> {
  if (visited.has(filePath)) {
    return new Set();
  }
  visited.add(filePath);

  const text = await Deno.readTextFile(filePath);
  const exports = new Set<string>();
  const moduleDir = dirname(filePath);

  const declarationRegex =
    /export\s+(?:type\s+)?(?:interface|type|enum|class|function|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  for (const match of text.matchAll(declarationRegex)) {
    exports.add(match[1]);
  }

  const exportListRegex = /export\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s*["']([^"']+)["'])?/g;
  for (const match of text.matchAll(exportListRegex)) {
    const names = parseExportNames(match[1]);
    for (const name of names) {
      exports.add(name);
    }

    const reexportSource = match[2];
    if (reexportSource) {
      const reexportPath = await resolveReexportSource(reexportSource, moduleDir, imports);
      if (reexportPath) {
        const reexports = await collectExports(reexportPath, imports, visited);
        for (const name of reexports) {
          exports.add(name);
        }
      }
    }
  }

  const exportStarRegex = /export\s*\*\s*from\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(exportStarRegex)) {
    const reexportSource = match[1];
    const reexportPath = await resolveReexportSource(reexportSource, moduleDir, imports);
    if (reexportPath) {
      const reexports = await collectExports(reexportPath, imports, visited);
      for (const name of reexports) {
        exports.add(name);
      }
    }
  }

  return exports;
}

async function getExportsForSource(
  importSource: string,
  imports: ImportMap,
  cache: Map<string, Set<string>>,
): Promise<Set<string>> {
  const resolvedPath = await resolveModuleFile(importSource, imports);
  if (!resolvedPath) {
    return new Set();
  }

  if (cache.has(resolvedPath)) {
    return cache.get(resolvedPath)!;
  }

  const exportSet = await collectExports(resolvedPath, imports, new Set());
  cache.set(resolvedPath, exportSet);
  return exportSet;
}

async function main() {
  if (!OLD_PACKAGE || !NEW_PACKAGE) {
    console.error(
      "Usage: deno run --allow-read scripts/package_import_migration.ts [--edit] <old-package> <new-package>",
    );
    Deno.exit(1);
  }

  const imports = await readImportMap();
  console.log(`Scanning for migrated imports from ${OLD_PACKAGE}...`);
  let found = 0;
  const packagePrefix = `${OLD_PACKAGE}/`;
  const exportCache = new Map<string, Set<string>>();

  for await (const entry of walk(REPO_ROOT, { includeDirs: false })) {
    if (![".ts", ".tsx"].includes(extname(entry.path))) continue;
    if (entry.path.includes("/deno_cache/")) continue;

    const text = await Deno.readTextFile(entry.path);
    const importKeyword = "import";
    const importTypePattern = `${importKeyword}(?:\\s+type)?`;
    const importRegex = new RegExp(
      `^([ \\t]*)(${importTypePattern})\\s+(\\{[\\s\\S]*?\\})\\s+from\\s+[\"']([^\"']+)[\"'];?\\s*`,
      "gm",
    );
    let cursor = 0;
    let changed = false;
    let output = "";

    while (true) {
      const match = importRegex.exec(text);
      if (!match) break;

      const [importStatement, indent, importToken, importClause, importSource] = match;
      output += text.slice(cursor, match.index);
      cursor = match.index + importStatement.length;

      if (importSource !== OLD_PACKAGE && !importSource.startsWith(packagePrefix)) {
        output += importStatement;
        continue;
      }

      const newPackageSource = importSource === OLD_PACKAGE
        ? NEW_PACKAGE
        : `${NEW_PACKAGE}${importSource.slice(OLD_PACKAGE.length)}`;

      const importedSpecifiers = parseImportSpecifiers(importClause);
      if (importedSpecifiers.length === 0) {
        output += importStatement;
        continue;
      }

      const oldExports = await getExportsForSource(importSource, imports, exportCache);
      const newExports = await getExportsForSource(newPackageSource, imports, exportCache);
      if (newExports.size === 0) {
        output += importStatement;
        continue;
      }

      const migratedSpecifiers = importedSpecifiers.filter((specifier) => newExports.has(specifier.importedName));
      const oldOnlySpecifiers = importedSpecifiers.filter((specifier) => !newExports.has(specifier.importedName));
      if (migratedSpecifiers.length === 0) {
        output += importStatement;
        continue;
      }

      found += 1;
      const lineNumber = text.slice(0, match.index).split(/\r?\n/).length;
      console.log(`\n${entry.path}:${lineNumber}`);
      console.log(`  ${importStatement.trim()}`);
      console.log(`  Migrated symbols: ${migratedSpecifiers.map((specifier) => specifier.importedName).join(", ")}`);

      const sharedSpecifiers = migratedSpecifiers.filter((specifier) => oldExports.has(specifier.importedName));
      if (sharedSpecifiers.length > 0) {
        console.log(
          `  Also exported by old source: ${sharedSpecifiers.map((specifier) => specifier.importedName).join(", ")}`,
        );
      }

      if (oldOnlySpecifiers.length > 0) {
        const keepLine = `${indent}${importToken} { ${
          oldOnlySpecifiers.map((specifier) => specifier.text).join(", ")
        } } from "${importSource}";\n`;
        const migrateLine = `${indent}${importToken} { ${
          migratedSpecifiers.map((specifier) => specifier.text).join(", ")
        } } from "${newPackageSource}";\n`;
        output += keepLine;
        output += migrateLine;
        console.log("  Suggested replacement:");
        console.log(`    ${keepLine.trimEnd()}`);
        console.log(`    ${migrateLine.trimEnd()}`);
      } else {
        const migrateLine = `${indent}${importToken} { ${
          migratedSpecifiers.map((specifier) => specifier.text).join(", ")
        } } from "${newPackageSource}";\n`;
        output += migrateLine;
        console.log(`  Suggested replacement: ${migrateLine.trimEnd()}`);
      }

      changed = true;
    }

    output += text.slice(cursor);
    if (EDIT_MODE && changed) {
      await Deno.writeTextFile(entry.path, output);
      console.log(`  Edited file: ${entry.path}`);
    }
  }

  if (found === 0) {
    console.log(`No migrated imports were found from ${OLD_PACKAGE}.`);
  } else {
    console.log(`\nFound ${found} import line(s) that likely need migration.`);
  }
}

if (import.meta.main) {
  await main();
}
