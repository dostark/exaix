/**
 * @module SharedPortalEnums
 * @path src/shared/enums/portal.ts
 * @description Portal-specific enum definitions.
 * @architectural-layer Shared
 * @related-files [src/services/portal/portal.ts, src/services/portal/path_resolver.ts]
 */

export enum PortalOperation {
  READ = "read",
  WRITE = "write",
  GIT = "git",
}

export enum PortalExecutionStrategy {
  BRANCH = "branch",
  WORKTREE = "worktree",
}

export enum PortalAnalysisMode {
  QUICK = "quick",
  STANDARD = "standard",
  DEEP = "deep",
}

export enum PortalStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  BROKEN = "broken",
}
