/**
 * @module SHAAccuracyTest
 * @path tests/agents/SHA_accuracy_test.ts
 * @description Step 61.7 (G3): Verifies that AgentOrchestrator.executeStep() overwrites the
 * strategy's returned commit_sha with the real HEAD SHA from the portal git repository.
 *
 * Success Criteria:
 * - result.commit_sha matches /^[0-9a-f]{40}$/
 * - result.commit_sha !== GIT_EMPTY_SHA ("0000…")
 */

import { assertMatch, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { AgentOrchestrator } from "@exaix/execution";
import { EventLogger } from "@exaix/core/logger";
import { PathResolver, PortalPermissionsService } from "@exaix/portal";
import type { IExecutionStrategy } from "@exaix/execution";
import { StrategyRegistry } from "@exaix/execution";
import type { IChangesetResult } from "@exaix/schemas/agent_orchestrator.ts";
import { ExecutionStrategyName, PortalOperation } from "@exaix/core";
import { GIT_EMPTY_SHA } from "@exaix/git";
import { initTestDbService } from "@exaix/testing";
import { createMockConfig } from "@exaix/testing";
import { TEST_DEFAULT_BRANCH } from "@exaix/git/testing";

Deno.test({
  name: "SHA accuracy: executeStep overwrites GIT_EMPTY_SHA with real HEAD SHA",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dbService = await initTestDbService();
    const tempDir = dbService.tempDir;

    try {
      // 1. Set up a real git repo in the portal directory
      const portalDir = join(tempDir, "TestPortal");
      await Deno.mkdir(portalDir, { recursive: true });

      const git = (args: string[]) => new Deno.Command("git", { args, cwd: portalDir, stderr: "null" }).output();
      await git(["init"]);
      await git(["config", "user.name", "Test"]);
      await git(["config", "user.email", "t@t.local"]);
      await Deno.writeTextFile(join(portalDir, "README.md"), "# test\n");
      await git(["add", "README.md"]);
      await git(["commit", "-m", "Initial commit"]);

      // 2. Write blueprint file at <root>/Blueprints/Identities/test-agent.md
      const blueprintsDir = join(tempDir, "Blueprints", "Identities");
      await Deno.mkdir(blueprintsDir, { recursive: true });
      await Deno.writeTextFile(
        join(blueprintsDir, "test-agent.md"),
        "---\nmodel: mock\ncapabilities: []\n---\nTest agent blueprint\n",
      );

      // 3. Config — portal points to the real git repo
      const config = createMockConfig(tempDir, {
        portals: [{
          alias: "test-portal",
          target_path: portalDir,
          default_branch: TEST_DEFAULT_BRANCH,
          identities_allowed: ["*"],
          operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
        }],
      });

      // 4. Use the real logger to avoid overload/cast issues in editor diagnostics.
      const logger = new EventLogger({ db: dbService.db });

      // 5. Mock LEGACY strategy — always returns GIT_EMPTY_SHA so we can detect override
      const mockStrategy: IExecutionStrategy = {
        name: ExecutionStrategyName.LEGACY,
        execute: (): Promise<IChangesetResult> =>
          Promise.resolve({
            branch: "feat/test-branch",
            commit_sha: GIT_EMPTY_SHA,
            files_changed: [],
            description: "mock execution",
            tool_calls: 0,
            execution_time_ms: 0,
          }),
      };

      // 6. StrategyRegistry with only the mock LEGACY strategy
      const registry = new StrategyRegistry();
      registry.register(mockStrategy);

      // 7. Wire up dependencies
      const permissions = new PortalPermissionsService([{
        alias: "test-portal",
        target_path: portalDir,
        default_branch: TEST_DEFAULT_BRANCH,
        identities_allowed: ["*"],
        operations: [PortalOperation.READ, PortalOperation.WRITE, PortalOperation.GIT],
      }]);
      const pathResolver = new PathResolver(config);

      const executor = new AgentOrchestrator({
        config,
        db: dbService.db,
        logger,
        pathResolver,
        permissions,
        strategyRegistry: registry,
      });

      // 8. Execute
      const result = await executor.executeStep(
        {
          trace_id: crypto.randomUUID(),
          request_id: "req-sha-001",
          request: "test request",
          plan: "test plan",
          portal: "test-portal",
        },
        {
          identity_id: "test-agent",
          portal: "test-portal",
        },
      );

      // 9. Assert — real 40-char hex SHA was captured, NOT the zeros placeholder
      assertNotEquals(
        result.commit_sha,
        GIT_EMPTY_SHA,
        "commit_sha must be overridden with a real git SHA",
      );
      assertMatch(
        result.commit_sha,
        /^[0-9a-f]{40}$/,
        "commit_sha must be a full 40-character hex SHA",
      );
    } finally {
      await dbService.cleanup();
    }
  },
});
