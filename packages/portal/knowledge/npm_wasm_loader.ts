/**
 * @module NpmWasmLoader
 * @path packages/portal/knowledge/npm_wasm_loader.ts
 * @description Resolves WASM files bundled in npm packages (tree-sitter grammars and core runtime)
 * using import.meta.resolve, with a fallback to the global npm cache. All resolution is local —
 * no network access at runtime.
 * @architectural-layer Portal
 * @related-files [packages/portal/knowledge/tree_sitter_symbol_extractor.ts]
 */

/** Resolve the local file path for a WASM specifier (e.g. "npm:web-tree-sitter/web-tree-sitter.wasm"). */
export function resolveNpmWasmPath(specifier: string): string {
  const url = import.meta.resolve(specifier);
  if (typeof url === "string" && url.startsWith("file://")) {
    return new URL(url).pathname;
  }
  return resolveNpmFallback(specifier);
}

/** Resolve a package file from the npm cache using known package name, version, and filename. */
export function resolveNpmPackageFile(
  packageName: string,
  version: string,
  filename: string,
): string {
  const specifier = `npm:${packageName}/${filename}`;
  const url = import.meta.resolve(specifier);
  if (typeof url === "string" && url.startsWith("file://")) {
    return new URL(url).pathname;
  }
  return npmCachePath(packageName) + `/${version}/${filename}`;
}

/** web-tree-sitter.wasm resolves to file:// even when others don't — used as the
 *  known-good reference for the npm global cache root. */
function npmCachePath(packageName: string): string {
  const refUrl = import.meta.resolve(
    "npm:web-tree-sitter/web-tree-sitter.wasm",
  );
  if (typeof refUrl === "string" && refUrl.startsWith("file://")) {
    const refPath = new URL(refUrl).pathname;
    const parts = refPath.split("/");
    parts.pop(); // web-tree-sitter.wasm
    parts.pop(); // version
    parts.pop(); // web-tree-sitter
    return parts.join("/") + "/" + packageName;
  }
  const home = Deno.env.get("HOME") ?? "/root";
  return `${home}/.cache/deno/npm/registry.npmjs.org/${packageName}`;
}

function resolveNpmFallback(specifier: string): string {
  // specifier: "npm:package/file.wasm"
  const pathPart = specifier.replace(/^npm:/, "");
  // pathPart: "package/file.wasm" — missing version, so scan cache
  const [pkgName] = pathPart.split("/");
  const cacheDir = npmCachePath(pkgName);
  // Scan for the version with the highest semver
  try {
    const versions: string[] = [];
    for (const entry of Deno.readDirSync(cacheDir)) {
      if (entry.isDirectory) versions.push(entry.name);
    }
    versions.sort();
    const latest = versions[versions.length - 1];
    if (latest) {
      return cacheDir + "/" + latest + "/" + pathPart.replace(/^[^/]+\//, "");
    }
  } catch {
    // fall through
  }
  return cacheDir + "/" + pathPart.replace(/^[^/]+\//, "");
}
