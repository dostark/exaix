/**
 * @module TreeSitterSymbolExtractor
 * @path packages/portal/knowledge/tree_sitter_symbol_extractor.ts
 * @description Shared MIT base class for tree-sitter-based ISymbolExtractor implementations.
 * Handles Parser init, grammar loading, query execution, bounds (byte/node/file/time),
 * path security, pageRank ranking, and capping at DEFAULT_SYMBOL_MAP_LIMIT.
 * Subclasses provide the language name, grammar WASM path, .scm query source, and
 * per-match symbol mapping.
 * @architectural-layer Portal
 * @dependencies [npm:web-tree-sitter, npm:tree-sitter-python]
 * @related-files [packages/portal/knowledge/python_symbol_extractor.ts]
 */

import { Language, Parser, Query, type QueryMatch } from "web-tree-sitter";
import { join, resolve } from "@std/path";
import type { ISymbolExtractor, ISymbolExtractorOptions } from "./symbol_extractor.ts";
import type { ISymbolEntry } from "@exaix/schemas";
import {
  DEFAULT_SYMBOL_MAP_LIMIT,
  SYMBOL_EXTRACT_MAX_FILE_BYTES,
  SYMBOL_EXTRACT_MAX_FILES,
  SYMBOL_EXTRACT_MAX_NODES,
  SYMBOL_EXTRACT_TIMEOUT_MS,
} from "@exaix/core";
import { resolveNpmPackageFile, resolveNpmWasmPath } from "./npm_wasm_loader.ts";

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

/** Shared base for tree-sitter-based extractors; see abstract members below. */
export abstract class TreeSitterSymbolExtractor implements ISymbolExtractor {
  protected abstract readonly languageName: string;
  protected abstract readonly grammarWasmSpecifier: string;
  /** npm package name for the grammar (e.g. "tree-sitter-rust") — used for fallback resolution. */
  protected abstract readonly grammarNpmName: string;
  /** Grammar version (e.g. "0.24.0") — used for fallback resolution. */
  protected abstract readonly grammarVersion: string;
  /** Grammar WASM filename (e.g. "tree-sitter-rust.wasm"). */
  protected abstract readonly grammarWasmFilename: string;
  protected abstract scmQuerySource(): string;
  protected abstract processMatch(
    match: QueryMatch,
    file: string,
  ): ISymbolEntry[];
  protected abstract extractImports(source: string): string[];

  private _initPromise: Promise<void> | null = null;
  private _parser: Parser | null = null;
  private _query: Query | null = null;

  // -----------------------------------------------------------------------
  // Initialization (lazy, once)
  // -----------------------------------------------------------------------

  private ensureInitialized(): Promise<void> {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInit();
    return this._initPromise;
  }

  private async _doInit(): Promise<void> {
    const coreWasmPath = resolveNpmWasmPath(
      "npm:web-tree-sitter/web-tree-sitter.wasm",
    );
    const wasmDir = resolve(join(coreWasmPath, ".."));

    // Resolve grammar WASM — try import.meta.resolve first, fall back to
    // package-aware cache path for packages whose WASM isn't a module entry.
    let grammarWasmPath: string;
    try {
      grammarWasmPath = resolveNpmWasmPath(this.grammarWasmSpecifier);
    } catch (_resolveErr) {
      grammarWasmPath = resolveNpmPackageFile(
        this.grammarNpmName,
        this.grammarVersion,
        this.grammarWasmFilename,
      );
    }
    const grammarWasm = await Deno.readFile(grammarWasmPath);

    await Parser.init({
      locateFile: (path: string) => join(wasmDir, path),
    });
    this._parser = new Parser();

    const language = await Language.load(grammarWasm);
    this._parser.setLanguage(language);

    this._query = new Query(language, this.scmQuerySource());
  }

  // -----------------------------------------------------------------------
  // ISymbolExtractor implementation
  // -----------------------------------------------------------------------

  async extractSymbols(
    portalPath: string,
    filePaths: string[],
    options: ISymbolExtractorOptions,
  ): Promise<ISymbolEntry[]> {
    if (options.primaryLanguage !== this.languageName) return [];

    await this.ensureInitialized();

    const files = filePaths.slice(0, SYMBOL_EXTRACT_MAX_FILES);
    if (files.length === 0) return [];

    const portalRoot = resolve(portalPath);
    const allSymbols: ISymbolEntry[] = [];
    const fileImportTargets: Record<string, string[]> = {};
    const startTime = Date.now();

    for (const file of files) {
      if (Date.now() - startTime >= SYMBOL_EXTRACT_TIMEOUT_MS) break;

      const fullPath = resolve(join(portalRoot, file));
      if (!fullPath.startsWith(portalRoot)) continue;

      let content: string;
      try {
        const stat = await Deno.stat(fullPath);
        if (!stat.isFile) continue;
        if (stat.size > SYMBOL_EXTRACT_MAX_FILE_BYTES) continue;
        content = await Deno.readTextFile(fullPath);
      } catch (_fileErr) {
        // Fail-soft: skip unreadable or race-condition files silently.
        // In a debug-logging context, _fileErr contains the OS error.
        continue;
      }

      const tree = this._parser!.parse(content);
      if (!tree) continue;
      const nodeCount = this._countNodes(tree.rootNode);
      if (nodeCount > SYMBOL_EXTRACT_MAX_NODES) continue;

      fileImportTargets[file] = this.extractImports(content);

      const matches = this._query!.matches(tree.rootNode);
      for (const match of matches) {
        const symbols = this.processMatch(match, file);
        allSymbols.push(...symbols);
      }
    }

    // Deduplicate by name, last-wins: when a generic and a specific kind both
    // match the same symbol (e.g. a Go struct's type_spec and struct_type),
    // the more specific kind appears later in tree-sitter output.
    const seen = new Map<string, number>();
    const deduped: ISymbolEntry[] = [];
    for (const sym of allSymbols) {
      const existing = seen.get(sym.name);
      if (existing !== undefined) {
        // Replace if the existing entry has kind "type" or this one is
        // more specific (last-wins for same position).
        deduped[existing] = sym;
      } else {
        seen.set(sym.name, deduped.length);
        deduped.push(sym);
      }
    }

    const ranked = this._computePageRank(
      deduped,
      deduped.map((s) => s.file),
      fileImportTargets,
    );

    return ranked
      .sort((a, b) => (b.pageRankScore ?? 0) - (a.pageRankScore ?? 0))
      .slice(0, DEFAULT_SYMBOL_MAP_LIMIT);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Recursively count syntax nodes in the tree. The `child` callback
   * returns a node-like object or null — only non-null values recurse. */
  private _countNodes(
    node: { childCount: number; child: (i: number) => unknown },
  ): number {
    let count = 1;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        count += this._countNodes(
          child as { childCount: number; child: (i: number) => unknown },
        );
      }
    }
    return count;
  }

  private _computePageRank(
    symbols: ISymbolEntry[],
    _allFiles: string[],
    fileImportTargets: Record<string, string[]>,
  ): ISymbolEntry[] {
    const totalFiles = Object.keys(fileImportTargets).length || 1;

    // Build a map: file stem (basename no ext) → file path, and symbol name → file path
    const stemToFile: Record<string, string> = {};
    const symbolToFile: Record<string, Set<string>> = {};
    for (const sym of symbols) {
      const stem = sym.file.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
      stemToFile[stem] = sym.file;
      if (!symbolToFile[sym.name]) symbolToFile[sym.name] = new Set();
      symbolToFile[sym.name].add(sym.file);
    }

    // Count unique importers per file
    const importerFiles: Record<string, Set<string>> = {};
    for (const [importerFile, imported] of Object.entries(fileImportTargets)) {
      for (const target of imported) {
        const matchedFiles = new Set<string>();

        // Match by file stem
        if (stemToFile[target]) matchedFiles.add(stemToFile[target]);
        // Match by symbol name
        if (symbolToFile[target]) {
          for (const f of symbolToFile[target]) matchedFiles.add(f);
        }

        for (const f of matchedFiles) {
          if (f !== importerFile) {
            if (!importerFiles[f]) importerFiles[f] = new Set();
            importerFiles[f].add(importerFile);
          }
        }
      }
    }

    return symbols.map((s) => ({
      ...s,
      pageRankScore: (importerFiles[s.file]?.size ?? 0) / totalFiles,
    }));
  }
}
