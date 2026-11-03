/**
 * @module RoutingInternalTypes
 * @path packages/routing/src/internal_types.ts
 * @related-files []
 * @architectural-layer Services
 * @description Internal types for routing subpackage consumers (IBlueprintLoader, ILoadedBlueprint, IBucketRule).
 */
/** The blueprint frontmatter fields that routing reads. */
interface IRoutingFrontmatter {
  deprecated?: boolean;
  routing_prefer_local?: boolean;
  language?: string;
  lang?: string;
  task_type?: string;
  taskType?: string;
  portal_type?: string;
  portalType?: string;
  description?: string;
  routing_hint?: string;
}

export interface ILoadedBlueprint {
  agentRole: string;
  version: string;
  capabilities: string[];
  frontmatter: IRoutingFrontmatter;
}

export interface IBlueprintLoader {
  listAll(): Promise<ILoadedBlueprint[]>;
}
