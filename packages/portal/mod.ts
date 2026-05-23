/**
 * @module PortalPackage
 * @path packages/portal/mod.ts
 * @related-files []
 * @architectural-layer Portal
 * @description Package entrypoint for @exaix/portal. This package houses portal
 * analysis, context, permissions, and persistence logic.
 */

export { PORTAL_ALIAS_MAX_LENGTH } from "./src/constants.ts";
export {
  type IWorkspaceExecutionContext,
  WorkspaceExecutionContextBuilder,
} from "./src/context/workspace_execution_context.ts";

// Portal service modules
export { PathResolver } from "./src/path_resolver.ts";
export type { IPathResolverConfig } from "./src/path_resolver.ts";

export { PortalPermissionsService } from "./src/portal_permissions.ts";

export { PortalService } from "./src/portal.ts";
