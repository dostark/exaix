/**
 * @module ReActLoopStrategyWorktreeIsolationE2eTest
 * @path tests/integration/react_loop_strategy_worktree_isolation_e2e_test.ts
 * @description Phase 140a Step 5 — integration test proving the real fix, not just resolvePath
 * in isolation. ReActLoopStrategy.executeTool unconditionally prefixes a portal-scoped tool
 * call's path with "@<portal>/..." (react_loop_strategy.ts:397-405). Before Step 5, ToolRegistry
 * routed any @-prefixed path through PathResolver, which always resolves a portal alias to the
 * LIVE mounted portal — bypassing whatever worktree baseDir the ToolRegistry was actually
 * constructed with. This test drives ReActLoopStrategy.execute() with a REAL ToolRegistry
 * (not mocked) constructed with an explicit worktree baseDir, and asserts the agent's file
 * write lands in the worktree and the live mounted portal receives ZERO changes — the exact
 * class of assertion tests/integration/portal_worktree_review_cleanup_e2e_test.ts already makes
 * for the CLI-delegate/review-approve path, applied here to the direct-API ReAct path.
 * @architectural-layer Services
 * @related-files [packages/execution/src/strategies/react_loop_strategy.ts, packages/tool-runtime/src/tool_registry.ts, packages/portal/src/path_resolver.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { type AgentComposer, ReActLoopStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IModelProvider } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import { ToolRegistry } from "@exaix/tool-runtime";
import { PathResolver } from "@exaix/portal";
import { createMockConfig } from "@exaix/testing";
import {
  ExecutionStrategyName,
  REACT_STATUS_COMPLETE,
  REACT_SUMMARY_PREFIX,
  REACT_THOUGHT_PREFIX,
  SecurityMode,
} from "@exaix/core";
import type { IAgentExecutionOptions, IChangesetResult } from "@exaix/schemas/agent_composer.ts";

const PORTAL_ALIAS = "todo-app";

const testBlueprint = {
  name: "test-agent",
  model: "mock:test",
  provider: "mock",
  capabilities: [ExecutionStrategyName.REACT],
  systemPrompt: "",
} satisfies IAgentFileBlueprint;

function createOptions(portal: string): IAgentExecutionOptions {
  return {
    agent_role: "test-agent",
    portal,
    security_mode: SecurityMode.SANDBOXED,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

Deno.test({
  name:
    "[ReActLoopStrategyWorktreeIsolationE2e] a real ToolRegistry with an explicit worktree baseDir writes into the worktree, never the live mounted portal",
  fn: async () => {
    const portalDir = await Deno.makeTempDir({ prefix: "react-worktree-e2e-portal-" });
    const systemRoot = await Deno.makeTempDir({ prefix: "react-worktree-e2e-root-" });
    // Mirrors GitExecutionSetupService.buildPortalWorktreePath's real layout.
    const worktreeDir = join(systemRoot, ".exa", "worktrees", PORTAL_ALIAS, "trace-e2e-1");
    await Deno.mkdir(worktreeDir, { recursive: true });

    try {
      // target_path must point to the worktree dir, not the live mounted portal — otherwise
      // ToolRegistry.resolvePath's ownPortal check (tool_registry.ts:764-765) falls through to
      // PathResolver, which resolves aliases to the live portal, bypassing worktree isolation.
      const config = createMockConfig(systemRoot, {
        portals: [{
          alias: PORTAL_ALIAS,
          target_path: worktreeDir,
          default_branch: "main",
          agents_allowed: ["*"],
          operations: [],
        }],
      });

      // A REAL ToolRegistry + REAL PathResolver — no mocking of the path-resolution chain this
      // test exists to verify.
      const toolRegistry = new ToolRegistry({
        config,
        baseDir: worktreeDir,
        pathResolver: new PathResolver(config),
      });

      const mockExecutor = {
        logAgentOutput: async () => {
          await Promise.resolve();
        },
        validateReviewResult: (res: IChangesetResult): IChangesetResult => res,
        parseAgentResponse: (): IChangesetResult => ({
          branch: "feat/test",
          commit_sha: "0000000000000000000000000000000000000000",
          files_changed: [],
          description: "Task completed",
          tool_calls: 0,
          execution_time_ms: 0,
        }),
        logGeneration: async () => {
          await Promise.resolve();
        },
        toolRegistry,
      };

      let callCount = 0;
      const provider: IModelProvider = {
        id: "worktree-e2e-mock-provider",
        async generate(): Promise<IGenerateResult> {
          callCount++;
          await Promise.resolve();
          const content = callCount === 1
            ? `${REACT_THOUGHT_PREFIX}Fixing the null guard.\n\`\`\`toml\n[[actions]]\n` +
              `tool = "write_file"\n[actions.params]\npath = "src/utils.ts"\n` +
              `content = "// null-guarded fix"\n\`\`\`\n`
            : `${REACT_STATUS_COMPLETE}\n${REACT_SUMMARY_PREFIX}Fixed`;
          return {
            content,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            model: "mock-model",
            provider: "mock",
            cost_usd: 0.001,
          };
        },
      };

      const strategy = new ReActLoopStrategy(mockExecutor as Partial<AgentComposer> as AgentComposer, provider);
      await strategy.execute(testBlueprint, {
        trace_id: "trace-e2e-1",
        request_id: "request-1",
        request: "fix null guard",
        plan: "fix null guard",
        portal: PORTAL_ALIAS,
      }, createOptions(PORTAL_ALIAS));

      const worktreeFileExists = await Deno.stat(join(worktreeDir, "src", "utils.ts")).then(() => true).catch(() =>
        false
      );
      const portalFileExists = await Deno.stat(join(portalDir, "src", "utils.ts")).then(() => true).catch(() => false);

      assertEquals(worktreeFileExists, true, "expected the agent's fix to land in the worktree");
      assertEquals(
        portalFileExists,
        false,
        "the live mounted portal must receive ZERO changes — worktree isolation must hold",
      );
    } finally {
      await Deno.remove(portalDir, { recursive: true }).catch(() => {});
      await Deno.remove(systemRoot, { recursive: true }).catch(() => {});
    }
  },
});
