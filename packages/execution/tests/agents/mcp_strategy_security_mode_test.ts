/**
 * @module McpStrategySecurityModeTest
 * @path packages/execution/tests/agents/mcp_strategy_security_mode_test.ts
 * @related-files [packages/execution/src/strategies/mcp_agent_strategy.ts, tests/security/subprocess_isolation_test.ts]
 * @description Phase 170 Weakness 1 regression test (narrowed). The original finding claimed
 * McpAgentStrategy.buildAgentArgs inverts SecurityMode's meaning across three dimensions:
 * SANDBOXED granting --allow-net, SANDBOXED granting unscoped --allow-read, and HYBRID
 * granting unrestricted --allow-all. Cross-checking against the existing test suite before
 * writing this file surfaced a real conflict: tests/security/subprocess_isolation_test.ts
 * (Step 61.7 / G3, a deliberate, named prior-phase security requirement) already asserts
 * SANDBOXED buildAgentArgs *must* include --allow-read and --allow-net — i.e. that document
 * treats "no write access" as SANDBOXED's actual contract for this MCP-transport-carrying
 * strategy (the spawned process needs --allow-net to reach the MCP daemon), not the broader
 * CLAUDE.md "no network, no file access" SecurityMode vocabulary. That is a genuine,
 * unresolved design-intent question (which SecurityMode definition applies to this
 * out-of-process MCP strategy specifically) this test file must not silently decide by
 * asserting a behavior a named prior-phase test already asserts the opposite of — two tests
 * permanently contradicting each other is a broken suite state regardless of which side is
 * "right". Only the HYBRID/--allow-all claim is retained here: no existing test defends
 * --allow-all as HYBRID's correct scope, and unrestricted access is excessive under either
 * reading of SANDBOXED-vs-HYBRID. Flagged for the user to resolve the net/read question
 * explicitly before any fix touches buildAgentArgs; do not add those assertions back without
 * that resolution.
 */

import { assert } from "@std/assert";
import { McpAgentStrategy } from "@exaix/execution";
import { ProcessManager, SecurityMode } from "@exaix/core";
import type { AgentOrchestrator, IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions } from "@exaix/schemas/agent_orchestrator.ts";

const MINIMAL_BLUEPRINT: IAgentFileBlueprint = {
  name: "test-agent",
  model: "test-model",
  provider: "test-provider",
  capabilities: [],
  systemPrompt: "test",
};

function buildOptions(security_mode: SecurityMode): IAgentExecutionOptions {
  return {
    identity_id: "test-identity",
    portal: "test-portal",
    security_mode,
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

/** Reflection access mirrors the established pattern in mcp_strategy_stderr_test.ts for testing this class's private methods. */
function getBuildAgentArgs(
  strategy: McpAgentStrategy,
): (blueprint: IAgentFileBlueprint, options: IAgentExecutionOptions) => string[] {
  return Reflect.get(strategy, "buildAgentArgs") as (
    blueprint: IAgentFileBlueprint,
    options: IAgentExecutionOptions,
  ) => string[];
}

Deno.test("[security] McpAgentStrategy: HYBRID must not grant unrestricted --allow-all (Phase 170 Weakness 1)", () => {
  const strategy = new McpAgentStrategy({} as AgentOrchestrator, new ProcessManager());
  try {
    const buildAgentArgs = getBuildAgentArgs(strategy);
    const args = buildAgentArgs.call(strategy, MINIMAL_BLUEPRINT, buildOptions(SecurityMode.HYBRID));

    assert(
      !args.includes("--allow-all"),
      `SecurityMode.HYBRID must not include --allow-all (CLAUDE.md: "read-only Portal paths", ` +
        `not unrestricted access); got: ${args.join(" ")}`,
    );
  } finally {
    strategy.dispose();
  }
});
