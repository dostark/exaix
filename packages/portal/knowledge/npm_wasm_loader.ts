/**
 * @module NpmWasmLoader
 * @path packages/portal/knowledge/npm_wasm_loader.ts
 * @description Resolves WASM files bundled in npm packages (tree-sitter grammars and core runtime)
 * using import.meta.resolve, so they can be loaded from local disk with no network access.
 * @architectural-layer Portal
 * @related-files [packages/portal/knowledge/tree_sitter_symbol_extractor.ts]
 */

/** Resolve the local file path for a WASM file bundled in an npm package. */
export function resolveNpmWasmPath(specifier: string): string {
  const url = import.meta.resolve(specifier);
  if (typeof url !== "string" || !url.startsWith("file://")) {
    throw new Error(
      `Cannot resolve npm WASM specifier "${specifier}" to a local file path`,
    );
  }
  return new URL(url).pathname;
}
