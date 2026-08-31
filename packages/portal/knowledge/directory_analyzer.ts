/**
 * @module DirectoryAnalyzer
 * @path packages/portal/knowledge/directory_analyzer.ts
 * @description Strategy 1 of PortalKnowledgeService: walks the file tree of a
 * mounted portal, builds statistics (file counts, extension distribution),
 * detects architecture layers from directory naming conventions, identifies
 * the primary language, and detects monorepo vs. single-project structure.
 * Pure function module — zero LLM / network dependencies, sandboxed-safe.
 * @architectural-layer Services
 * @related-files [packages/portal/knowledge/config_parser.ts]
 */

import { join } from "@std/path";
import {
  DEFAULT_IGNORE_PATTERNS,
  LANG_JAVASCRIPT,
  LANG_TYPESCRIPT,
  PORTAL_KNOWLEDGE_ARCH_LAYER_DIRS,
  PORTAL_KNOWLEDGE_PRIORITY_PATTERNS,
} from "@exaix/core";
import type { IArchitectureLayer, IMonorepoPackage, IPortalKnowledge } from "@exaix/schemas";

// Internal types

/** Result of a portal directory walk. */
export interface IWalkResult {
  files: string[];
  directories: Set<string>;
  extensionDistribution: Record<string, number>;
}

// Helpers

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot) : "";
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function isIgnored(name: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    if (name === pattern || name.startsWith(pattern + "/")) return true;
  }
  return false;
}

function isPriority(name: string): boolean {
  const base = basename(name);
  return PORTAL_KNOWLEDGE_PRIORITY_PATTERNS.includes(base);
}

/** Map dominant file extension to a language name. */
function detectPrimaryLanguage(ext: Record<string, number>): string {
  const languageMap: Record<string, string> = {
    ".ts": LANG_TYPESCRIPT,
    ".tsx": LANG_TYPESCRIPT,
    ".js": LANG_JAVASCRIPT,
    ".jsx": LANG_JAVASCRIPT,
    ".mjs": LANG_JAVASCRIPT,
    ".cjs": LANG_JAVASCRIPT,
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".kt": "kotlin",
    ".rb": "ruby",
    ".php": "php",
    ".cs": "csharp",
    ".cpp": "cpp",
    ".c": "c",
  };

  let maxCount = 0;
  let dominant = "";
  for (const [extension, count] of Object.entries(ext)) {
    if (languageMap[extension] && count > maxCount) {
      maxCount = count;
      dominant = extension;
    }
  }
  return languageMap[dominant] ?? "unknown";
}

/** Detect architecture layers from a set of visited directory paths (relative). */
function detectLayers(
  directories: Set<string>,
  files: string[],
): IArchitectureLayer[] {
  const layers: IArchitectureLayer[] = [];
  const seen = new Set<string>();

  for (const dir of directories) {
    const parts = dir.replace(/\\/g, "/").split("/");
    for (const part of parts) {
      if (PORTAL_KNOWLEDGE_ARCH_LAYER_DIRS[part] && !seen.has(part)) {
        seen.add(part);
        const keyFiles = files
          .filter((f) => f.includes(`/${part}/`) || f.startsWith(`${part}/`))
          .slice(0, 5);
        layers.push({
          name: part,
          paths: [`${part}/`],
          responsibility: PORTAL_KNOWLEDGE_ARCH_LAYER_DIRS[part],
          keyFiles,
        });
      }
    }
  }
  return layers;
}

/** Detect monorepo packages by locating nested package.json/deno.json files. */
function detectMonorepoPackages(
  files: string[],
): IMonorepoPackage[] {
  const packages: IMonorepoPackage[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    const parts = normalized.split("/");

    if (parts.length < 2) continue;
    const fileName = parts[parts.length - 1];
    if (fileName !== "package.json" && fileName !== "deno.json" && fileName !== "deno.jsonc") continue;

    if (parts.length === 1) continue;

    const packageDir = parts.slice(0, parts.length - 1).join("/");
    if (seen.has(packageDir)) continue;
    seen.add(packageDir);

    const dirName = parts[parts.length - 2];
    packages.push({
      name: dirName,
      path: packageDir,
      primaryLanguage: LANG_TYPESCRIPT,
      layers: [],
      conventions: [],
    });
  }

  return packages;
}

// BFS walker helpers

function recordFile(result: IWalkResult, relPath: string, name: string): void {
  result.files.push(relPath);
  const ext = getExtension(name);
  if (ext) result.extensionDistribution[ext] = (result.extensionDistribution[ext] ?? 0) + 1;
}

function processEntry(
  entry: Deno.DirEntry,
  rel: string,
  allIgnore: string[],
  result: IWalkResult,
  visitedDirs: Set<string>,
  queue: string[],
): void {
  if (isIgnored(entry.name, allIgnore)) return;
  if (entry.isSymlink) return;

  const entryRel = rel ? `${rel}/${entry.name}` : entry.name;

  if (entry.isDirectory) {
    if (!visitedDirs.has(entryRel)) {
      visitedDirs.add(entryRel);
      result.directories.add(entryRel);
      queue.push(entryRel);
    }
  } else if (entry.isFile) {
    if (rel === "" && isPriority(entry.name)) return;
    recordFile(result, entryRel, entry.name);
  }
}

/** Collect root-level priority files (config/entrypoints) before the BFS walk. */
async function collectPriorityFiles(root: string, result: IWalkResult, scanLimit: number): Promise<boolean> {
  try {
    for await (const entry of Deno.readDir(root)) {
      if (entry.isFile && isPriority(entry.name) && result.files.length < scanLimit) {
        recordFile(result, entry.name, entry.name);
      }
    }
  } catch {
    return false;
  }
  return true;
}

// BFS walker

export async function walkDirectory(
  root: string,
  ignorePatterns: string[],
  scanLimit: number,
): Promise<IWalkResult> {
  const allIgnore = [...DEFAULT_IGNORE_PATTERNS, ...ignorePatterns];
  const result: IWalkResult = {
    files: [],
    directories: new Set<string>(),
    extensionDistribution: {},
  };

  const accessible = await collectPriorityFiles(root, result, scanLimit);
  if (!accessible || result.files.length >= scanLimit) return result;

  const queue: string[] = [""];
  const visitedDirs = new Set<string>();

  while (queue.length > 0 && result.files.length < scanLimit) {
    const rel = queue.shift()!;
    const abs = rel ? join(root, rel) : root;

    const entries: Deno.DirEntry[] = [];
    try {
      for await (const entry of Deno.readDir(abs)) {
        entries.push(entry);
      }
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (result.files.length >= scanLimit) break;
      processEntry(entry, rel, allIgnore, result, visitedDirs, queue);
    }
  }

  return result;
}

// Public API

/** Analyse the directory structure of a portal codebase into stats, layers, and techStack. */
export async function analyzeDirectory(
  portalPath: string,
  ignorePatterns: string[],
  scanLimit: number,
): Promise<Partial<IPortalKnowledge>> {
  const walked = await walkDirectory(portalPath, ignorePatterns, scanLimit);

  const primaryLanguage = detectPrimaryLanguage(walked.extensionDistribution);
  const layers = detectLayers(walked.directories, walked.files);
  const packages = detectMonorepoPackages(walked.files);

  return {
    layers,
    techStack: {
      primaryLanguage,
    },
    stats: {
      totalFiles: walked.files.length,
      totalDirectories: walked.directories.size,
      extensionDistribution: walked.extensionDistribution,
    },
    ...(packages.length >= 2 ? { packages } : {}),
  };
}
