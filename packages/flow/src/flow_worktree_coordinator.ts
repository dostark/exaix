/**
 * @module FlowWorktreeCoordinator
 * @path packages/flow/src/flow_worktree_coordinator.ts
 * @description Creates, reuses, and best-effort releases isolated git
 * worktrees for strategy-routed flow traces.
 * @architectural-layer Flows
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/core/src/types/i_flow_worktree_coordinator.ts, packages/execution/src/git_execution_setup_service.ts]
 * @visible
 */

import { dirname, join } from "@std/path";
import { ConfigValueType, SwapClass } from "@exaix/core";
import { configurable } from "@exaix/core/config";
import { DomainEventType } from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { IFlowWorktreeCoordinator, IGitServiceFactory } from "@exaix/core/types";
import type { Config } from "@exaix/schemas/config.ts";

/** Maximum number of trace worktrees retained before least-recently-touched eviction. */
export const FLOW_WORKTREE_TRACE_MAX: number = configurable({
  key: "flow.worktree_coordinator_trace_max",
  default: 100,
  type: ConfigValueType.NUMBER,
  description: "Maximum number of distinct portal and trace worktrees retained before least-recently-touched eviction",
  min: 1,
  max: 10_000,
  swap: SwapClass.HOT,
});

/** Construction dependencies for FlowWorktreeCoordinator. */
export interface IFlowWorktreeCoordinatorDeps {
  config: Config;
  gitServiceFactory: IGitServiceFactory;
  logger: IEventLogger;
}

/** Raised when git cannot create a requested flow worktree. */
export class FlowWorktreeSetupError extends Error {
  constructor(
    public readonly worktreePath: string,
    public readonly baseBranch: string,
    cause: Error | string,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Flow worktree setup failed: ${detail}`, { cause });
    this.name = "FlowWorktreeSetupError";
  }
}

/** Creates and tracks isolated worktrees for the lifetime of a flow coordinator. */
export class FlowWorktreeCoordinator implements IFlowWorktreeCoordinator {
  private readonly worktreesByTrace = new Map<string, string>();

  constructor(private readonly deps: IFlowWorktreeCoordinatorDeps) {}

  async resolve(portalAlias: string, traceId: string, baseBranch: string): Promise<string> {
    this.assertSafePathSegment(portalAlias, "portal alias");
    this.assertSafePathSegment(traceId, "trace ID");
    const key = this.createKey(portalAlias, traceId);
    const existing = this.worktreesByTrace.get(key);
    if (existing) {
      this.worktreesByTrace.delete(key);
      this.worktreesByTrace.set(key, existing);
      return existing;
    }

    if (this.worktreesByTrace.size >= FLOW_WORKTREE_TRACE_MAX) {
      const oldestKey = this.worktreesByTrace.keys().next().value;
      if (oldestKey) {
        const [oldestPortalAlias, oldestTraceId] = this.parseKey(oldestKey);
        await this.release(oldestPortalAlias, oldestTraceId);
      }
    }

    const worktreePath = join(this.deps.config.system.root, ".exa", "worktrees", portalAlias, traceId);
    try {
      await Deno.mkdir(dirname(worktreePath), { recursive: true });
      const portalTargetPath = this.resolvePortalTargetPath(portalAlias);
      const gitService = this.deps.gitServiceFactory.createGitService(portalTargetPath, traceId);
      await gitService.addWorktree(worktreePath, baseBranch);
    } catch (error) {
      const cause = error instanceof Error ? error : String(error);
      throw new FlowWorktreeSetupError(worktreePath, baseBranch, cause);
    }

    this.worktreesByTrace.set(key, worktreePath);
    await this.deps.logger.info(
      DomainEventType.FlowWorktreeCreated,
      portalAlias,
      { portalAlias, traceId },
      traceId,
    );
    return worktreePath;
  }

  async release(portalAlias: string, traceId: string): Promise<void> {
    this.assertSafePathSegment(portalAlias, "portal alias");
    this.assertSafePathSegment(traceId, "trace ID");
    const key = this.createKey(portalAlias, traceId);
    const worktreePath = this.worktreesByTrace.get(key);
    if (!worktreePath) return;

    try {
      const portalTargetPath = this.resolvePortalTargetPath(portalAlias);
      const gitService = this.deps.gitServiceFactory.createGitService(portalTargetPath, traceId);
      await gitService.removeWorktree(worktreePath, { force: true });
      await this.deps.logger.info(
        DomainEventType.FlowWorktreeReleased,
        portalAlias,
        { portalAlias, traceId },
        traceId,
      );
    } catch {
      await this.deps.logger.warn(
        DomainEventType.FlowWorktreeReleased,
        portalAlias,
        { portalAlias, traceId },
        traceId,
      );
    } finally {
      this.worktreesByTrace.delete(key);
    }
  }

  private createKey(portalAlias: string, traceId: string): string {
    return `${portalAlias}:${traceId}`;
  }

  private parseKey(key: string): [string, string] {
    const separator = key.indexOf(":");
    return [key.slice(0, separator), key.slice(separator + 1)];
  }

  private resolvePortalTargetPath(portalAlias: string): string {
    const portal = this.deps.config.portals.find((candidate) => candidate.alias === portalAlias);
    if (!portal) throw new Error(`Flow worktree portal is not configured: ${portalAlias}`);
    return portal.target_path;
  }

  private assertSafePathSegment(value: string, label: string): void {
    if (!value || value === "." || value === ".." || /[\\/:]/.test(value)) {
      throw new Error(`Flow worktree ${label} must be one safe path segment`);
    }
  }
}
