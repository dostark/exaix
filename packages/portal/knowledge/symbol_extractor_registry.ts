/**
 * @module SymbolExtractorRegistry
 * @path packages/portal/knowledge/symbol_extractor_registry.ts
 * @description Edition-separation seam (Phase 115 Step 4): a per-language registry that selects
 * an ISymbolExtractor by primary language. Solo registers the deno-doc TS/JS SymbolExtractor;
 * paid editions (P119 multi-language) register additional extractors (e.g. tree-sitter) through
 * the edition composer. Unregistered languages resolve to a no-op extractor (empty index),
 * preserving the historical behaviour for non-TS portals.
 * @architectural-layer Portal
 * @dependencies [packages/portal/knowledge/symbol_extractor.ts]
 * @related-files [packages/portal/knowledge/symbol_extractor.ts, packages/portal/knowledge/portal_knowledge_service.ts]
 */

import { LANG_JAVASCRIPT, LANG_PYTHON, LANG_TYPESCRIPT } from "@exaix/core";
import { type IDocCommandRunner, type ISymbolExtractor, SymbolExtractor } from "./symbol_extractor.ts";
import { PythonSymbolExtractor } from "./python_symbol_extractor.ts";
import type { Opt, Reason } from "@exaix/core/types";

/** Selects an ISymbolExtractor by language; lets paid editions register more extractors. */
export interface ISymbolExtractorRegistry {
  /** Register an extractor for a language (case-insensitive). */
  register(language: string, extractor: ISymbolExtractor): void;
  /** Resolve the extractor for a language, or the no-op extractor when none is registered. */
  getForLanguage(language: string): ISymbolExtractor;
}

/** A no-op extractor: returns an empty symbol index for any language. */
export const EMPTY_SYMBOL_EXTRACTOR: ISymbolExtractor = {
  extractSymbols: () => Promise.resolve([]),
};

/** Map-backed registry keyed by lower-cased language name. */
export class SymbolExtractorRegistry implements ISymbolExtractorRegistry {
  private readonly extractors = new Map<string, ISymbolExtractor>();

  register(language: string, extractor: ISymbolExtractor): void {
    this.extractors.set(language.toLowerCase(), extractor);
  }

  getForLanguage(language: string): ISymbolExtractor {
    return this.extractors.get(language.toLowerCase()) ?? EMPTY_SYMBOL_EXTRACTOR;
  }
}

/** `runner` is forwarded for test injection, matching `new SymbolExtractor(runner)`. */
export function createDefaultSymbolExtractorRegistry(
  runner?: Opt<IDocCommandRunner, Reason.TestOverride>,
): SymbolExtractorRegistry {
  const registry = new SymbolExtractorRegistry();
  const tsExtractor = runner ? new SymbolExtractor(runner) : new SymbolExtractor();
  registry.register(LANG_TYPESCRIPT, tsExtractor);
  registry.register(LANG_JAVASCRIPT, tsExtractor);
  // Python tree-sitter extractor ships in Solo (MIT) alongside TS/JS.
  registry.register(LANG_PYTHON, new PythonSymbolExtractor());
  return registry;
}
