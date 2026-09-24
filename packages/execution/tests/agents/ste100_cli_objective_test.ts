/**
 * @module Ste100CliObjectiveTest
 * @path packages/execution/tests/agents/ste100_cli_objective_test.ts
 * @description Phase 195 Step 4 — proves the STE communication requirement reaches the
 *   effective CLI delegate objective that `CliDelegateStrategy.buildObjective` assembles
 *   (the same string that launches a real claude/opencode headless process). A converting
 *   Blueprint agent body must carry the compact rule so the CLI path receives it without a
 *   file fetch or optional skill match (`blueprint.systemPrompt` is prepended verbatim).
 * @architectural-layer Test
 * @related-files [
 *   "packages/execution/src/strategies/cli_delegate_strategy.ts",
 *   "packages/execution/src/blueprint_service.ts"
 * ]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { CliDelegateStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IRunCliDelegateProcess } from "@exaix/execution";
import { createMockConfig, createMockLogger, REPO_ROOT } from "@exaix/testing";
import { BlueprintService } from "@exaix/execution";

function makeContext(overrides: Partial<IExecutionContext> = {}): IExecutionContext {
  return {
    trace_id: "11111111-1111-1111-1111-111111111111",
    request_id: "REQ-1",
    request: "Fix the null-guard bug in renderAvatar",
    plan: "Step 1: patch renderAvatar",
    portal: "main",
    ...overrides,
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

Deno.test("CLI delegate receives STE in its effective objective", async () => {
  // Load the real converted (or scaffolded) agent body through the production
  // BlueprintService so the objective test exercises the exact systemPrompt text a
  // daemon-planned CLI turn would carry.
  const config = createMockConfig(REPO_ROOT);
  const service = new BlueprintService(config, createMockLogger());
  const { blueprint: loaded } = await service.loadBlueprint("default");
  const systemPrompt = loaded.systemPrompt;
  assertStringIncludes(systemPrompt, "Use ASD-STE100 and Exaix STE Extension v1 for instruction and response prose.");

  let capturedObjective = "";
  const run: IRunCliDelegateProcess = (_command, args, _options) => {
    const index = args.indexOf("-p");
    capturedObjective = index !== -1 ? args[index + 1] : "";
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ type: "result", result: "done", usage: { input_tokens: 10, output_tokens: 5 } }),
      stderr: "",
    });
  };

  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  const blueprint: IAgentFileBlueprint = { ...loaded, capabilities: ["code_generation", "cli_delegate"] };
  await strategy.execute(blueprint, makeContext(), makeOptions());

  // buildObjective prepends systemPrompt verbatim, so the compact STE rule must reach the
  // CLI process that the strategy spawns.
  assertStringIncludes(
    capturedObjective,
    "Use ASD-STE100 and Exaix STE Extension v1 for instruction and response prose.",
  );
  assertStringIncludes(capturedObjective, "Exempt documentation deliverables.");
  assertEquals(capturedObjective.includes("PLAN STEP:"), true);
});
