/**
 * @module FlowWorktreeCoordinatorTest
 * @path packages/flow/tests/flow_worktree_coordinator_test.ts
 * @description Unit coverage for per-trace flow worktree creation, reuse,
 * release, bounded eviction, failure handling, and path-safe event payloads.
 * @architectural-layer Flows
 * @related-files [packages/flow/src/flow_worktree_coordinator.ts, packages/core/src/types/i_flow_worktree_coordinator.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DomainEventType } from "@exaix/core/events";
import type { IGitService, IGitServiceFactory } from "@exaix/core/types";
import { FLOW_WORKTREE_TRACE_MAX, FlowWorktreeCoordinator, FlowWorktreeSetupError } from "@exaix/flow";
import { createMockConfig, createMockEventLogger } from "@exaix/testing";
import type { Config } from "@exaix/schemas/config.ts";

interface IAddWorktreeCall {
  worktreePath: string;
  baseBranch: string;
}

interface IRemoveWorktreeCall {
  worktreePath: string;
  options?: { force?: boolean; deleteBranch?: boolean };
}

class FakeGitService implements IGitService {
  addCalls: IAddWorktreeCall[] = [];
  removeCalls: IRemoveWorktreeCall[] = [];
  addError?: Error;
  removeError?: Error;
  branchExists = true;
  defaultBranch = "main";
  /** When set, addWorktree() for this exact path stalls until the gate promise settles — lets a test hold one creation in flight while other resolve() calls race around it. */
  addWorktreeGate?: { matchPath: string; promise: Promise<void> };

  setRepository(_repoPath: string): void {}
  getRepository(): string {
    return "";
  }
  ensureRepository(): Promise<void> {
    return Promise.resolve();
  }
  ensureIdentity(): Promise<void> {
    return Promise.resolve();
  }
  createBranch(): Promise<string> {
    return Promise.resolve("");
  }
  commit(): Promise<string> {
    return Promise.resolve("");
  }
  checkoutBranch(): Promise<void> {
    return Promise.resolve();
  }
  getCurrentBranch(): Promise<string> {
    return Promise.resolve("main");
  }
  getDefaultBranch(): Promise<string> {
    return Promise.resolve(this.defaultBranch);
  }
  addWorktree(worktreePath: string, baseBranch: string): Promise<void> {
    this.addCalls.push({ worktreePath, baseBranch });
    const settle = () => this.addError ? Promise.reject(this.addError) : Promise.resolve();
    if (this.addWorktreeGate && this.addWorktreeGate.matchPath === worktreePath) {
      return this.addWorktreeGate.promise.then(settle);
    }
    return settle();
  }
  removeWorktree(
    worktreePath: string,
    options?: { force?: boolean; deleteBranch?: boolean },
  ): Promise<void> {
    this.removeCalls.push({ worktreePath, options });
    return this.removeError ? Promise.reject(this.removeError) : Promise.resolve();
  }
  pruneWorktrees(): Promise<string> {
    return Promise.resolve("");
  }
  listWorktrees(): Promise<never[]> {
    return Promise.resolve([]);
  }
  runGitCommand(): Promise<{ output: string; exitCode: number }> {
    return Promise.resolve({ output: "", exitCode: this.branchExists ? 0 : 1 });
  }
  validateArgs(): { valid: boolean; reason?: string } {
    return { valid: true };
  }
}

class FakeGitServiceFactory implements IGitServiceFactory {
  createCalls: Array<{ repoPath: string; traceId: string }> = [];

  constructor(private readonly gitService: FakeGitService) {}

  createGitService(repoPath: string, traceId: string): IGitService {
    this.createCalls.push({ repoPath, traceId });
    return this.gitService;
  }
}

async function createCoordinator() {
  const root = await Deno.makeTempDir({ prefix: "flow-worktree-coordinator-" });
  const portalTargetPath = join(root, "portal-source");
  await Deno.mkdir(portalTargetPath);
  const config: Config = createMockConfig(root, {
    portals: [{
      alias: "portal",
      target_path: portalTargetPath,
      default_branch: "main",
      agents_allowed: ["*"],
      operations: [],
    }],
  });
  const gitService = new FakeGitService();
  const gitServiceFactory = new FakeGitServiceFactory(gitService);
  const logger = createMockEventLogger();
  const coordinator = new FlowWorktreeCoordinator({ config, gitServiceFactory, logger });
  return { coordinator, gitService, gitServiceFactory, logger, portalTargetPath, root };
}

async function cleanup(root: string): Promise<void> {
  await Deno.remove(root, { recursive: true });
}

Deno.test("FlowWorktreeCoordinator.resolve creates a worktree for a new portal and trace", async () => {
  const test = await createCoordinator();
  try {
    const path = await test.coordinator.resolve("portal", "trace-1", "main");

    assertEquals(path, join(test.root, ".exa", "worktrees", "portal", "trace-1"));
    assertEquals(test.gitServiceFactory.createCalls, [{ repoPath: test.portalTargetPath, traceId: "trace-1" }]);
    assertEquals(test.gitService.addCalls, [{ worktreePath: path, baseBranch: "main" }]);
    assertEquals(test.logger.events[0]?.action, DomainEventType.FlowWorktreeCreated);
    assertEquals(test.logger.events[0]?.payload, { portalAlias: "portal", traceId: "trace-1" });
    assertEquals(test.logger.events[0]?.traceId, "trace-1");
  } finally {
    await cleanup(test.root);
  }
});

Deno.test("FlowWorktreeCoordinator.resolve falls back to the repository default when the configured branch is absent", async () => {
  const test = await createCoordinator();
  try {
    test.gitService.branchExists = false;
    test.gitService.defaultBranch = "master";

    const path = await test.coordinator.resolve("portal", "trace-1", "main");

    assertEquals(test.gitService.addCalls, [{ worktreePath: path, baseBranch: "master" }]);
  } finally {
    await cleanup(test.root);
  }
});

Deno.test("FlowWorktreeCoordinator.resolve reuses a worktree for the same portal and trace", async () => {
  const test = await createCoordinator();
  try {
    const first = await test.coordinator.resolve("portal", "trace-1", "main");
    const second = await test.coordinator.resolve("portal", "trace-1", "main");

    assertEquals(second, first);
    assertEquals(test.gitService.addCalls.length, 1);
  } finally {
    await cleanup(test.root);
  }
});

Deno.test("FlowWorktreeCoordinator.resolve creates distinct worktrees for distinct traces", async () => {
  const test = await createCoordinator();
  try {
    const first = await test.coordinator.resolve("portal", "trace-1", "main");
    const second = await test.coordinator.resolve("portal", "trace-2", "main");

    assertEquals(first === second, false);
    assertEquals(test.gitService.addCalls.length, 2);
  } finally {
    await cleanup(test.root);
  }
});

Deno.test("FlowWorktreeCoordinator.resolve wraps git failures and never returns a fallback path", async () => {
  const test = await createCoordinator();
  try {
    test.gitService.addError = new Error("git worktree add failed");

    await assertRejects(
      () => test.coordinator.resolve("portal", "trace-1", "main"),
      FlowWorktreeSetupError,
      "git worktree add failed",
    );
    assertEquals(test.gitService.addCalls.length, 1);
    assertEquals(test.logger.events.length, 0);
  } finally {
    await cleanup(test.root);
  }
});

Deno.test("FlowWorktreeCoordinator.release removes a worktree with force and clears its entry", async () => {
  const test = await createCoordinator();
  try {
    const path = await test.coordinator.resolve("portal", "trace-1", "main");
    await test.coordinator.release("portal", "trace-1");
    await test.coordinator.resolve("portal", "trace-1", "main");

    assertEquals(test.gitService.removeCalls, [{ worktreePath: path, options: { force: true } }]);
    assertEquals(test.gitService.addCalls.length, 2);
    assertEquals(test.logger.events[1]?.action, DomainEventType.FlowWorktreeReleased);
  } finally {
    await cleanup(test.root);
  }
});

Deno.test("FlowWorktreeCoordinator.release logs removal failures without throwing", async () => {
  const test = await createCoordinator();
  try {
    await test.coordinator.resolve("portal", "trace-1", "main");
    test.gitService.removeError = new Error("git worktree remove failed");

    await test.coordinator.release("portal", "trace-1");
    await test.coordinator.resolve("portal", "trace-1", "main");

    assertEquals(test.gitService.removeCalls.length, 1);
    assertEquals(test.gitService.addCalls.length, 2);
  } finally {
    await cleanup(test.root);
  }
});

Deno.test("FlowWorktreeCoordinator.releaseAll removes every tracked worktree", async () => {
  const test = await createCoordinator();
  try {
    const first = await test.coordinator.resolve("portal", "trace-1", "main");
    const second = await test.coordinator.resolve("portal", "trace-2", "main");

    await test.coordinator.releaseAll();

    assertEquals(test.gitService.removeCalls, [
      { worktreePath: first, options: { force: true } },
      { worktreePath: second, options: { force: true } },
    ]);
    await test.coordinator.resolve("portal", "trace-1", "main");
    assertEquals(test.gitService.addCalls.length, 3);
  } finally {
    await cleanup(test.root);
  }
});

Deno.test("FlowWorktreeCoordinator evicts the least-recently-touched worktree", async () => {
  const test = await createCoordinator();
  try {
    for (let index = 0; index < FLOW_WORKTREE_TRACE_MAX; index++) {
      await test.coordinator.resolve("portal", `trace-${index}`, "main");
    }
    await test.coordinator.resolve("portal", "trace-0", "main");
    await test.coordinator.resolve("portal", "trace-next", "main");

    assertEquals(test.gitService.removeCalls.length, 1);
    assertEquals(
      test.gitService.removeCalls[0]?.worktreePath,
      join(test.root, ".exa", "worktrees", "portal", "trace-1"),
    );
  } finally {
    await cleanup(test.root);
  }
});

Deno.test("FlowWorktreeCoordinator.resolve emits FlowWorktreeCreated only for a git creation", async () => {
  const test = await createCoordinator();
  try {
    await test.coordinator.resolve("portal", "trace-1", "main");
    await test.coordinator.resolve("portal", "trace-1", "main");

    const createdEvents = test.logger.events.filter((event) => event.action === DomainEventType.FlowWorktreeCreated);
    assertEquals(createdEvents.length, 1);
    assertEquals("worktreePath" in (createdEvents[0]?.payload ?? {}), false);
  } finally {
    await cleanup(test.root);
  }
});

Deno.test("[security] FlowWorktreeCoordinator.resolve rejects a trace ID that escapes the worktree root", async () => {
  const test = await createCoordinator();
  try {
    await assertRejects(
      () => test.coordinator.resolve("portal", "../outside", "main"),
      Error,
      "safe path segment",
    );
    assertEquals(test.gitService.addCalls, []);
  } finally {
    await cleanup(test.root);
  }
});

Deno.test(
  "[security] FlowWorktreeCoordinator.resolve: two concurrent calls for the SAME never-before-seen (portalAlias, traceId) pair both resolve to the identical path, with exactly one real git worktree add",
  async () => {
    const test = await createCoordinator();
    try {
      const [first, second] = await Promise.all([
        test.coordinator.resolve("portal", "concurrent-trace", "main"),
        test.coordinator.resolve("portal", "concurrent-trace", "main"),
      ]);

      assertEquals(first, second);
      assertEquals(test.gitService.addCalls.length, 1);
      assertEquals(
        test.logger.events.filter((event) => event.action === DomainEventType.FlowWorktreeCreated).length,
        1,
      );
    } finally {
      await cleanup(test.root);
    }
  },
);

Deno.test(
  "FlowWorktreeCoordinator: an in-flight (not yet resolved) resolve() call is never evicted by concurrent LRU pressure from other keys",
  async () => {
    const test = await createCoordinator();
    try {
      for (let index = 0; index < FLOW_WORKTREE_TRACE_MAX; index++) {
        await test.coordinator.resolve("portal", `fill-${index}`, "main");
      }

      const inFlightPath = join(test.root, ".exa", "worktrees", "portal", "in-flight-trace");
      let releaseGate!: () => void;
      test.gitService.addWorktreeGate = {
        matchPath: inFlightPath,
        promise: new Promise((resolve) => {
          releaseGate = resolve;
        }),
      };

      const inFlight = test.coordinator.resolve("portal", "in-flight-trace", "main");
      for (
        let attempt = 0;
        attempt < 100 && !test.gitService.addCalls.some((call) => call.worktreePath === inFlightPath);
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      // Concurrent LRU pressure from a different, brand-new key while the above stays unsettled.
      await test.coordinator.resolve("portal", "pressure-trace", "main");

      assertEquals(
        test.gitService.removeCalls.some((call) => call.worktreePath === inFlightPath),
        false,
        "an in-flight worktree creation must never be selected for LRU eviction",
      );
      assertEquals(test.gitService.removeCalls.length, 1, "only the pre-existing oldest entry may be evicted");

      releaseGate();
      const resolvedPath = await inFlight;
      assertEquals(resolvedPath, inFlightPath);
      assertEquals(test.gitService.addCalls.filter((call) => call.worktreePath === inFlightPath).length, 1);

      const reused = await test.coordinator.resolve("portal", "in-flight-trace", "main");
      assertEquals(reused, inFlightPath);
      assertEquals(test.gitService.addCalls.filter((call) => call.worktreePath === inFlightPath).length, 1);
    } finally {
      await cleanup(test.root);
    }
  },
);
