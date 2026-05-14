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
import { dirname, extname, join, relative } from "@std/path";

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

export interface IGetBestImportSourceForSymbolOptions {
  importSource: string;
  moduleDir: string;
  imports: ImportMap;
  oldPackage: string;
  newPackage: string;
  symbol: string;
  cache: Map<string, Set<string>>;
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
    const target = imports[prefix];
    const separator = target.endsWith("/") ? "" : "/";
    return `${target}${separator}${importSource.slice(prefix.length)}`;
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

function normalizePathForImport(path: string): string {
  return path.replace(/\\/g, "/");
}

function stripIndexOrModImport(importSource: string): string {
  return importSource.replace(/(?:\/mod|\/index)\.(ts|tsx|js|jsx)$/, "");
}

function isDirectoryIndexFile(path: string): boolean {
  return /(?:^|\/)mod\.(ts|tsx)$/.test(path) || /(?:^|\/)index\.(ts|tsx)$/.test(path);
}

function findAliasImportForFsPath(fsPath: string, imports: ImportMap): string | null {
  const normalizedFsPath = normalizePathForImport(fsPath);
  const aliasCandidates = Object.entries(imports)
    .map(([key, value]) => ({ key, value: normalizePathForImport(toFsPath(value)) }))
    .sort((a, b) => b.value.length - a.value.length);

  for (const { key, value } of aliasCandidates) {
    if (normalizedFsPath === value) {
      return stripIndexOrModImport(key);
    }

    if (!key.endsWith("/")) {
      continue;
    }

    const normalizedValue = value.endsWith("/") ? value : `${value}/`;
    if (normalizedFsPath.startsWith(normalizedValue)) {
      const relativePath = normalizePathForImport(normalizedFsPath.slice(normalizedValue.length));
      return `${key}${relativePath}`;
    }
  }

  return null;
}

async function getBestExportFileForSymbol(
  symbol: string,
  rootPath: string,
  imports: ImportMap,
  cache: Map<string, Set<string>>,
): Promise<string | null> {
  let fallback: string | null = null;

  for await (const entry of walk(rootPath, { includeDirs: false })) {
    if (![".ts", ".tsx"].includes(extname(entry.path))) continue;
    if (entry.path.includes("/deno_cache/")) continue;

    const text = await Deno.readTextFile(entry.path);
    const declarationRegex =
      /export\s+(?:type\s+)?(?:interface|type|enum|class|function|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
    for (const match of text.matchAll(declarationRegex)) {
      if (match[1] === symbol) {
        return entry.path;
      }
    }

    const exportListRegex = /export\s*(?:type\s*)?\{([^}]*)\}/g;
    for (const match of text.matchAll(exportListRegex)) {
      const names = parseExportNames(match[1]);
      if (names.includes(symbol)) {
        const localExportRegex = new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`);
        if (localExportRegex.test(match[0])) {
          return entry.path;
        }
      }
    }

    const exports = await getExportsForSource(entry.path, imports, cache);
    if (exports.has(symbol)) {
      fallback = fallback ?? entry.path;
    }
  }

  return fallback;
}

function filePathToImportSource(fsPath: string, moduleDir: string, imports: ImportMap): string {
  const aliasImport = findAliasImportForFsPath(fsPath, imports);
  if (aliasImport) {
    return stripIndexOrModImport(aliasImport);
  }

  let relativePath = normalizePathForImport(relative(moduleDir, fsPath));
  if (!relativePath.startsWith(".") && !relativePath.startsWith("/")) {
    relativePath = `./${relativePath}`;
  }
  return stripIndexOrModImport(relativePath);
}

export function mergeDuplicateImportStatements(fileText: string): string {
  const importKeyword = "import";
  const importTypePattern = `${importKeyword}(?:\\s+type)?`;
  const importLineRegex = new RegExp(
    `^([ \\t]*)(${importTypePattern})\\s+\\{([^}]*)\\}\\s+from\\s+["']([^"']+)["'];?$`,
  );
  const lines = fileText.split(/\r?\n/);
  const seen = new Map<string, { indent: string; importToken: string; specifiers: Set<string>; firstIndex: number }>();
  const toRemove = new Set<number>();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = importLineRegex.exec(line);
    if (!match) continue;

    const [, indent, importToken, clause, fromSource] = match;
    const key = `${importToken}|${fromSource}`;
    const specifiers = clause.split(",").map((specifier) => specifier.trim()).filter(Boolean);

    if (!seen.has(key)) {
      seen.set(key, {
        indent,
        importToken,
        specifiers: new Set(specifiers),
        firstIndex: index,
      });
      continue;
    }

    const entry = seen.get(key)!;
    for (const specifier of specifiers) {
      entry.specifiers.add(specifier);
    }
    toRemove.add(index);
  }

  if (toRemove.size === 0) {
    return fileText;
  }

  for (const [key, entry] of seen.entries()) {
    const { indent, importToken, specifiers, firstIndex } = entry;
    const mergedLine = `${indent}${importToken} { ${[...specifiers].join(", ")} } from "${key.split("|")[1]}";`;
    lines[firstIndex] = mergedLine;
  }

  const filteredLines = lines.filter((_, index) => !toRemove.has(index));
  return filteredLines.join("\n");
}

function isFilesystemRoot(packageName: string): boolean {
  if (packageName.startsWith("./") || packageName.startsWith("../") || packageName.startsWith("/")) {
    return true;
  }
  if (packageName.startsWith("@")) {
    return false;
  }
  return packageName === "src" || packageName === "packages" || packageName.includes("/");
}

async function resolvePackageRoot(packageName: string, imports: ImportMap): Promise<string | null> {
  const pathLike = isFilesystemRoot(packageName);

  if (pathLike) {
    const candidate = toFsPath(packageName);
    if (await fileExists(candidate)) {
      const stat = await Deno.lstat(candidate);
      return stat.isDirectory ? candidate : dirname(candidate);
    }
  }

  const resolved = await resolveModuleFile(packageName, imports);
  if (resolved) {
    const stat = await Deno.lstat(resolved);
    return stat.isDirectory ? resolved : dirname(resolved);
  }

  return null;
}

export async function resolveImportFile(
  importSource: string,
  moduleDir: string,
  imports: ImportMap,
): Promise<string | null> {
  if (importSource.startsWith("./") || importSource.startsWith("../") || importSource.startsWith("/")) {
    return await tryResolveFile(join(moduleDir, importSource));
  }

  const mappedPath = mapImportSource(importSource, imports) ?? importSource;
  const fsPath = toFsPath(mappedPath);
  return await tryResolveFile(fsPath);
}

export async function getNewImportSource(
  importSource: string,
  moduleDir: string,
  imports: ImportMap,
  oldPackage: string,
  newPackage: string,
): Promise<string | null> {
  if (importSource === oldPackage || importSource.startsWith(`${oldPackage}/`)) {
    return importSource === oldPackage ? newPackage : `${newPackage}${importSource.slice(oldPackage.length)}`;
  }

  const oldRoot = await resolvePackageRoot(oldPackage, imports);
  const newRoot = await resolvePackageRoot(newPackage, imports);
  if (!oldRoot || !newRoot) {
    return null;
  }

  let importFsPath = await resolveImportFile(importSource, moduleDir, imports);
  if (
    !importFsPath && (importSource.startsWith("./") || importSource.startsWith("../") || importSource.startsWith("/"))
  ) {
    importFsPath = normalizePathForImport(join(moduleDir, importSource));
  }
  if (!importFsPath) {
    return null;
  }

  const relativeSubpath = normalizePathForImport(relative(oldRoot, importFsPath));
  if (!relativeSubpath.startsWith("..") && relativeSubpath !== "") {
    const candidateFsPath = await resolveMappedDestinationFile(newRoot, relativeSubpath);
    if (candidateFsPath) {
      return filePathToImportSource(candidateFsPath, moduleDir, imports);
    }
  }

  return null;
}

async function resolveMappedDestinationFile(newRoot: string, relativeSubpath: string): Promise<string | null> {
  const directCandidate = await tryResolveFile(join(newRoot, relativeSubpath));
  if (directCandidate) {
    return directCandidate;
  }

  return await tryResolveFile(join(newRoot, "src", relativeSubpath));
}

export async function getBestImportSourceForSymbol(
  options: IGetBestImportSourceForSymbolOptions,
): Promise<string | null> {
  const { importSource, moduleDir, imports, oldPackage, newPackage, symbol, cache } = options;
  const candidateSource = await getNewImportSource(importSource, moduleDir, imports, oldPackage, newPackage);
  if (!candidateSource) {
    return null;
  }

  const newRoot = await resolvePackageRoot(newPackage, imports);
  if (newRoot) {
    const barrelSource = await getBarrelImportSource(newRoot, moduleDir, imports);
    if (barrelSource) {
      const barrelExports = await getExportsForSource(barrelSource, imports, cache);
      if (barrelExports.has(symbol)) {
        return barrelSource;
      }
    }
  }

  const resolvedCandidate = await resolveImportFile(candidateSource, moduleDir, imports);
  if (!resolvedCandidate) {
    return null;
  }

  const candidateDir = isDirectoryIndexFile(resolvedCandidate) ? dirname(resolvedCandidate) : null;
  if (candidateDir) {
    const bestFile = await getBestExportFileForSymbol(symbol, candidateDir, imports, cache);
    if (bestFile) {
      return filePathToImportSource(bestFile, moduleDir, imports);
    }
  }

  const exports = await getExportsForSource(candidateSource, imports, cache);
  if (exports.has(symbol)) {
    return candidateSource;
  }

  if (newRoot) {
    const bestFile = await getBestExportFileForSymbol(symbol, newRoot, imports, cache);
    if (bestFile) {
      return filePathToImportSource(bestFile, moduleDir, imports);
    }
  }

  return null;
}

async function getBarrelImportSource(rootPath: string, moduleDir: string, imports: ImportMap): Promise<string | null> {
  for (const candidate of ["mod.ts", "mod.tsx", "index.ts", "index.tsx"]) {
    const candidatePath = join(rootPath, candidate);
    if (await fileExists(candidatePath)) {
      return filePathToImportSource(candidatePath, moduleDir, imports);
    }
  }
  return null;
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
    const fileChangeGroups = new Map<string, {
      indent: string;
      importToken: string;
      targetSource: string;
      specifiers: Set<string>;
      importedNames: Set<string>;
    }>();

    while (true) {
      const match = importRegex.exec(text);
      if (!match) break;

      const [importStatement, indent, importToken, importClause, importSource] = match;
      output += text.slice(cursor, match.index);
      cursor = match.index + importStatement.length;

      const importedSpecifiers = parseImportSpecifiers(importClause);
      if (importedSpecifiers.length === 0) {
        output += importStatement;
        continue;
      }

      const importGroups = new Map<string, ImportSpecifier[]>();
      const keepSpecifiers: ImportSpecifier[] = [];

      for (const specifier of importedSpecifiers) {
        const bestSource = await getBestImportSourceForSymbol({
          importSource,
          moduleDir: dirname(entry.path),
          imports,
          oldPackage: OLD_PACKAGE,
          newPackage: NEW_PACKAGE,
          symbol: specifier.importedName,
          cache: exportCache,
        });

        if (bestSource && bestSource !== importSource) {
          const group = importGroups.get(bestSource) ?? [];
          group.push(specifier);
          importGroups.set(bestSource, group);
        } else {
          keepSpecifiers.push(specifier);
        }
      }

      if (importGroups.size === 0) {
        output += importStatement;
        continue;
      }

      found += 1;
      changed = true;

      for (const [targetSource, specifiers] of importGroups) {
        const key = `${importToken}|${targetSource}`;
        const changeEntry = fileChangeGroups.get(key) ?? {
          indent,
          importToken,
          targetSource,
          specifiers: new Set<string>(),
          importedNames: new Set<string>(),
        };

        for (const specifier of specifiers) {
          changeEntry.specifiers.add(specifier.text);
          changeEntry.importedNames.add(specifier.importedName);
        }

        fileChangeGroups.set(key, changeEntry);
      }

      if (keepSpecifiers.length > 0) {
        output += `${indent}${importToken} { ${
          keepSpecifiers.map((specifier) => specifier.text).join(", ")
        } } from "${importSource}";\n`;
      }

      for (const [targetSource, specifiers] of importGroups) {
        output += `${indent}${importToken} { ${
          specifiers.map((specifier) => specifier.text).join(", ")
        } } from "${targetSource}";\n`;
      }
    }

    output += text.slice(cursor);
    if (changed) {
      output = mergeDuplicateImportStatements(output);

      if (fileChangeGroups.size > 0) {
        const migratedNames = [
          ...new Set(
            [...fileChangeGroups.values()].flatMap((changeEntry) => [...changeEntry.importedNames]),
          ),
        ];

        console.log(`\n${entry.path}`);
        console.log(`  Migrated symbols: ${migratedNames.join(", ")}`);
        console.log("  Suggested replacement:");
        for (const changeEntry of fileChangeGroups.values()) {
          const line = `${changeEntry.indent}${changeEntry.importToken} { ${
            [...changeEntry.specifiers].join(", ")
          } } from "${changeEntry.targetSource}";`;
          console.log(`    ${line}`);
        }
      }
    }
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
