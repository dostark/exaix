/**
 * @module SymbolExtractor
 * @path packages/portal/knowledge/symbol_extractor.ts
 * @description Strategy 6 of PortalKnowledgeService: runs `deno doc --json` on
 * detected entrypoints to extract an accurate symbol index for TypeScript/Deno
 * portals. For non-TypeScript portals returns an empty array with no subprocess
 * call. Computes a PageRank-like connectivity score from cross-file import counts
 * and caps output at DEFAULT_SYMBOL_MAP_LIMIT.
 * Falls back to empty array on subprocess failure or timeout.
 * @architectural-layer Services
 * @related-files [packages/portal/knowledge/architecture_inferrer.ts, packages/portal/knowledge/key_file_identifier.ts]
 */

import type { ISymbolEntry } from "@exaix/schemas";

import {
  DEFAULT_SYMBOL_MAP_LIMIT,
  DENO_DOC_TIMEOUT_MS,
  LANG_JAVASCRIPT,
  LANG_TYPESCRIPT,
  runWithConcurrency,
  SYMBOL_EXTRACTOR_CONCURRENCY,
  SystemCommand,
} from "@exaix/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options controlling symbol extraction behaviour. */
export interface ISymbolExtractorOptions {
  /** Primary language detected by Strategy 1 (e.g. "typescript", "python"). */
  primaryLanguage: string;
  /** All file paths in the portal (relative to portalPath) — used for pageRank. */
  allFilePaths?: string[];
  /** Map of filePath → list of imported file paths — used for pageRank scoring. */
  importMap?: Record<string, string[]>;
}

/**
 * Edition-separation seam (Phase 115 Step 4): a pluggable, per-language symbol-index
 * extractor. Solo ships the deno-doc TS/JS {@link SymbolExtractor}; paid editions (P119)
 * register additional language extractors (e.g. tree-sitter) through the edition composer
 * via SymbolExtractorRegistry.
 */
export interface ISymbolExtractor {
  /**
   * Extract a symbol index for the given files. Returns [] when the extractor does not
   * support `options.primaryLanguage`.
   */
  extractSymbols(
    portalPath: string,
    filePaths: string[],
    options: ISymbolExtractorOptions,
  ): Promise<ISymbolEntry[]>;
}

/** Minimal interface for running `deno doc --json`; injectable for testing. */
export interface IDocCommandRunner {
  /**
   * Run `deno doc --json` on the given entrypoint.
   * @returns stdout JSON string, or null on non-zero exit / timeout.
   */
  run(entrypoint: string, portalPath: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Types: deno doc --json node shapes
// ---------------------------------------------------------------------------

/** A single parameter from a deno doc function definition. */
export interface IDenoDocParam {
  name?: string;
}

/** Return type repr from a deno doc function definition. */
export interface IDenoDocReturnType {
  repr?: string;
}

/** Function definition sub-node from deno doc --json. */
export interface IDenoDocFunctionDef {
  params?: IDenoDocParam[];
  returnType?: IDenoDocReturnType;
}

/** Variable definition sub-node from deno doc --json. */
export interface IDenoDocVariableDef {
  kind?: string;
}

/** JSDoc block from deno doc --json. */
export interface IDenoDocJsDoc {
  doc?: string;
}

/** Source location from deno doc --json. */
export interface IDenoDocLocation {
  filename?: string;
}

/** A node from `deno doc --json` output. */
export interface IDenoDocNode {
  kind?: string;
  name?: string;
  location?: IDenoDocLocation;
  functionDef?: IDenoDocFunctionDef;
  classDef?: object;
  interfaceDef?: object;
  typeAliasDef?: object;
  enumDef?: object;
  variableDef?: IDenoDocVariableDef;
  jsDoc?: IDenoDocJsDoc;
}

class DenoDocCommandRunner implements IDocCommandRunner {
  async run(entrypoint: string, portalPath: string): Promise<string | null> {
    try {
      const cmd = new Deno.Command(SystemCommand.DENO, {
        args: ["doc", "--json", entrypoint],
        cwd: portalPath,
        stdout: "piped",
        stderr: "null",
      });
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), DENO_DOC_TIMEOUT_MS));
      const outputPromise = cmd.output().then((out) => {
        if (!out.success) return null;
        return new TextDecoder().decode(out.stdout);
      });
      return await Promise.race([outputPromise, timeoutPromise]);
    } catch {
      return null;
    }
  }
}

/** Default real runner used in production. */
const DEFAULT_RUNNER: IDocCommandRunner = new DenoDocCommandRunner();

// ---------------------------------------------------------------------------
// Kind mapping
// ---------------------------------------------------------------------------

const KIND_MAP: Record<string, ISymbolEntry["kind"] | undefined> = {
  function: "function",
  class: "class",
  interface: "interface",
  typeAlias: "type",
  enum: "enum",
};

function mapKind(denoKind: string, node: IDenoDocNode): ISymbolEntry["kind"] | null {
  if (denoKind === "variable") {
    if (node.variableDef?.kind === "const") return "const";
    return null;
  }
  return KIND_MAP[denoKind] ?? null;
}

// ---------------------------------------------------------------------------
// Signature reconstruction
// ---------------------------------------------------------------------------

function buildSignature(name: string, node: IDenoDocNode): string {
  if (node.functionDef) {
    const params = node.functionDef.params ?? [];
    const paramNames = params.map((p) => p.name ?? "_").join(", ");
    const retRepr = node.functionDef.returnType?.repr ? `: ${node.functionDef.returnType.repr}` : "";
    return `function ${name}(${paramNames})${retRepr}`;
  }
  if (node.classDef) return `class ${name}`;
  if (node.interfaceDef) return `interface ${name}`;
  if (node.typeAliasDef) return `type ${name}`;
  if (node.enumDef) return `enum ${name}`;
  return name;
}

// ---------------------------------------------------------------------------
// PageRank scoring
// ---------------------------------------------------------------------------

function computePageRankScores(
  symbols: ISymbolEntry[],
  allFilePaths: string[],
  importMap: Record<string, string[]>,
): ISymbolEntry[] {
  const totalFiles = allFilePaths.length || 1;

  const importerCount: Record<string, number> = {};
  for (const [_importerFile, imported] of Object.entries(importMap)) {
    for (const src of imported) {
      importerCount[src] = (importerCount[src] ?? 0) + 1;
    }
  }

  return symbols.map((s) => ({
    ...s,
    pageRankScore: (importerCount[s.file] ?? 0) / totalFiles,
  }));
}

// ---------------------------------------------------------------------------
// SymbolExtractor
// ---------------------------------------------------------------------------

/**
 * Normalise raw `deno doc --json` output into the legacy flat-node format.
 * Handles both Deno 1.x (bare array) and Deno 2.x (`{version, nodes: {...}}`).
 */
function parseDenoDocNodes(raw: string): IDenoDocNode[] {
  const parsed = JSON.parse(raw);

  // Deno 1.x: bare array of nodes
  if (Array.isArray(parsed)) return parsed as IDenoDocNode[];

  // Deno 2.x: { version: 2, nodes: { "file:///path": { symbols: [...] } } }
  const doc2 = parsed as {
    version?: number;
    nodes?: Record<string, {
      symbols?: Array<{
        name?: string;
        declarations?: Array<{
          kind?: string;
          location?: IDenoDocLocation;
          jsDoc?: IDenoDocJsDoc;
          def?: IDenoDocFunctionDef | IDenoDocVariableDef | object;
        }>;
      }>;
    }>;
  };
  if (!doc2.nodes || typeof doc2.nodes !== "object") return [];

  const result: IDenoDocNode[] = [];
  for (const fileUrl of Object.keys(doc2.nodes)) {
    const filePath = fileUrl.startsWith("file://") ? fileUrl.slice(7) : fileUrl;
    const modInfo = doc2.nodes[fileUrl];
    if (!modInfo.symbols) continue;

    for (const sym of modInfo.symbols) {
      const name = sym.name ?? "";
      if (!name) continue;
      const decl = sym.declarations?.[0];
      if (!decl) continue;

      result.push({
        name,
        kind: decl.kind ?? "unknown",
        location: decl.location ?? { filename: filePath },
        jsDoc: decl.jsDoc,
        functionDef: decl.kind === "function" ? (decl.def as IDenoDocFunctionDef) : undefined,
        variableDef: decl.kind === "variable" ? (decl.def as IDenoDocVariableDef) : undefined,
        classDef: decl.kind === "class" ? {} : undefined,
        interfaceDef: decl.kind === "interface" ? {} : undefined,
        enumDef: decl.kind === "enum" ? {} : undefined,
        typeAliasDef: decl.kind === "typeAlias" ? {} : undefined,
      });
    }
  }
  return result;
}

/** TypeScript/Deno symbol index extractor via `deno doc --json`. */
export class SymbolExtractor implements ISymbolExtractor {
  private readonly _runner: IDocCommandRunner;

  constructor(runner: IDocCommandRunner = DEFAULT_RUNNER) {
    this._runner = runner;
  }

  /**
   * Extract symbols from the given file paths.
   * When many files are provided, groups by directory and runs `deno doc --json`
   * per directory with bounded concurrency. Deduplicates symbols by name + file path.
   * Returns [] immediately for non-TypeScript/JavaScript portals.
   */
  async extractSymbols(
    portalPath: string,
    filePaths: string[],
    options: ISymbolExtractorOptions,
  ): Promise<ISymbolEntry[]> {
    const lang = options.primaryLanguage.toLowerCase();
    if (lang !== LANG_TYPESCRIPT && lang !== LANG_JAVASCRIPT) return [];
    if (filePaths.length === 0) return [];

    const allSymbols: ISymbolEntry[] = [];
    const seen = new Set<string>();

    // Group files by directory for batching — run deno doc --json per batch
    const dirGroups = groupByDirectory(filePaths);
    const batches = [...dirGroups.entries()];

    await runWithConcurrency(batches, SYMBOL_EXTRACTOR_CONCURRENCY, async ([_dir, dirFiles]) => {
      for (const filePath of dirFiles) {
        let raw: string | null;
        try {
          raw = await this._runner.run(filePath, portalPath);
        } catch {
          return;
        }
        if (!raw) continue;

        let nodes: IDenoDocNode[];
        try {
          nodes = parseDenoDocNodes(raw);
        } catch {
          continue;
        }

        for (const node of nodes) {
          const name = node.name ?? "";
          if (!name) continue;
          const denoKind = node.kind ?? "";
          const kind = mapKind(denoKind, node);
          if (!kind) continue;

          const file = node.location?.filename ?? filePath;
          const dedupKey = `${name}:${file}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);

          const signature = buildSignature(name, node);
          const doc = node.jsDoc?.doc || undefined;

          allSymbols.push({ name, kind, file, signature, doc });
        }
      }
    });

    const withScores = (options.allFilePaths && options.importMap)
      ? computePageRankScores(allSymbols, options.allFilePaths, options.importMap)
      : allSymbols;

    return withScores
      .sort((a, b) => (b.pageRankScore ?? 0) - (a.pageRankScore ?? 0))
      .slice(0, DEFAULT_SYMBOL_MAP_LIMIT);
  }
}

/** Group file paths by their top-level directory. */
function groupByDirectory(filePaths: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const fp of filePaths) {
    const dir = fp.includes("/") ? fp.substring(0, fp.lastIndexOf("/")) : "";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(fp);
  }
  return groups;
}
