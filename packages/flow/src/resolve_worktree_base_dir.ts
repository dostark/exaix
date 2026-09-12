/**
 * @module ResolveWorktreeBaseDir
 * @path packages/flow/src/resolve_worktree_base_dir.ts
 * @description Shared branch-table logic (Phase 194 Step 6) resolving a portal's base
 * working directory for a delegated code-change execution: unset/BRANCH strategies keep
 * the portal's static `target_path`; WORKTREE resolves a fresh per-trace worktree through
 * `IFlowWorktreeCoordinator`. Both AgentComposerAdapter.runWithStrategy (strategy-routed
 * flow steps) and SessionDelegationCoordinator.prepareBrief (session_delegate_cycle) call
 * this one function so the two consumers can never silently diverge in behavior.
 * @architectural-layer Flows
 * @dependencies [@exaix/core]
 * @related-files [packages/flow/src/agent_composer_adapter.ts, apps/daemon/src/session_delegation_coordinator.ts, packages/flow/src/flow_worktree_coordinator.ts]
 */

import { PortalExecutionStrategy } from "@exaix/core";
import type { IFlowWorktreeCoordinator, Opt, Reason } from "@exaix/core/types";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";

/** unset/BRANCH -> unchanged `target_path`; WORKTREE + a coordinator present ->
 *  `worktreeCoordinator.resolve(...)`; WORKTREE with no coordinator -> unchanged
 *  `target_path` (feature not wired for that caller). */
export async function resolveWorktreeBaseDir(
  portalConfig: IPortalPermissions,
  traceId: string,
  worktreeCoordinator: Opt<IFlowWorktreeCoordinator, Reason.OptionalDependency>,
): Promise<string> {
  if (!worktreeCoordinator || portalConfig.execution_strategy !== PortalExecutionStrategy.WORKTREE) {
    return portalConfig.target_path;
  }
  return await worktreeCoordinator.resolve(portalConfig.alias, traceId, portalConfig.default_branch);
}
