/**
 * @module ContextOverflowRecoveryIntegrationTest
 * @path tests/integration/agent/context_overflow_recovery_test.ts
 * @description Integration-style regression for Phase 62 Step 62.4 overflow-safe prompt assembly.
 */

import { assert, assertEquals } from "@std/assert";
import { AgentComposer, ExecutionContextService } from "@exaix/execution";
import { StrategyRegistry } from "@exaix/execution";
import { ExecutionStrategyName, SecurityMode } from "@exaix/core";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import { TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";
import { setupAgentExecutorFixture } from "../helpers/agent_composer_fixture.ts";

Deno.test("Integration: context overflow recovers by truncating prompt via allocator budget", async () => {
  const { db, config, logger, pathResolver, permissions, cleanup } = await setupAgentExecutorFixture();

  try {
    let promptLengthSeen = 0;
    let skillsBlockLengthSeen = 0;
    let allocatorCalls = 0;
    const tinyBudgetAllocator = {
      allocate: (_modelId: string) => {
        allocatorCalls++;
        return Promise.resolve({
          model: "openai:gpt-4o-mini",
          totalBudgetTokens: 1000,
          safetyBufferTokens: 0,
          sections: {
            system: 100,
            plan: 100,
            portalKnowledge: 50,
            memory: 50,
            skills: 10,
            loopHistory: 10,
          },
        });
      },
    };

    const holder: { executor?: AgentComposer } = {};
    const strategyRegistry = new StrategyRegistry();
    strategyRegistry.register({
      name: ExecutionStrategyName.LEGACY,
      execute: async (blueprint, context, options) => {
        const prompt = await holder.executor!.buildExecutionPrompt(blueprint, context, options);
        promptLengthSeen = prompt.length;
        const skillMatch = prompt.match(/--- BEGIN SKILLS ---\n([\s\S]*?)\n--- END SKILLS ---/);
        skillsBlockLengthSeen = skillMatch?.[1].length ?? 0;
        return Promise.resolve({
          branch: "feat/overflow-recovery",
          commit_sha: "0000000000000000000000000000000000000000",
          files_changed: [],
          description: "Recovered from overflow with truncated prompt",
          tool_calls: 0,
          execution_time_ms: 25,
        });
      },
    });

    const executor = new AgentComposer({
      config,
      db,
      logger,
      pathResolver,
      permissions,
      strategyRegistry,
      executionContext: new ExecutionContextService(config, logger, { promptBudgetAllocator: tinyBudgetAllocator }),
    });
    holder.executor = executor;

    const requestHuge = "X".repeat(9_000);
    const planHuge = "Y".repeat(45_000);
    const context: IExecutionContext = {
      trace_id: crypto.randomUUID(),
      request_id: "overflow-e2e-1",
      request: `Request: ${requestHuge}`,
      plan: `Plan: ${planHuge}`,
      portal: "TestPortal",
      skills_context: "S".repeat(500),
    } as IExecutionContext & { skills_context: string };
    const options: IAgentExecutionOptions = {
      agent_role: "test-agent",
      portal: "TestPortal",
      security_mode: SecurityMode.HYBRID,
      timeout_ms: 30000,
      max_tool_calls: 10,
      audit_enabled: true,
    };

    const result = await executor.executeStep(context, options);
    assertEquals(result.branch, "feat/overflow-recovery");
    assertEquals(allocatorCalls, 1);
    assert(promptLengthSeen > 0);
    assert(promptLengthSeen < 10000);
    assertEquals(skillsBlockLengthSeen <= 10 * TOKEN_ESTIMATION_CHARS_PER_TOKEN, true);

    executor.dispose();
  } finally {
    await cleanup();
  }
});
