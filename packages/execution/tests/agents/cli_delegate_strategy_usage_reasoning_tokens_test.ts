/**
 * @module CliDelegateStrategyUsageReasoningTokensTest
 * @path packages/execution/tests/agents/cli_delegate_strategy_usage_reasoning_tokens_test.ts
 * @related-files [packages/execution/src/strategies/cli_delegate_strategy.ts]
 * @architectural-layer Services
 * @description Phase 167 Step 12 — RED-first test. CliDelegateStrategy.execute's
 * usage: {...} object literal only reads tokenStats.input/output/cacheRead/cacheCreation and a
 * real costUsd — the local ICliDelegateParsedOutcome structural interface (satisfied by both
 * claude's ICliDelegateTurnResult and opencode's IDelegateParsedReturn) had no reasoning-token
 * field, so it would be silently dropped at this leaf-to-trunk assembly point even after both
 * CLI parsers are widened. Verifies a fixture parsed turn result with a thinking-token
 * breakdown and a real costUsd, run through CliDelegateStrategy.execute, produces an
 * IChangesetResult.usage with a matching reasoning_tokens value and cost_source: "tracked" —
 * mirrors cli_delegate_strategy_usage_cache_tokens_test.ts's Phase 140a pattern.
 */

import { assertEquals } from "@std/assert";
import { CliDelegateStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IRunCliDelegateProcess } from "@exaix/execution";

function makeBlueprint(): IAgentFileBlueprint {
  return {
    name: "senior-coder",
    model: "",
    provider: "",
    capabilities: ["code_generation", "cli_delegate"],
    systemPrompt: "You are an expert software engineer.",
  };
}

function makeContext(): IExecutionContext {
  return {
    trace_id: "33333333-3333-3333-3333-333333333333",
    request_id: "REQ-3",
    request: "Fix the null-guard bug",
    plan: "Step 1: patch",
    portal: "main",
  };
}

function makeOptions(): IAgentExecutionOptions {
  return {
    agent_role: "senior-coder",
    portal: "main",
    security_mode: "sandboxed" as IAgentExecutionOptions["security_mode"],
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

function systemLine(sessionId: string): string {
  return JSON.stringify({ type: "system", session_id: sessionId });
}

function resultLineWithReasoning(result: string): string {
  return JSON.stringify({
    type: "result",
    result,
    total_cost_usd: 0.0021,
    usage: {
      input_tokens: 150,
      output_tokens: 2340,
      output_tokens_details: { thinking_tokens: 2048 },
    },
  });
}

Deno.test("CliDelegateStrategy: a thinking-token breakdown and a real costUsd survive into IChangesetResult.usage, tagged tracked", async () => {
  const run: IRunCliDelegateProcess = (_command, _args, _options) =>
    Promise.resolve({
      code: 0,
      stdout: [systemLine("sess-1"), resultLineWithReasoning("Fixed the bug.")].join("\n"),
      stderr: "",
    });

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const result = await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertEquals(result.usage?.reasoning_tokens, 2048);
  assertEquals(result.usage?.cost_source, "tracked");
  // Existing fields remain correct.
  assertEquals(result.usage?.prompt_tokens, 150);
  assertEquals(result.usage?.completion_tokens, 2340);
  assertEquals(result.usage?.cost_usd, 0.0021);
});
