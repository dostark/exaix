/**
 * @module SymbolExtractor
 * @path src/services/portal_knowledge/symbol_extractor.ts
 * @description Strategy 6 of PortalKnowledgeService: runs `deno doc --json` on
 * detected entrypoints to extract an accurate symbol index for TypeScript/Deno
 * portals. For non-TypeScript portals returns an empty array with no subprocess
 * call. Computes a PageRank-like connectivity score from cross-file import counts
 * and caps output at DEFAULT_SYMBOL_MAP_LIMIT.
 * Falls back to empty array on subprocess failure or timeout.
 * @architectural-layer Services
 * * @related-files [src/services/portal_knowledge/architecture_inferrer.ts, src/services/portal_knowledge/key_file_identifier.ts]
 */

import type { ISymbolEntry } from "@exaix/schemas/portal_knowledge.ts";
import { SystemCommand } from "../../shared/enums.ts";
import { DEFAULT_SYMBOL_MAP_LIMIT, LANG_JAVASCRIPT, LANG_TYPESCRIPT } from "../../shared/constants.ts";

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

import { DENO_DOC_TIMEOUT_MS } from "../../shared/constants.ts";

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

  // Build a map: sourceFile → importerCount
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

/** TypeScript/Deno symbol index extractor via `deno doc --json`. */
export class SymbolExtractor {
  private readonly _runner: IDocCommandRunner;

  constructor(runner: IDocCommandRunner = DEFAULT_RUNNER) {
    this._runner = runner;
  }

  /**
   * Extract symbols from the given entrypoints.
   * Returns [] immediately for non-TypeScript/JavaScript portals.
   */
  async extractSymbols(
    portalPath: string,
    entrypoints: string[],
    options: ISymbolExtractorOptions,
  ): Promise<ISymbolEntry[]> {
    const lang = options.primaryLanguage.toLowerCase();
    if (lang !== LANG_TYPESCRIPT && lang !== LANG_JAVASCRIPT) return [];

    const allSymbols: ISymbolEntry[] = [];

    for (const entrypoint of entrypoints) {
      let raw: string | null;
      try {
        raw = await this._runner.run(entrypoint, portalPath);
      } catch {
        return [];
      }
      if (!raw) continue;

      let nodes: IDenoDocNode[];
      try {
        nodes = JSON.parse(raw) as IDenoDocNode[];
      } catch {
        continue;
      }

      for (const node of nodes) {
        const name = node.name ?? "";
        if (!name) continue;
        const denoKind = node.kind ?? "";
        const kind = mapKind(denoKind, node);
        if (!kind) continue;

        const file = node.location?.filename ?? entrypoint;
        const signature = buildSignature(name, node);
        const doc = node.jsDoc?.doc || undefined;

        allSymbols.push({ name, kind, file, signature, doc });
      }
    }

    // PageRank scoring
    const withScores = (options.allFilePaths && options.importMap)
      ? computePageRankScores(allSymbols, options.allFilePaths, options.importMap)
      : allSymbols;

    // Sort descending by score, cap at limit
    return withScores
      .sort((a, b) => (b.pageRankScore ?? 0) - (a.pageRankScore ?? 0))
      .slice(0, DEFAULT_SYMBOL_MAP_LIMIT);
  }
}
