/**
 * @module CliDelegateTestFixtures
 * @path packages/execution/tests/helpers/cli_delegate_fixtures.ts
 * @description Blueprint, context, options, and output-line builders shared by the CLI delegate strategy tests.
 * @architectural-layer Test
 * @related-files [packages/execution/tests/agents/cli_delegate_strategy_test.ts, packages/execution/tests/agents/context_cli_test.ts]
 */

import { CliDelegateStrategy, type IAgentFileBlueprint, type IRunCliDelegateProcess } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";

export function makeBlueprint(): IAgentFileBlueprint {
  return {
    name: "senior-coder",
    model: "",
    provider: "",
    capabilities: ["code_generation", "cli_delegate"],
    systemPrompt: "You are an expert software engineer.",
  };
}

export function makeContext(overrides: Partial<IExecutionContext> = {}): IExecutionContext {
  return {
    trace_id: "11111111-1111-1111-1111-111111111111",
    request_id: "REQ-1",
    request: "Fix the null-guard bug in renderAvatar",
    plan: "Step 1: patch renderAvatar",
    portal: "main",
    ...overrides,
  };
}

export function makeOptions(): IAgentExecutionOptions {
  return {
    agent_role: "senior-coder",
    portal: "main",
    security_mode: "sandboxed" as IAgentExecutionOptions["security_mode"],
    timeout_ms: 300000,
    max_tool_calls: 100,
    audit_enabled: true,
  };
}

export function systemLine(sessionId: string): string {
  return JSON.stringify({ type: "system", session_id: sessionId });
}

type CliDelegateStrategyOptions = ConstructorParameters<typeof CliDelegateStrategy>[0];

const BIN_BY_TOOL: Record<string, string> = { "claude-code": "claude", opencode: "opencode", codex: "codex" };

/** A strategy for `tool` that runs `run` in place of the real CLI and resolves the portal to `/tmp/portal`. */
export function cliStrategy(
  tool: CliDelegateStrategyOptions["tool"],
  run: IRunCliDelegateProcess,
): CliDelegateStrategy {
  return new CliDelegateStrategy({ tool, bin: BIN_BY_TOOL[tool], resolvePortalPath: () => "/tmp/portal", run });
}
