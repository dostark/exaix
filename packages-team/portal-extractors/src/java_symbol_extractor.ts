/**
 * @module JavaSymbolExtractor
 * @path packages-team/portal-extractors/src/java_symbol_extractor.ts
 * @ungrounded
 * @description Java ISymbolExtractor using tree-sitter grammar and a custom .scm query.
 * Maps class_declaration/record_declaration→class, interface_declaration/annotation_type_declaration→interface,
 * enum_declaration→enum, method_declaration/constructor_declaration→function.
 * Team edition — gated by CAP_EXTENDED_LANG_EXTRACTION.
 * @architectural-layer Portal
 * @dependencies [npm:tree-sitter-java]
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
  SYM_NAME_CAPTURE,
} from "@exaix/portal/knowledge";

const JAVA_QUERY = `
(class_declaration name: (identifier) @name) @definition.class
(record_declaration name: (identifier) @name) @definition.class
(interface_declaration name: (identifier) @name) @definition.interface
(annotation_type_declaration name: (identifier) @name) @definition.interface
(enum_declaration name: (identifier) @name) @definition.enum
(method_declaration name: (identifier) @name) @definition.method
(constructor_declaration name: (identifier) @name) @definition.method
(field_declaration (variable_declarator name: (identifier) @name) @definition.const)
`;

const CAPTURE_KIND: Record<string, ISymbolEntry["kind"]> = {
  [`${SYM_DEF_PREFIX}class`]: SYM_KIND_CLASS,
  [`${SYM_DEF_PREFIX}interface`]: SYM_KIND_INTERFACE,
  [`${SYM_DEF_PREFIX}enum`]: SYM_KIND_ENUM,
  [`${SYM_DEF_PREFIX}method`]: SYM_KIND_FUNCTION,
  [`${SYM_DEF_PREFIX}const`]: SYM_KIND_CONST,
};

export class JavaSymbolExtractor extends TreeSitterSymbolExtractor {
  protected readonly languageName = "java";
  protected readonly grammarWasmSpecifier =
    "npm:tree-sitter-java/tree-sitter-java.wasm";
  protected readonly grammarNpmName = "tree-sitter-java";
  protected readonly grammarVersion = "0.23.5";
  protected readonly grammarWasmFilename = "tree-sitter-java.wasm";

  protected scmQuerySource(): string {
    return JAVA_QUERY;
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
    const doc = this._extractJavadoc(defCap.node.text);
    return [{ name, kind, file, signature, ...(doc ? { doc } : {}) }];
  }

  protected extractImports(source: string): string[] {
    const imports: string[] = [];
    for (const line of source.split("\n")) {
      const m = line.trim().match(/^import\s+([a-zA-Z_][\w.]*(?:\.\*)?);\s*$/);
      if (m) {
        const parts = m[1].replace(".*", "").split(".");
        const last = parts.pop();
        if (last) imports.push(last);
      }
    }
    return imports;
  }

  private _buildSignature(nodeText: string, _name: string): string {
    return nodeText.split("\n")[0].trim();
  }

  private _extractJavadoc(nodeText: string): string | undefined {
    const m = nodeText.match(/\/\*\*([\s\S]*?)\*\//);
    if (m) {
      return m[1].split("\n")
        .map((l) => l.trim().replace(/^\s*\*\s?/, ""))
        .filter(Boolean)
        .join(" ")
        .trim();
    }
    return undefined;
  }
}
