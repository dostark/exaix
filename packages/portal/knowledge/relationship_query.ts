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
import {
  EDGE_DEDUP_KEY_SEPARATOR,
  MODULE_DEPENDENCY_EDGE_KIND,
  SYMBOL_REF_ID_SEPARATOR,
  type SYMBOL_REFERENCE_EDGE_KIND,
} from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

export type RelationshipEdgeKind =
  | "layer_contains_file"
  | "file_imports_file_internal"
  | typeof SYMBOL_REFERENCE_EDGE_KIND;

export interface IRelationshipEdge {
  from: string;
  to: string;
  kind: RelationshipEdgeKind;
}

/** A persisted edge kind. `layer_contains_file` is derived, never stored. */
export type PersistedRelationshipEdgeKind =
  | "file_imports_file_internal"
  | typeof SYMBOL_REFERENCE_EDGE_KIND;

/** An edge that can be persisted in `IPortalKnowledge.relationships`. */
export interface IPersistedRelationshipEdge {
  from: string;
  to: string;
  kind: PersistedRelationshipEdgeKind;
}

/** The edge kind `traverseModuleDependencies` walks.
 *  Symbol-level edges are not module dependencies.
 *  A BFS over them would fabricate hops through composite keys. */
/** Builds a `symbol_references_symbol` endpoint (`<file>#<symbolName>`).
 *  This is the only sanctioned way to construct a composite key.
 *  Never concatenate the separator directly. */
export function encodeSymbolRef(file: string, name: string): string {
  return `${file}${SYMBOL_REF_ID_SEPARATOR}${name}`;
}

/** Reads a `symbol_references_symbol` endpoint. It splits on the last separator.
 *  The tail is the name, so a name that contains a separator still decodes. File paths never contain the separator in practice.
 *  Returns `undefined` when no separator is present or nothing precedes it. */
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
/** Merges edge arrays into one list, deduplicated on `from`, `to` and `kind`. The first occurrence wins, so the Solo builder's ordering is preserved.
 *  Callers reuse the result both as the persisted relationships and as the reference extractor input. */
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

/** Breadth-first traversal of persisted `file_imports_file_internal` edges, forward. Each node is visited once, so cycles end.
 *  Each hop's edges sort by `from` then `to` for deterministic output. Symbol-level edges are never walked. */
export function traverseModuleDependencies(
  knowledge: IPortalKnowledge,
  from: string,
  maxDepth: number,
): IRelationshipEdge[] {
  const fileEdges = ((knowledge.relationships ?? []) as IRelationshipEdge[])
    .filter((edge) => edge.kind === MODULE_DEPENDENCY_EDGE_KIND);
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
