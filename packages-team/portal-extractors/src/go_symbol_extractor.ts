/**
 * @module GoSymbolExtractor
 * @path packages-team/portal-extractors/src/go_symbol_extractor.ts
 * @ungrounded
 * @description Go ISymbolExtractor using tree-sitter grammar and a custom .scm query.
 * Maps function_declaration/method_declaration→function, type_spec with struct→class,
 * type_spec with interface→interface, type_spec else→type, const_declaration→const.
 * Team edition — gated by CAP_EXTENDED_LANG_EXTRACTION.
 * @architectural-layer Portal
 * @dependencies [npm:tree-sitter-go]
 */

import type { QueryMatch } from "web-tree-sitter";
import { TreeSitterSymbolExtractor } from "@exaix/portal/knowledge";
import type { ISymbolEntry } from "@exaix/schemas";
import {
  SYM_DEF_PREFIX,
  SYM_KIND_CLASS,
  SYM_KIND_CONST,
  SYM_KIND_FUNCTION,
  SYM_KIND_INTERFACE,
  SYM_NAME_CAPTURE,
} from "@exaix/portal/knowledge";

const GO_QUERY = `
(function_declaration name: (identifier) @name) @definition.function
(method_declaration name: (field_identifier) @name) @definition.method
(type_declaration (type_spec name: (type_identifier) @name type: (struct_type))) @definition.class
(type_declaration (type_spec name: (type_identifier) @name type: (interface_type))) @definition.interface
(const_declaration (const_spec name: (identifier) @name)) @definition.const
`;

const CAPTURE_KIND: Record<string, ISymbolEntry["kind"]> = {
  [`${SYM_DEF_PREFIX}function`]: SYM_KIND_FUNCTION,
  [`${SYM_DEF_PREFIX}method`]: SYM_KIND_FUNCTION,
  [`${SYM_DEF_PREFIX}class`]: SYM_KIND_CLASS,
  [`${SYM_DEF_PREFIX}interface`]: SYM_KIND_INTERFACE,
  [`${SYM_DEF_PREFIX}const`]: SYM_KIND_CONST,
};

export class GoSymbolExtractor extends TreeSitterSymbolExtractor {
  protected readonly languageName = "go";
  protected readonly grammarWasmSpecifier =
    "npm:tree-sitter-go/tree-sitter-go.wasm";
  protected readonly grammarNpmName = "tree-sitter-go";
  protected readonly grammarVersion = "0.25.0";
  protected readonly grammarWasmFilename = "tree-sitter-go.wasm";

  protected scmQuerySource(): string {
    return GO_QUERY;
  }

  protected processMatch(match: QueryMatch, file: string): ISymbolEntry[] {
    const defCap = match.captures.find((c) =>
      c.name.startsWith(SYM_DEF_PREFIX)
    );
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
      const m = line.trim().match(/^import\s+"([^"]+)"/);
      if (m) {
        const last = m[1].split("/").pop();
        if (last) imports.push(last);
      }
      // Multiline import: "pkg"
      const m2 = line.trim().match(/^\s*"([^"]+)"$/);
      if (m2) {
        const last = m2[1].split("/").pop();
        if (last) imports.push(last);
      }
    }
    return imports;
  }

  private _buildSignature(nodeText: string, _name: string): string {
    return nodeText.split("\n")[0].trim();
  }

  private _extractDocComment(nodeText: string): string | undefined {
    const lines = nodeText.split("\n");
    const beforeDef: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//")) {
        beforeDef.push(trimmed.replace(/^\/\/\s?/, "").trim());
      }
    }
    if (beforeDef.length > 0) return beforeDef.join(" ");
    return undefined;
  }
}
