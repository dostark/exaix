/**
 * @module ResolveWorktreeBaseDirTest
 * @path packages/flow/tests/resolve_worktree_base_dir_test.ts
 * @description Phase 194 Step 6 — unit coverage for the shared branch-table function both
 * AgentComposerAdapter.runWithStrategy and SessionDelegationCoordinator.prepareBrief call,
 * proving the two consumers can never silently diverge in worktree-resolution behavior.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/resolve_worktree_base_dir.ts, packages/flow/src/agent_composer_adapter.ts, apps/daemon/src/session_delegation_coordinator.ts]
 */

import { assertEquals } from "@std/assert";
import { PortalExecutionStrategy } from "@exaix/core";
import type { IFlowWorktreeCoordinator } from "@exaix/core/types";
import type { IPortalPermissions } from "@exaix/schemas/portal_permissions.ts";
import { resolveWorktreeBaseDir } from "@exaix/flow";

function portal(overrides: Partial<IPortalPermissions> = {}): IPortalPermissions {
  return {
    alias: "test-portal",
    target_path: "/portals/test-portal",
    default_branch: "main",
    agents_allowed: ["*"],
    operations: [],
    ...overrides,
  };
}

class FakeCoordinator implements IFlowWorktreeCoordinator {
  calls: Array<{ portalAlias: string; traceId: string; baseBranch: string }> = [];
  resolve(portalAlias: string, traceId: string, baseBranch: string): Promise<string> {
    this.calls.push({ portalAlias, traceId, baseBranch });
    return Promise.resolve(`/exa/worktrees/${portalAlias}/${traceId}`);
  }
  release(): Promise<void> {
    return Promise.resolve();
  }
  releaseAll(): Promise<void> {
    return Promise.resolve();
  }
}

Deno.test("resolveWorktreeBaseDir: unset execution_strategy returns target_path unchanged, regardless of coordinator presence", async () => {
  const coordinator = new FakeCoordinator();
  assertEquals(await resolveWorktreeBaseDir(portal(), "trace-1", coordinator), "/portals/test-portal");
  assertEquals(await resolveWorktreeBaseDir(portal(), "trace-1", undefined), "/portals/test-portal");
  assertEquals(coordinator.calls.length, 0);
});

Deno.test("resolveWorktreeBaseDir: BRANCH execution_strategy returns target_path unchanged, regardless of coordinator presence", async () => {
  const coordinator = new FakeCoordinator();
  const p = portal({ execution_strategy: PortalExecutionStrategy.BRANCH });
  assertEquals(await resolveWorktreeBaseDir(p, "trace-1", coordinator), "/portals/test-portal");
  assertEquals(coordinator.calls.length, 0);
});

Deno.test("resolveWorktreeBaseDir: WORKTREE execution_strategy with no coordinator returns target_path unchanged (feature not wired for this caller)", async () => {
  const p = portal({ execution_strategy: PortalExecutionStrategy.WORKTREE });
  assertEquals(await resolveWorktreeBaseDir(p, "trace-1", undefined), "/portals/test-portal");
});

Deno.test("resolveWorktreeBaseDir: WORKTREE execution_strategy with a coordinator resolves via coordinator.resolve(alias, traceId, default_branch)", async () => {
  const coordinator = new FakeCoordinator();
  const p = portal({ execution_strategy: PortalExecutionStrategy.WORKTREE, default_branch: "develop" });
  const result = await resolveWorktreeBaseDir(p, "trace-1", coordinator);
  assertEquals(result, "/exa/worktrees/test-portal/trace-1");
  assertEquals(coordinator.calls, [{ portalAlias: "test-portal", traceId: "trace-1", baseBranch: "develop" }]);
});
