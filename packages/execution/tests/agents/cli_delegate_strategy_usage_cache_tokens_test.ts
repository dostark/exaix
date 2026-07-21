/**
 * @module CliDelegateStrategyUsageCacheTokensTest
 * @path packages/execution/tests/agents/cli_delegate_strategy_usage_cache_tokens_test.ts
 * @related-files [packages/execution/src/strategies/cli_delegate_strategy.ts]
 * @architectural-layer Services
 * @description Phase 140a Step 2 — RED-first test. CliDelegateStrategy.execute's
 * usage: {...} object literal only reads tokenStats.input/output and a real costUsd —
 * the local ICliDelegateParsedOutcome structural interface (satisfied by both claude's
 * ICliDelegateTurnResult and opencode's IDelegateParsedReturn) has no cache-token fields,
 * so cache data would be silently dropped at this leaf-to-trunk assembly point even after
 * both CLI parsers are widened. Verifies a fixture parsed turn result with cache tokens
 * and a real costUsd, run through CliDelegateStrategy.execute, produces an
 * IChangesetResult.usage with matching cache-token values and cost_source: "tracked" —
 * proving the CLI-delegate path is explicitly labeled as real, tracked spend, never
 * predicted.
 */

import { assertEquals } from "@std/assert";
import { CliDelegateStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_orchestrator.ts";
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
    trace_id: "22222222-2222-2222-2222-222222222222",
    request_id: "REQ-2",
    request: "Fix the null-guard bug",
    plan: "Step 1: patch",
    portal: "main",
  };
}

function makeOptions(): IAgentExecutionOptions {
  return {
    identity_id: "senior-coder",
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

function resultLineWithCache(result: string): string {
  return JSON.stringify({
    type: "result",
    result,
    total_cost_usd: 0.0021,
    usage: {
      input_tokens: 120,
      output_tokens: 45,
      cache_creation_input_tokens: 800,
      cache_read_input_tokens: 200,
    },
  });
}

Deno.test("CliDelegateStrategy: cache tokens and a real costUsd survive into IChangesetResult.usage, tagged tracked", async () => {
  const run: IRunCliDelegateProcess = (_command, _args, _options) =>
    Promise.resolve({
      code: 0,
      stdout: [
        systemLine("ses_cache_1"),
        resultLineWithCache("Fixed the null guard."),
      ].join("\n"),
      stderr: "",
    });

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const result = await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertEquals(result.usage?.cache_read_tokens, 200);
  assertEquals(result.usage?.cache_creation_tokens, 800);
  assertEquals(result.usage?.cost_source, "tracked");
  // Existing fields remain correct.
  assertEquals(result.usage?.prompt_tokens, 120);
  assertEquals(result.usage?.completion_tokens, 45);
  assertEquals(result.usage?.cost_usd, 0.0021);
});
