/**
 * @module RelationshipQuery
 * @path packages/portal/knowledge/relationship_query.ts
 * @description Relationship-traversal query surface: combines the persisted
 * `file_imports_file_internal` edges (`IPortalKnowledge.relationships`) with
 * `layer_contains_file` edges derived on demand from `layers`/`packages[].layers`
 * (never persisted — zero-cost derivation, so it can't go stale). Pure, in-memory
 * traversal only; no new storage engine or database.
 * @architectural-layer Portal
 * @related-files [packages/portal/knowledge/portal_knowledge_service.ts, packages/schemas/src/portal_knowledge.ts]
 */

import type { IArchitectureLayer, IPortalKnowledge } from "@exaix/schemas";
import type { Opt, Reason } from "@exaix/core/types";

export type RelationshipEdgeKind = "layer_contains_file" | "file_imports_file_internal";

export interface IRelationshipEdge {
  from: string;
  to: string;
  kind: RelationshipEdgeKind;
}

function edgesFromLayer(layer: IArchitectureLayer): IRelationshipEdge[] {
  return layer.keyFiles.map((file) => ({ from: layer.name, to: file, kind: "layer_contains_file" as const }));
}

/** Derives `layer_contains_file` edges from `layers` and each `packages[].layers` entry —
 *  never persisted; always freshly computed from whatever knowledge is passed in. */
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
