/**
 * @module FlowStepWorktreeIsolationCutoverTest
 * @path tests/integration/flow_step_worktree_isolation_cutover_test.ts
 * @description Phase 194 Step 4 — deterministic, cost-free proof that a strategy-routed
 * `cli_delegate` flow step writes into a per-trace `.exa/worktrees/<portal>/<traceId>/`
 * checkout, never the portal's own live `target_path`, once a portal opts into
 * `execution_strategy = "worktree"` and a real `FlowWorktreeCoordinator` is wired into
 * `AgentComposerAdapter` — the exact production composition `apps/daemon/main.ts` performs.
 * Drives real production classes (AgentComposerAdapter, AgentComposer, CliDelegateStrategy,
 * FlowWorktreeCoordinator, GitService) end to end; only the `claude` binary itself is
 * swapped for a deterministic fixture script so the test needs no live API call.
 * @architectural-layer Integration
 * @dependencies [@exaix/flow, @exaix/execution, @exaix/git, @exaix/portal, @exaix/core]
 * @related-files [packages/flow/src/agent_composer_adapter.ts, packages/flow/src/flow_worktree_coordinator.ts, apps/daemon/main.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { AgentComposerAdapter, FlowWorktreeCoordinator } from "@exaix/flow";
import { GitService } from "@exaix/git";
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
import { PortalPermissionsService } from "@exaix/portal";
import { createMockConfig, createMockEventLogger, initTestDbService } from "@exaix/testing";
import { ExecutionStrategyName, PortalExecutionStrategy } from "@exaix/core";
import type { IGitServiceFactory } from "@exaix/core/types";

const PORTAL_ALIAS = "worktree-cutover-portal";
const AGENT_ROLE = "worktree-cutover-agent";
const FIXTURE_CLI = fromFileUrl(new URL("./fixtures/flow_worktree_cli_delegate_fixture.ts", import.meta.url));

const noopRunner = {
  run: () => Promise.reject(new Error("runWithStrategy does not use IRunner.run")),
};

Deno.test({
  name:
    "[integration] a real AgentComposerAdapter + FlowWorktreeCoordinator cli_delegate step writes to .exa/worktrees/<portal>/<traceId>/, never the portal's own target_path",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { db, tempDir: systemRoot, cleanup: cleanupDb } = await initTestDbService();
    const portalDir = await Deno.makeTempDir({ prefix: "flow-worktree-cutover-portal-" });
    try {
      await setupGitRepo(portalDir, { initialCommit: true, branch: TEST_DEFAULT_BRANCH });

      const blueprintsDir = join(systemRoot, "Blueprints", "Agents");
      await Deno.mkdir(blueprintsDir, { recursive: true });
      await Deno.writeTextFile(
        join(blueprintsDir, `${AGENT_ROLE}.md`),
        `---\nmodel: "mock:test"\nprovider: "mock"\n---\nYou are the worktree cutover test agent.\n`,
      );

      const config = createMockConfig(systemRoot, {
        portals: [{
          alias: PORTAL_ALIAS,
          target_path: portalDir,
          default_branch: TEST_DEFAULT_BRANCH,
          execution_strategy: PortalExecutionStrategy.WORKTREE,
          agents_allowed: ["*"],
          operations: [],
        }],
        cli_delegate: {
          enabled: true,
          tool: "claude-code",
          bin_overrides: [FIXTURE_CLI],
        },
      });

      const logger = createMockEventLogger();
      const gitServiceFactory: IGitServiceFactory = {
        createGitService: (repoPath: string, traceId: string) => new GitService({ config, traceId, repoPath }),
      };
      const worktreeCoordinator = new FlowWorktreeCoordinator({ config, gitServiceFactory, logger });

      const adapter = new AgentComposerAdapter(noopRunner, blueprintsDir, {
        config,
        db,
        logger,
        permissions: new PortalPermissionsService(config.portals ?? []),
        worktreeCoordinator,
      });

      const traceId = crypto.randomUUID();
      await adapter.runWithStrategy(
        AGENT_ROLE,
        { userPrompt: "add a hello file", context: {}, traceId, portal: PORTAL_ALIAS },
        ExecutionStrategyName.CLI_DELEGATE,
      );

      const expectedWorktreeFile = join(systemRoot, ".exa", "worktrees", PORTAL_ALIAS, traceId, "src", "main.ts");
      const worktreeFileExists = await Deno.stat(expectedWorktreeFile).then(() => true).catch(() => false);
      const portalFileExists = await Deno.stat(join(portalDir, "src", "main.ts")).then(() => true).catch(() => false);

      assert(worktreeFileExists, `expected the cli_delegate write under ${expectedWorktreeFile}`);
      assertEquals(portalFileExists, false, "the portal's own live target_path must receive ZERO changes");
    } finally {
      await cleanupDb();
      await Deno.remove(portalDir, { recursive: true }).catch(() => {});
    }
  },
});
