/**
 * @module SymbolReferenceExtractor
 * @path packages/portal/knowledge/symbol_reference_extractor.ts
 * @description Edition-separation seam for symbol-level reference extraction
 * (Phase 178). A paid edition registers a per-language `ISymbolReferenceExtractor`
 * through `ICapabilityModule.registerSymbolReferenceExtractors`. Unregistered
 * languages resolve to a no-op extractor, so Solo behaviour is unchanged.
 * @architectural-layer Portal
 * @related-files [packages/portal/knowledge/symbol_extractor_registry.ts, packages/portal/knowledge/portal_knowledge_service.ts]
 */

import type { IPortalKnowledgeRelationship, ISymbolEntry } from "@exaix/schemas";

/** Options a reference extractor needs to resolve a captured name. */
export interface ISymbolReferenceExtractorOptions {
  /** Primary language detected by Strategy 1 (e.g. "go", "java", "rust"). */
  primaryLanguage: string;
  /** Strategy 6's `symbolMap`: the declarations a reference may match against.
   *  It is capped and deduplicated by name, so the graph is a ranked subset. */
  knownSymbols: ISymbolEntry[];
  /** Resolved internal file-import edges. Reachability is DIRECT only: a
   *  reference may resolve into the referencing file or a direct import target. */
  fileImportEdges: IPortalKnowledgeRelationship[];
}

/** Per-language symbol-reference extractor. */
export interface ISymbolReferenceExtractor {
  /** Extracts `symbol_references_symbol` edges. Returns `[]` when the extractor
   *  does not support `options.primaryLanguage`. */
  extractReferences(
    portalPath: string,
    filePaths: string[],
    options: ISymbolReferenceExtractorOptions,
  ): Promise<IPortalKnowledgeRelationship[]>;
}

/** Selects an `ISymbolReferenceExtractor` by language. */
export interface ISymbolReferenceExtractorRegistry {
  /** Registers an extractor for a language (case-insensitive). */
  register(language: string, extractor: ISymbolReferenceExtractor): void;
  /** Resolves the extractor for a language, or the no-op extractor when none is
   *  registered. Never returns `undefined`. */
  getForLanguage(language: string): ISymbolReferenceExtractor;
}

/** Resolves a language's import specifiers into portal-relative file edges. */
export interface ISymbolFileResolver {
  /** Returns `file_imports_file_internal` edges for the supplied files. */
  resolveFileEdges(
    portalPath: string,
    filePaths: string[],
  ): Promise<IPortalKnowledgeRelationship[]>;
}

/** Selects an `ISymbolFileResolver` by language. */
export interface ISymbolFileResolverRegistry {
  register(language: string, resolver: ISymbolFileResolver): void;
  /** Never returns `undefined`.
   *  An unregistered language resolves to a no-op. */
  getForLanguage(language: string): ISymbolFileResolver;
}

/** A no-op resolver: returns no edges for any language. */
export const EMPTY_SYMBOL_FILE_RESOLVER: ISymbolFileResolver = {
  resolveFileEdges: () => Promise.resolve([]),
};

/** Map-backed file-resolver registry keyed by lower-cased language name. */
export class SymbolFileResolverRegistry implements ISymbolFileResolverRegistry {
  private readonly resolvers = new Map<string, ISymbolFileResolver>();

  register(language: string, resolver: ISymbolFileResolver): void {
    this.resolvers.set(language.toLowerCase(), resolver);
  }

  getForLanguage(language: string): ISymbolFileResolver {
    return this.resolvers.get(language.toLowerCase()) ?? EMPTY_SYMBOL_FILE_RESOLVER;
  }
}

/** Builds the default (empty) file-resolver registry. */
export function createDefaultSymbolFileResolverRegistry(): ISymbolFileResolverRegistry {
  return new SymbolFileResolverRegistry();
}

/** A no-op extractor: returns no edges for any language. */
export const EMPTY_SYMBOL_REFERENCE_EXTRACTOR: ISymbolReferenceExtractor = {
  extractReferences: () => Promise.resolve([]),
};

/** Map-backed registry keyed by lower-cased language name. */
export class SymbolReferenceExtractorRegistry implements ISymbolReferenceExtractorRegistry {
  private readonly extractors = new Map<string, ISymbolReferenceExtractor>();

  register(language: string, extractor: ISymbolReferenceExtractor): void {
    this.extractors.set(language.toLowerCase(), extractor);
  }

  getForLanguage(language: string): ISymbolReferenceExtractor {
    return this.extractors.get(language.toLowerCase()) ?? EMPTY_SYMBOL_REFERENCE_EXTRACTOR;
  }
}

/** Builds the default (empty) registry. A paid edition fills it through the
 *  composer seam, so Solo and Team keep phase-175 behaviour. */
export function createDefaultSymbolReferenceExtractorRegistry(): ISymbolReferenceExtractorRegistry {
  return new SymbolReferenceExtractorRegistry();
}
