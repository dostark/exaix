/**
 * @module SymbolExtractionConstants
 * @path packages/portal/knowledge/symbol_extraction_constants.ts
 * @description Shared constants for tree-sitter-based symbol extraction across all languages.
 * Avoids magic-value violations by centralizing capture names and kind strings.
 * @architectural-layer Portal
 * @related-files []
 */

/** Capture name used in .scm queries for symbol identifiers. */
export const SYM_NAME_CAPTURE = "name";
/** Capture prefix for definitions. */
export const SYM_DEF_PREFIX = "definition.";
/** Kind mapping for capture → ISymbolEntry.kind */
export const SYM_KIND_FUNCTION = "function";
export const SYM_KIND_CLASS = "class";
export const SYM_KIND_INTERFACE = "interface";
export const SYM_KIND_ENUM = "enum";
export const SYM_KIND_TYPE = "type";
export const SYM_KIND_CONST = "const";
