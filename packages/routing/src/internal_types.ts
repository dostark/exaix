/**
 * @module RoutingInternalTypes
 * @path packages/routing/src/internal_types.ts
 * @related-files []
 * @architectural-layer Services
 * @description Internal types for routing subpackage consumers (IBlueprintLoader, ILoadedBlueprint, IBucketRule).
 */
import type { JSONValue } from "@exaix/core";

export interface ILoadedBlueprint {
  identityId: string;
  version: string;
  capabilities: string[];
  frontmatter: { deprecated?: boolean; [key: string]: JSONValue | object };
}

export interface IBlueprintLoader {
  listAll(): Promise<ILoadedBlueprint[]>;
}
