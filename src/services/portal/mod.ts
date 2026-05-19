/**
 * @module PortalServicesIndex
 * @path src/services/portal/mod.ts
 * @description Barrel export for portal and workspace service modules.
 * All sources have been migrated to @exaix/portal. This barrel re-exports for compatibility.
 * @architectural-layer Services
 * @related-files [packages/portal/src/]
 */

export {
  type IPathResolverConfig,
  type IWorkspaceExecutionContext,
  PathResolver,
  PortalPermissionsService,
  PortalService,
  WorkspaceExecutionContextBuilder,
} from "@exaix/portal";
