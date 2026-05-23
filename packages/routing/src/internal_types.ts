/**
 * @module RoutingInternalTypes
 * @path packages/routing/src/internal_types.ts
 * @related-files []
 * @architectural-layer Services
 * @description Internal types for routing subpackage consumers (BlueprintLoader, ILoadedBlueprint, IBucketRule).
 */
import type { JSONValue } from "@exaix/core";

export interface ILoadedBlueprint {
  identityId: string;
  version: string;
  capabilities: string[];
  frontmatter: { deprecated?: boolean; [key: string]: JSONValue };
}

export interface BlueprintLoader {
  listAll(): Promise<ILoadedBlueprint[]>;
}
