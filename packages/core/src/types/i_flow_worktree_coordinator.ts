/**
 * @module IFlowWorktreeCoordinator
 * @path packages/core/src/types/i_flow_worktree_coordinator.ts
 * @description Contract for resolving and releasing per-trace worktrees used by
 * strategy-routed flow execution.
 * @architectural-layer Shared
 * @related-files [packages/flow/src/flow_worktree_coordinator.ts]
 */

/** Resolves and lifecycle-manages an isolated git worktree for a flow trace. */
export interface IFlowWorktreeCoordinator {
  /** Resolves the same worktree path for repeated calls for one portal and trace. */
  resolve(portalAlias: string, traceId: string, baseBranch: string): Promise<string>;

  /** Best-effort removal for a tracked portal and trace worktree. */
  release(portalAlias: string, traceId: string): Promise<void>;

  /** Best-effort removal for every worktree tracked by this coordinator. */
  releaseAll(): Promise<void>;
}
