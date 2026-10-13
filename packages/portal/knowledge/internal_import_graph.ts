/**
 * @module InternalImportGraphBuilder
 * @path packages/portal/knowledge/internal_import_graph.ts
 * @description Builds the internal (relative-import) file-to-file graph for a portal
 * via `deno info --json`, using the same module-resolution approach as
 * `scripts/package_dependency_graph.ts`'s `runDenoInfo`. Only relative specifiers
 * become edges; any specifier resolving outside the portal root is dropped, never
 * emitted as an edge. Traces every entrypoint up to `DEFAULT_MAX_INTERNAL_GRAPH_ENTRYPOINTS`
 * (default 500) — any entrypoints beyond that limit are reported via
 * `truncatedEntrypointCount`, never silently dropped.
 * @architectural-layer Portal
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts, scripts/package_dependency_graph.ts]
 */

import { dirname, fromFileUrl, join, normalize, relative } from "@std/path";
import {
  DEFAULT_MAX_INTERNAL_GRAPH_ENTRYPOINTS,
  DENO_COMMAND,
  DENO_SUBCOMMAND_INFO,
  INTERNAL_IMPORT_GRAPH_TIMEOUT_MS,
  MODULE_DEPENDENCY_EDGE_KIND,
  SafeSubprocess,
} from "@exaix/core";
import type { IPortalKnowledgeRelationship } from "@exaix/schemas";

interface IDenoInfoDependency {
  specifier: string;
  code?: { specifier: string };
  type?: { specifier: string };
}

interface IDenoInfoModule {
  specifier: string;
  dependencies?: IDenoInfoDependency[];
}

interface IDenoInfoJson {
  modules: IDenoInfoModule[];
}

export interface IDroppedInternalImport {
  from: string;
  specifier: string;
}

export interface IInternalImportGraphResult {
  edges: IPortalKnowledgeRelationship[];
  droppedOutOfBounds: IDroppedInternalImport[];
  truncatedEntrypointCount: number;
}

const EMPTY_RESULT: IInternalImportGraphResult = { edges: [], droppedOutOfBounds: [], truncatedEntrypointCount: 0 };

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/** Converts a `file://` module specifier into a portal-root-relative path, or
 *  `undefined` if it resolves outside the portal root. */
function toPortalRelativePath(fileUrlSpecifier: string, portalRoot: string): string | undefined {
  if (!fileUrlSpecifier.startsWith("file://")) return undefined;
  let localPath: string;
  try {
    localPath = fromFileUrl(fileUrlSpecifier);
  } catch {
    return undefined;
  }
  const relativePath = relative(portalRoot, localPath);
  if (relativePath.startsWith("..") || relativePath === "") return undefined;
  return relativePath;
}

/** File names a Python module specifier may resolve to, in probe order. */
const PYTHON_MODULE_FILES: readonly string[] = ["__init__.py", "mod.py", "main.py"];

/**
 * Reads every module specifier a Python source imports.
 *
 * `from a.b import c` and `import a.b` both contribute `a.b`. A relative import
 * keeps its leading dots so the resolver can walk up from the importing file.
 */
export function parsePythonImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/^\s*from\s+([.\w]+)\s+import\s+/gm)) {
    if (match[1] && match[1] !== ".") specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) {
    for (const part of match[1].split(",")) {
      const moduleName = part.trim().split(/\s+as\s+/)[0].trim();
      if (moduleName.length > 0) specifiers.push(moduleName);
    }
  }
  return specifiers;
}

/** True when a path names a Python source file. */
function isPythonFile(file: string): boolean {
  return file.endsWith(".py");
}

/**
 * Resolves one Python specifier into a portal-relative file, or `undefined`.
 *
 * A dotted module path maps onto directories.
 * A package resolves to its `__init__.py`.
 * A relative import walks up from the importing file.
 * A result that would leave the portal is refused.
 */
async function resolvePythonSpecifier(
  portalRoot: string,
  fromFile: string,
  specifier: string,
): Promise<string | undefined> {
  const read = async (candidate: string): Promise<boolean> => {
    try {
      const stat = await Deno.stat(join(portalRoot, candidate));
      return stat.isFile;
    } catch {
      return false;
    }
  };

  if (specifier.startsWith(".")) {
    const up = specifier.match(/^\.+/)?.[0].length ?? 1;
    const rest = specifier.slice(up).replaceAll(".", "/");
    let base = dirname(fromFile);
    for (let step = 1; step < up; step++) base = dirname(base);
    const nested = normalize(join(base, rest));
    if (nested.startsWith("..") || nested.startsWith("/")) return undefined;
    for (const candidate of PYTHON_MODULE_FILES) {
      if (await read(join(nested, candidate))) return join(nested, candidate);
    }
    const direct = `${nested}.py`;
    return (await read(direct)) ? direct : undefined;
  }

  const base = normalize(specifier.replaceAll(".", "/"));
  if (base.startsWith("..") || base.startsWith("/")) return undefined;
  for (const candidate of PYTHON_MODULE_FILES) {
    if (await read(join(base, candidate))) return join(base, candidate);
  }
  const direct = `${base}.py`;
  return (await read(direct)) ? direct : undefined;
}

export class InternalImportGraphBuilder {
  constructor(private readonly _maxEntrypoints: number = DEFAULT_MAX_INTERNAL_GRAPH_ENTRYPOINTS) {}

  async build(portalPath: string, entrypoints: string[]): Promise<IInternalImportGraphResult> {
    if (entrypoints.length === 0) return EMPTY_RESULT;

    // deno info reports realpath'd specifiers; portalPath is normally a symlink
    // (Portals/<alias>), so comparing unresolved vs realpath'd emptied every edge.
    const resolvedPortalPath = await Deno.realPath(portalPath).catch(() => portalPath);

    const edgesByKey = new Map<string, IPortalKnowledgeRelationship>();
    const dropped: IDroppedInternalImport[] = [];
    const tracedEntrypoints = entrypoints.slice(0, this._maxEntrypoints);
    const truncatedEntrypointCount = entrypoints.length - tracedEntrypoints.length;

    for (const entrypoint of tracedEntrypoints) {
      if (isPythonFile(entrypoint)) {
        await this._collectPythonEdges(resolvedPortalPath, entrypoint, edgesByKey);
        continue;
      }

      const info = await this._runDenoInfo(resolvedPortalPath, entrypoint);
      if (!info) continue;

      for (const module of info.modules) {
        const fromPath = toPortalRelativePath(module.specifier, resolvedPortalPath);
        if (!fromPath) continue;

        for (const dep of module.dependencies ?? []) {
          if (!isRelativeSpecifier(dep.specifier)) continue;
          // "import type" specifiers report only a `type` key, never `code`; prefer
          // `code` when both are present so a mixed value+type import isn't double-counted.
          const resolvedSpecifier = dep.code?.specifier ?? dep.type?.specifier;
          if (!resolvedSpecifier) continue;

          const toPath = toPortalRelativePath(resolvedSpecifier, resolvedPortalPath);
          if (!toPath) {
            dropped.push({ from: fromPath, specifier: dep.specifier });
            continue;
          }

          const edge: IPortalKnowledgeRelationship = {
            from: fromPath,
            to: toPath,
            kind: MODULE_DEPENDENCY_EDGE_KIND,
          };
          edgesByKey.set(`${edge.from} ${edge.to}`, edge);
        }
      }
    }

    return { edges: [...edgesByKey.values()], droppedOutOfBounds: dropped, truncatedEntrypointCount };
  }

  /**
   * Collects Python import edges by walking the local import closure.
   *
   * `deno info` cannot resolve Python, so the graph is built from the source's
   * own import statements. Only files inside the portal are followed, which
   * bounds the walk to the portal's own tree.
   */
  private async _collectPythonEdges(
    portalRoot: string,
    entrypoint: string,
    edgesByKey: Map<string, IPortalKnowledgeRelationship>,
  ): Promise<void> {
    const queue: string[] = [entrypoint];
    const visited = new Set<string>();
    const startedAt = Date.now();

    while (queue.length > 0) {
      if (Date.now() - startedAt >= INTERNAL_IMPORT_GRAPH_TIMEOUT_MS) break;
      const from = queue.shift();
      if (!from || visited.has(from)) continue;
      visited.add(from);

      let source: string;
      try {
        source = await Deno.readTextFile(join(portalRoot, from));
      } catch {
        continue;
      }

      for (const specifier of parsePythonImportSpecifiers(source)) {
        const to = await resolvePythonSpecifier(portalRoot, from, specifier);
        if (!to) continue;
        edgesByKey.set(`${from} ${to}`, {
          from,
          to,
          kind: MODULE_DEPENDENCY_EDGE_KIND,
        });
        if (!visited.has(to)) queue.push(to);
      }
    }
  }

  private async _runDenoInfo(portalPath: string, entrypoint: string): Promise<IDenoInfoJson | undefined> {
    try {
      const { code, stdout } = await SafeSubprocess.run(DENO_COMMAND, [DENO_SUBCOMMAND_INFO, "--json", entrypoint], {
        cwd: portalPath,
        timeoutMs: INTERNAL_IMPORT_GRAPH_TIMEOUT_MS,
      });
      if (code !== 0) return undefined;
      return JSON.parse(stdout) as IDenoInfoJson;
    } catch {
      return undefined;
    }
  }
}
