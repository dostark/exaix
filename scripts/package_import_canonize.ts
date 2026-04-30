#!/usr/bin/env -S deno run -A
/**
 * @module PackageImportCanonize
 * @path scripts/package_import_canonize.ts
 * @description Convert direct package module imports in packages/ to canonical package or subfolder barrel imports.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/package_import_canonize.ts [--edit]
 *
 * The script scans the packages/ tree for imports from @exaix packages, detects when symbols can be imported
 * from a package barrel or subfolder mod.ts file, and rewrites imports accordingly. If a needed barrel file is
 * missing, it is created and exported from.
 */

import { walk } from "@std/fs";
import { basename, dirname, extname, join, relative } from "@std/path";
import { mergeDuplicateImportStatements } from "./package_import_migration.ts";

const REPO_ROOT = Deno.cwd();
const EDIT_MODE = Deno.args.includes("--edit");
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
    return config.imports as ImportMap ?? {};
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

function normalizePathForImport(path: string): string {
  return path.replace(/\\/g, "/");
}

function stripIndexOrModImport(importSource: string): string {
  return importSource.replace(/(?:\/mod|\/index)\.(ts|tsx|js|jsx)$/, "");
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

function getPackageName(importSource: string): string | null {
  const match = importSource.match(/^(@[^/]+\/[^/]+)(?:\/.*)?$/);
  return match ? match[1] : null;
}

function getPackageDir(packageName: string): string {
  const segments = packageName.split("/");
  return join(REPO_ROOT, "packages", segments[1]);
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

function findAliasImportForFsPath(fsPath: string, imports: ImportMap): string | null {
  const normalizedFsPath = normalizePathForImport(fsPath);
  const aliasCandidates = Object.entries(imports)
    .map(([key, value]) => ({ key, value: normalizePathForImport(toFsPath(value)) }))
    .sort((a, b) => b.value.length - a.value.length);

  for (const { key, value } of aliasCandidates) {
    if (normalizedFsPath === value) {
      return stripIndexOrModImport(key);
    }

    const normalizedValue = value.endsWith("/") ? value : `${value}/`;
    if (normalizedFsPath.startsWith(normalizedValue)) {
      const relativePath = normalizePathForImport(normalizedFsPath.slice(normalizedValue.length));
      return `${key}${relativePath}`;
    }
  }

  return null;
}

async function resolveModuleFile(importSource: string, imports: ImportMap): Promise<string | null> {
  const mappedPath = mapImportSource(importSource, imports) ?? importSource;
  const fsPath = toFsPath(mappedPath);
  return await tryResolveFile(fsPath);
}

async function resolveImportFile(importSource: string, moduleDir: string, imports: ImportMap): Promise<string | null> {
  if (importSource.startsWith("./") || importSource.startsWith("../") || importSource.startsWith("/")) {
    return await tryResolveFile(join(moduleDir, importSource));
  }

  return await resolveModuleFile(importSource, imports);
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

  const exportListRegex = /export\s*(?:type\s*)?\{([^}]*)\}\s*(?:from\s*["']([^"']+)["'])?/g;
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

async function resolveReexportSource(source: string, moduleDir: string, imports: ImportMap): Promise<string | null> {
  if (source.startsWith("./") || source.startsWith("../")) {
    return await tryResolveFile(join(moduleDir, source));
  }
  return await resolveModuleFile(source, imports);
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

async function ensureBarrelExportsSymbol(barrelPath: string, sourceFile: string): Promise<void> {
  const exportLine = `export * from "./${basename(sourceFile)}";`;
  if (!(await fileExists(barrelPath))) {
    const content = `/**
 * Barrel module generated by package_import_canonize.
 */\n${exportLine}\n`;
    await Deno.writeTextFile(barrelPath, content);
    return;
  }

  const text = await Deno.readTextFile(barrelPath);
  if (text.includes(exportLine)) {
    return;
  }
  await Deno.writeTextFile(barrelPath, `${text.trimEnd()}\n${exportLine}\n`);
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

function getCandidateBarrelPaths(filePath: string, packageDir: string): string[] {
  const barrelPaths: string[] = [];
  let currentDir = dirname(filePath);
  const normalizedPackageDir = normalizePathForImport(packageDir);

  while (true) {
    barrelPaths.push(join(currentDir, "mod.ts"));
    if (currentDir === packageDir) break;

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    const normalizedParent = normalizePathForImport(parentDir);
    if (!normalizedParent.startsWith(normalizedPackageDir)) {
      barrelPaths.push(join(packageDir, "mod.ts"));
      break;
    }

    currentDir = parentDir;
  }

  return barrelPaths.reverse();
}

async function getBestCanonicalImportSourceForSymbol(
  importSource: string,
  moduleDir: string,
  imports: ImportMap,
  symbol: string,
  cache: Map<string, Set<string>>,
): Promise<string | null> {
  const packageName = getPackageName(importSource);
  if (!packageName) {
    return null;
  }

  const packageDir = getPackageDir(packageName);
  if (!await fileExists(packageDir)) {
    return null;
  }

  const resolvedFsPath = await resolveImportFile(importSource, moduleDir, imports);
  if (!resolvedFsPath) {
    return null;
  }

  const candidateBarrels = getCandidateBarrelPaths(resolvedFsPath, packageDir);
  for (const barrelPath of candidateBarrels) {
    if (!(await fileExists(barrelPath))) continue;
    const barrelSource = filePathToImportSource(barrelPath, moduleDir, imports);
    const exports = await getExportsForSource(barrelSource, imports, cache);
    if (exports.has(symbol)) {
      return barrelSource;
    }
  }

  const containingDir = dirname(resolvedFsPath);
  const barrelPath = join(containingDir, "mod.ts");
  await ensureBarrelExportsSymbol(barrelPath, resolvedFsPath);
  const barrelSource = filePathToImportSource(barrelPath, moduleDir, imports);
  return barrelSource;
}

async function main() {
  const imports = await readImportMap();
  console.log("Scanning packages/ tree for canonical package imports...");

  let fileCount = 0;
  let changedCount = 0;
  const exportCache = new Map<string, Set<string>>();

  for await (const entry of walk(join(REPO_ROOT, "packages"), { includeDirs: false })) {
    if (![".ts", ".tsx"].includes(extname(entry.path))) continue;
    if (entry.path.includes("/deno_cache/")) continue;

    const text = await Deno.readTextFile(entry.path);
    const importKeyword = "import";
    const importPattern = new RegExp(
      `^([ \\t]*)(?:${importKeyword}(?:\\s+type)?)(\\s+\\{[\\s\\S]*?\\})\\s+from\\s+[\"']([^\"']+)[\"'];?\\s*$`,
      "gm",
    );
    let cursor = 0;
    let output = "";
    let changed = false;

    const fileChangeGroups = new Map<
      string,
      {
        indent: string;
        importToken: string;
        targetSource: string;
        specifiers: Set<string>;
        importedNames: Set<string>;
        oldSources: Set<string>;
      }
    >();

    while (true) {
      const match = importPattern.exec(text);
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

      const isSpecificPackageFileImport = importSource.startsWith("@exaix/") && /\.[jt]sx?$/.test(importSource);
      if (!isSpecificPackageFileImport) {
        output += importStatement;
        continue;
      }

      for (const specifier of importedSpecifiers) {
        const bestSource = await getBestCanonicalImportSourceForSymbol(
          importSource,
          dirname(entry.path),
          imports,
          specifier.importedName,
          exportCache,
        );

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

      for (const [targetSource, specifiers] of importGroups) {
        const key = `${importToken}|${targetSource}`;
        const changeEntry = fileChangeGroups.get(key) ?? {
          indent,
          importToken,
          targetSource,
          specifiers: new Set<string>(),
          importedNames: new Set<string>(),
          oldSources: new Set<string>(),
        };

        for (const specifier of specifiers) {
          changeEntry.specifiers.add(specifier.text);
          changeEntry.importedNames.add(specifier.importedName);
        }
        changeEntry.oldSources.add(importSource);
        fileChangeGroups.set(key, changeEntry);
      }

      changed = true;
      changedCount += 1;

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
    if (!changed) continue;

    output = mergeDuplicateImportStatements(output);
    console.log(`${entry.path}`);
    for (const changeEntry of fileChangeGroups.values()) {
      const oldSources = [...changeEntry.oldSources].join(", ");
      const importedNames = [...changeEntry.importedNames].join(", ");
      console.log(`  Migrate ${importedNames} from ${oldSources} to ${changeEntry.targetSource}`);
      console.log(
        `  Proposed: ${changeEntry.importToken} { ${
          [...changeEntry.specifiers].join(", ")
        } } from "${changeEntry.targetSource}";`,
      );
    }
    if (EDIT_MODE) {
      await Deno.writeTextFile(entry.path, output);
      console.log(`  Edited file.`);
    }

    fileCount += 1;
  }

  console.log(`\nProcessed ${fileCount} package files, changed ${changedCount} import statement(s).`);
  if (!EDIT_MODE) {
    console.log("Run with --edit to write changes to files.");
  }
}

if (import.meta.main) {
  await main();
}
