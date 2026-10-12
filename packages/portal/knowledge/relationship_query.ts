/**
 * @module RelationshipQuery
 * @path packages/portal/knowledge/relationship_query.ts
 * @description Relationship-traversal query surface: combines the persisted
 * `file_imports_file_internal` and `symbol_references_symbol` edges
 * (`IPortalKnowledge.relationships`) with `layer_contains_file` edges derived on
 * demand from `layers`/`packages[].layers` (never persisted — zero-cost derivation,
 * so it can't go stale). Pure, in-memory traversal only; no new storage engine or
 * database.
 * @architectural-layer Portal
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts, packages/schemas/src/portal_knowledge.ts]
 */

import type { IArchitectureLayer, IPortalKnowledge } from "@exaix/schemas";
import { EDGE_DEDUP_KEY_SEPARATOR, SYMBOL_REF_ID_SEPARATOR } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

export type RelationshipEdgeKind =
  | "layer_contains_file"
  | "file_imports_file_internal"
  | "symbol_references_symbol";

export interface IRelationshipEdge {
  from: string;
  to: string;
  kind: RelationshipEdgeKind;
}

/** A persisted edge kind. `layer_contains_file` is derived, never stored. */
export type PersistedRelationshipEdgeKind =
  | "file_imports_file_internal"
  | "symbol_references_symbol";

/** An edge that can be persisted in `IPortalKnowledge.relationships`. */
export interface IPersistedRelationshipEdge {
  from: string;
  to: string;
  kind: PersistedRelationshipEdgeKind;
}

/** The edge kind `traverseModuleDependencies` walks.
 *  Symbol-level edges are not module dependencies.
 *  A BFS over them would fabricate hops through composite keys. */
export const MODULE_DEPENDENCY_EDGE_KIND = "file_imports_file_internal" as const;

/** Builds a `symbol_references_symbol` endpoint (`<file>#<symbolName>`).
 *  This is the only sanctioned way to construct a composite key.
 *  Never concatenate the separator directly. */
export function encodeSymbolRef(file: string, name: string): string {
  return `${file}${SYMBOL_REF_ID_SEPARATOR}${name}`;
}

/**
 * Reads a `symbol_references_symbol` endpoint.
 *
 * Splits on the LAST separator and attributes the tail to the name.
 * A name that itself contains a separator therefore still decodes.
 * File paths never contain the separator in practice, so the contract is total.
 * A separator on both sides decodes without throwing.
 * Returns `undefined` when no separator is present, or when nothing precedes it.
 */
export function decodeSymbolRef(ref: string): { file: string; name: string } | undefined {
  const index = ref.lastIndexOf(SYMBOL_REF_ID_SEPARATOR);
  if (index <= 0) return undefined;
  return { file: ref.slice(0, index), name: ref.slice(index + SYMBOL_REF_ID_SEPARATOR.length) };
}

function edgesFromLayer(layer: IArchitectureLayer): IRelationshipEdge[] {
  return layer.keyFiles.map((file) => ({ from: layer.name, to: file, kind: "layer_contains_file" as const }));
}

/** Derives `layer_contains_file` edges from `layers` and each `packages[].layers` entry —
 *  never persisted; always freshly computed from whatever knowledge is passed in. */
/**
 * Merges edge arrays into one list, deduplicated on `from`, `to`, and `kind`.
 *
 * The first occurrence wins, so the Solo builder's ordering is preserved.
 * A later array can only add edges the earlier ones did not already carry.
 * Callers reuse the returned array as the persisted relationships.
 * They also pass it as the reference extractor input.
 * One array therefore serves both roles.
 */
export function mergeRelationships(
  edgeGroups: ReadonlyArray<ReadonlyArray<IPersistedRelationshipEdge>>,
): IPersistedRelationshipEdge[] {
  const seen = new Set<string>();
  const merged: IPersistedRelationshipEdge[] = [];
  for (const group of edgeGroups) {
    for (const edge of group) {
      const key = `${edge.from}${EDGE_DEDUP_KEY_SEPARATOR}${edge.to}${EDGE_DEDUP_KEY_SEPARATOR}${edge.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(edge);
    }
  }
  return merged;
}

export function deriveLayerContainsFileEdges(knowledge: IPortalKnowledge): IRelationshipEdge[] {
  const edges: IRelationshipEdge[] = [];
  for (const layer of knowledge.layers) {
    edges.push(...edgesFromLayer(layer));
  }
  for (const pkg of knowledge.packages ?? []) {
    for (const layer of pkg.layers) {
      edges.push(...edgesFromLayer(layer));
    }
  }
  return edges;
}

function allEdges(knowledge: IPortalKnowledge): IRelationshipEdge[] {
  return [...(knowledge.relationships ?? []), ...deriveLayerContainsFileEdges(knowledge)];
}

/** Returns edges reachable forward from `from`, optionally filtered by `kind`. */
export function queryRelationships(
  knowledge: IPortalKnowledge,
  from: string,
  kind?: Opt<RelationshipEdgeKind, Reason.QueryFilter>,
): IRelationshipEdge[] {
  return allEdges(knowledge).filter((edge) => edge.from === from && (kind === undefined || edge.kind === kind));
}

/** Returns edges pointing into `path` — the files/layers that depend on it. */
export function whoDependsOn(knowledge: IPortalKnowledge, path: string): IRelationshipEdge[] {
  return allEdges(knowledge).filter((edge) => edge.to === path);
}

/**
 * Breadth-first traverses persisted `file_imports_file_internal` edges forward.
 *
 * Each node is visited at most once, so cycles terminate naturally.
 * Each hop's edges are sorted by `from` then `to` for deterministic output.
 * `kind` defaults to the module-dependency edge kind.
 * A symbol-level edge is therefore never walked.
 */
export function traverseModuleDependencies(
  knowledge: IPortalKnowledge,
  from: string,
  maxDepth: number,
  kind: RelationshipEdgeKind = MODULE_DEPENDENCY_EDGE_KIND,
): IRelationshipEdge[] {
  const fileEdges = ((knowledge.relationships ?? []) as IRelationshipEdge[])
    .filter((edge) => edge.kind === kind);
  const visited = new Set<string>([from]);
  const result: IRelationshipEdge[] = [];
  let frontier = [from];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const hopEdges = fileEdges
      .filter((edge) => frontier.includes(edge.from) && !visited.has(edge.to))
      .sort((a, b) => a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from));
    const nextFrontier: string[] = [];
    for (const edge of hopEdges) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      result.push(edge);
      nextFrontier.push(edge.to);
    }
    frontier = nextFrontier;
  }
  return result;
}
