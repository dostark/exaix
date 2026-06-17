/**
 * @module RustSymbolExtractor
 * @path packages-team/portal-extractors/src/rust_symbol_extractor.ts
 * @ungrounded
 * @description Rust ISymbolExtractor using tree-sitter grammar and a custom .scm query.
 * Maps function_item→function, struct_item→class, enum_item→enum, trait_item→interface,
 * type_item→type, const_item/static_item→const, impl methods→function.
 * Team edition — gated by CAP_EXTENDED_LANG_EXTRACTION.
 * @architectural-layer Portal
 * @dependencies [npm:tree-sitter-rust]
 * @related-files [packages-team/portal-extractors/src/portal_extractors_module.ts]
 */

import type { QueryMatch } from "web-tree-sitter";
import { TreeSitterSymbolExtractor } from "@exaix/portal/knowledge";
import type { ISymbolEntry } from "@exaix/schemas";
import {
  SYM_DEF_PREFIX,
  SYM_KIND_CLASS,
  SYM_KIND_CONST,
  SYM_KIND_ENUM,
  SYM_KIND_FUNCTION,
  SYM_KIND_INTERFACE,
  SYM_KIND_TYPE,
  SYM_NAME_CAPTURE,
} from "@exaix/portal/knowledge";

const RUST_QUERY = `
(function_item name: (identifier) @name) @definition.function
(struct_item name: (type_identifier) @name) @definition.class
(enum_item name: (type_identifier) @name) @definition.enum
(trait_item name: (type_identifier) @name) @definition.interface
(type_item name: (type_identifier) @name) @definition.type
(const_item name: (identifier) @name) @definition.const
(static_item name: (identifier) @name) @definition.const
(declaration_list (function_item name: (identifier) @name) @definition.method)
`;

const CAPTURE_KIND: Record<string, ISymbolEntry["kind"]> = {
  [`${SYM_DEF_PREFIX}function`]: SYM_KIND_FUNCTION,
  [`${SYM_DEF_PREFIX}class`]: SYM_KIND_CLASS,
  [`${SYM_DEF_PREFIX}enum`]: SYM_KIND_ENUM,
  [`${SYM_DEF_PREFIX}interface`]: SYM_KIND_INTERFACE,
  [`${SYM_DEF_PREFIX}type`]: SYM_KIND_TYPE,
  [`${SYM_DEF_PREFIX}const`]: SYM_KIND_CONST,
  [`${SYM_DEF_PREFIX}method`]: SYM_KIND_FUNCTION,
};

export class RustSymbolExtractor extends TreeSitterSymbolExtractor {
  protected readonly languageName = "rust";
  protected readonly grammarWasmSpecifier = "npm:tree-sitter-rust/tree-sitter-rust.wasm";
  protected readonly grammarNpmName = "tree-sitter-rust";
  protected readonly grammarVersion = "0.24.0";
  protected readonly grammarWasmFilename = "tree-sitter-rust.wasm";

  protected scmQuerySource(): string {
    return RUST_QUERY;
  }

  protected processMatch(match: QueryMatch, file: string): ISymbolEntry[] {
    const defCap = match.captures.find((c) => c.name.startsWith(SYM_DEF_PREFIX));
    const nameCap = match.captures.find((c) => c.name === SYM_NAME_CAPTURE);
    if (!defCap || !nameCap) return [];
    const kind = CAPTURE_KIND[defCap.name];
    if (!kind) return [];
    const name = nameCap.node.text;
    const signature = this._buildSignature(defCap.node.text, name);
    const doc = this._extractDocComment(defCap.node.text);
    return [{ name, kind, file, signature, ...(doc ? { doc } : {}) }];
  }

  protected extractImports(source: string): string[] {
    const imports: string[] = [];
    for (const line of source.split("\n")) {
      const m = line.trim().match(/^use\s+([a-zA-Z_][\w:]*(?:::[\w*{}]+)?)/);
      if (m) {
        // Extract the crate/first segment
        const first = m[1].split("::")[0];
        imports.push(first);
      }
    }
    return imports;
  }

  private _buildSignature(nodeText: string, _name: string): string {
    const first = nodeText.split("\n")[0].trim();
    if (first.includes("fn ")) return first;
    return first;
  }

  private _extractDocComment(nodeText: string): string | undefined {
    const lines = nodeText.split("\n");
    const docLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("///")) {
        docLines.push(trimmed.replace(/^\/\/\/\s?/, "").trim());
      }
    }
    if (docLines.length > 0) return docLines.join(" ");
    const m = nodeText.match(/\/\*\*([\s\S]*?)\*\//);
    if (m) {
      return m[1].split("\n").map((l) => l.trim().replace(/^\s*\*\s?/, ""))
        .filter(Boolean).join(" ");
    }
    return undefined;
  }
}
