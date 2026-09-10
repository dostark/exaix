/**
 * @module DaemonBootWorktreeCoordinatorTest
 * @path apps/daemon/tests/daemon_boot_worktree_coordinator_test.ts
 * @description Guards the daemon composition order for the shared flow worktree
 * coordinator, which must exist before its strategy-routed consumer is constructed.
 * @architectural-layer Tests
 * @related-files [apps/daemon/main.ts, packages/flow/src/flow_worktree_coordinator.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const DAEMON_MAIN_PATH = new URL("../main.ts", import.meta.url);

async function daemonSource(): Promise<string> {
  return await Deno.readTextFile(DAEMON_MAIN_PATH);
}

Deno.test("[daemon] composition constructs the shared worktree coordinator before AgentComposerAdapter", async () => {
  const source = await daemonSource();
  const factoryIndex = source.indexOf("const gitServiceFactory = {");
  const coordinatorIndex = source.indexOf("const flowWorktreeCoordinator = new FlowWorktreeCoordinator");
  const adapterIndex = source.indexOf("const agentExecutorAdapter = new AgentComposerAdapter");
  const sessionCoordinatorIndex = source.indexOf("new SessionDelegationCoordinator({");

  assert(factoryIndex >= 0);
  assert(coordinatorIndex > factoryIndex);
  assert(adapterIndex > coordinatorIndex);
  assert(sessionCoordinatorIndex > coordinatorIndex);
  assertStringIncludes(source.slice(adapterIndex, adapterIndex + 700), "worktreeCoordinator: flowWorktreeCoordinator");
});

Deno.test("[daemon] graceful shutdown releases all tracked flow worktrees", async () => {
  const source = await daemonSource();

  assertStringIncludes(
    source,
    'gracefulShutdown.registerCleanup("release_flow_worktrees", () => flowWorktreeCoordinator.releaseAll())',
  );
  assertEquals((source.match(/const gitServiceFactory = \{/g) ?? []).length, 1);
});
