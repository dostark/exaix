#!/usr/bin/env -S deno run -A
/**
 * @module PackageImportCommon
 * @path scripts/package_import_common.ts
 * @description Import-map reading and module-path resolution helpers shared by the package import scripts.
 * @architectural-layer Tooling
 * @related-files [scripts/package_import_canonize.ts, scripts/package_import_migration.ts]
 * Usage: imported by package_import_canonize.ts and package_import_migration.ts; not a standalone command.
 */

import { join } from "@std/path";

export const REPO_ROOT = Deno.cwd();
export const DENO_CONFIG_PATH = join(REPO_ROOT, "deno.json");

interface JsonImportMap {
  imports?: IImportMap;
}

export interface IImportMap {
  [key: string]: string;
}

export interface IImportSpecifier {
  importedName: string;
  text: string;
}

export async function readImportMap(): Promise<IImportMap> {
  try {
    const content = await Deno.readTextFile(DENO_CONFIG_PATH);
    const config = JSON.parse(content) as JsonImportMap;
    return (config.imports as IImportMap) ?? {};
  } catch {
    return {};
  }
}

export function parseImportSpecifiers(importClause: string): IImportSpecifier[] {
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

export function parseExportNames(exportClause: string): string[] {
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

export async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isFile || stat.isDirectory;
  } catch {
    return false;
  }
}

export async function tryResolveFile(path: string): Promise<string | null> {
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

export function normalizePathForImport(path: string): string {
  return path.replace(/\\/g, "/");
}

export function stripIndexOrModImport(importSource: string): string {
  return importSource.replace(/(?:\/mod|\/index)\.(ts|tsx|js|jsx)$/, "");
}

export function mapImportSource(importSource: string, imports: IImportMap): string | null {
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

export function toFsPath(resolvedPath: string): string {
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

export async function resolveModuleFile(importSource: string, imports: IImportMap): Promise<string | null> {
  const mappedPath = mapImportSource(importSource, imports) ?? importSource;
  const fsPath = toFsPath(mappedPath);
  return await tryResolveFile(fsPath);
}
