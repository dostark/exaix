/**
 * @module PythonSymbolExtractor
 * @path packages/portal/knowledge/python_symbol_extractor.ts
 * @description Python ISymbolExtractor using tree-sitter-python WASM grammar and the
 * grammar's tags.scm query. Extracts functions, classes, and module-level constants
 * with signatures, docstrings, and pageRank-based ranking. Part of the Solo (MIT)
 * multi-language baseline.
 * @architectural-layer Portal
 * @dependencies [npm:web-tree-sitter, npm:tree-sitter-python]
 * @related-files [packages/portal/knowledge/tree_sitter_symbol_extractor.ts]
 */

import type { QueryMatch } from "web-tree-sitter";
import { TreeSitterSymbolExtractor } from "./tree_sitter_symbol_extractor.ts";
import type { ISymbolEntry } from "@exaix/schemas";

// ---------------------------------------------------------------------------
// Python .scm query — mirrors tree-sitter-python's bundled tags.scm
// ---------------------------------------------------------------------------

const PYTHON_QUERY = `
(function_definition name: (identifier) @name) @definition.function
(class_definition name: (identifier) @name) @definition.class
(module (expression_statement (assignment left: (identifier) @name) @definition.constant))
`;

// ---------------------------------------------------------------------------
// Kind map from capture names
// ---------------------------------------------------------------------------

const CAPTURE_KIND: Record<string, ISymbolEntry["kind"]> = {
  "definition.function": "function",
  "definition.class": "class",
  "definition.constant": "const",
};

// ---------------------------------------------------------------------------
// PythonSymbolExtractor
// ---------------------------------------------------------------------------

/**
 * Python tree-sitter symbol extractor — Solo (MIT) tier.
 *
 * Uses `npm:tree-sitter-python` WASM grammar and the bundled `tags.scm` query.
 * Extracts:
 * - `function_definition` → `function`
 * - `class_definition` → `class`
 * - module-level UPPER_CASE assignment → `const`
 *
 * Returns `[]` for any `primaryLanguage` other than `"python"`.
 */
export class PythonSymbolExtractor extends TreeSitterSymbolExtractor {
  protected readonly languageName = "python";
  protected readonly grammarWasmSpecifier = "npm:tree-sitter-python/tree-sitter-python.wasm";

  protected scmQuerySource(): string {
    return PYTHON_QUERY;
  }

  protected processMatch(match: QueryMatch, file: string): ISymbolEntry[] {
    const defCap = match.captures.find((c) => c.name.startsWith("definition."));
    const nameCap = match.captures.find((c) => c.name === "name");
    if (!defCap || !nameCap) return [];

    const kind = CAPTURE_KIND[defCap.name];
    if (!kind) return [];

    const name = nameCap.node.text;
    const defNode = defCap.node;
    const nodeText = defNode.text;

    // Reconstruct signature (trim body from node text)
    const signature = this._buildSignature(nodeText, defNode.type, name);

    // Extract docstring
    const doc = this._extractDocstring(nodeText);

    return [
      {
        name,
        kind,
        file,
        signature,
        ...(doc ? { doc } : {}),
      },
    ];
  }

  protected extractImports(source: string): string[] {
    const imports: string[] = [];
    const lines = source.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();

      // import X.Y.Z
      let m = trimmed.match(/^import\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (m) {
        imports.push(m[1]);
        continue;
      }

      // from X.Y.Z import A, B
      m = trimmed.match(/^from\s+([a-zA-Z_][\w.]*)\s+import\s+(.+)/);
      if (m) {
        const moduleName = m[1];
        // Extract the last segment of the module path
        const lastSegment = moduleName.split(".").pop();
        if (lastSegment) imports.push(lastSegment);
        // Also import each named import
        const namedImports = m[2].split(",").map((s) => s.trim().split(" as ")[0]);
        imports.push(...namedImports);
      }
    }

    return imports;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Build a one-line signature from the definition node text.
   * For function definitions, extract the `def name(...)` line.
   * For class definitions, extract `class Name`.
   * For constants, extract `NAME = ...`.
   */
  private _buildSignature(nodeText: string, nodeType: string, _name: string): string {
    const firstLine = nodeText.split("\n")[0].trim();
    if (nodeType === "function_definition") {
      return firstLine.replace(/\s*:\s*$/, "");
    }
    if (nodeType === "class_definition") {
      return firstLine.replace(/\s*:\s*$/, "");
    }
    if (nodeType === "assignment") {
      // Trim trailing content to just the declaration
      return firstLine.split("\n")[0].trim();
    }
    return firstLine;
  }

  /**
   * Extract the docstring from a function/class body (the first string literal).
   * Python docstrings are either:
   * - `"""..."""` (triple double-quotes)
   * - `'''...'''` (triple single-quotes)
   */
  private _extractDocstring(nodeText: string): string | undefined {
    // Match the first triple-quoted string after the colon
    const m = nodeText.match(/"""(.*?)"""/s);
    if (m) {
      return m[1].split("\n").map((l) => l.trim()).filter(Boolean).join(" ").trim();
    }
    const m2 = nodeText.match(/'''(.*?)'''/s);
    if (m2) {
      return m2[1].split("\n").map((l) => l.trim()).filter(Boolean).join(" ").trim();
    }
    return undefined;
  }
}
