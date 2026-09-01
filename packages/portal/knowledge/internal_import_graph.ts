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

import { fromFileUrl, relative } from "@std/path";
import {
  DEFAULT_MAX_INTERNAL_GRAPH_ENTRYPOINTS,
  DENO_COMMAND,
  DENO_SUBCOMMAND_INFO,
  INTERNAL_IMPORT_GRAPH_TIMEOUT_MS,
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
            kind: "file_imports_file_internal",
          };
          edgesByKey.set(`${edge.from} ${edge.to}`, edge);
        }
      }
    }

    return { edges: [...edgesByKey.values()], droppedOutOfBounds: dropped, truncatedEntrypointCount };
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
