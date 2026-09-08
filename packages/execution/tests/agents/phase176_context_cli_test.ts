/**
 * @module Phase176ContextCliTest
 * @path packages/execution/tests/agents/phase176_context_cli_test.ts
 * @description Phase 176 Step 1: CliDelegateStrategy's dogfood context wiring. Absent
 * contextPort (every non-dogfood/disabled-config caller) sends the existing objective
 * byte-for-byte; an injected contextPort's returned prompt is what actually reaches the
 * CLI subprocess; a prepare() failure aborts the launch before the subprocess spawns
 * (never falls back to the unaugmented objective); turn increments across resumed calls
 * for the same trace_id.
 * @architectural-layer Tests
 * @related-files [packages/execution/src/strategies/cli_delegate_strategy.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { AgentExecutionError, CliDelegateStrategy } from "@exaix/execution";
import type { IAgentFileBlueprint, IRunCliDelegateProcess } from "@exaix/execution";
import type { IAgentExecutionOptions, IExecutionContext } from "@exaix/schemas/agent_composer.ts";
import type { IDogfoodContextHandle, IDogfoodContextInput, IDogfoodContextPort } from "@exaix/core/types";

function makeBlueprint(): IAgentFileBlueprint {
  return {
    name: "senior-coder",
    model: "",
    provider: "",
    capabilities: ["code_generation", "cli_delegate"],
    systemPrompt: "You are an expert software engineer.",
  };
}

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

function resultLine(result: string): string {
  return JSON.stringify({ type: "result", result, usage: { input_tokens: 10, output_tokens: 5 } });
}

function makeFakeRun(): { run: IRunCliDelegateProcess; calls: string[][] } {
  const calls: string[][] = [];
  const run: IRunCliDelegateProcess = (_command, args) => {
    calls.push(args);
    return Promise.resolve({ code: 0, stdout: resultLine("done"), stderr: "" });
  };
  return { run, calls };
}

function makeContextPort(
  prompt: string,
): { port: IDogfoodContextPort; inputs: IDogfoodContextInput[] } {
  const inputs: IDogfoodContextInput[] = [];
  const port: IDogfoodContextPort = {
    prepare(input: IDogfoodContextInput): Promise<IDogfoodContextHandle> {
      inputs.push(input);
      return Promise.resolve({ recordId: crypto.randomUUID(), prompt });
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
  return { port, inputs };
}

function makeFailingContextPort(): IDogfoodContextPort {
  return {
    prepare(): Promise<IDogfoodContextHandle> {
      return Promise.reject(new Error("budget exceeded"));
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}

Deno.test("[CliDelegateStrategy] absent contextPort sends the existing objective byte-for-byte (non-dogfood parity)", async () => {
  const { run, calls } = makeFakeRun();
  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
  });

  await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertStringIncludes(calls[0][1], "Fix the null-guard bug in renderAvatar");
  assertEquals(calls[0][1].includes("---"), false, "no dogfood supplement separator without a contextPort");
});

Deno.test("[CliDelegateStrategy] an injected contextPort's returned prompt is what reaches the CLI subprocess", async () => {
  const { run, calls } = makeFakeRun();
  const { port, inputs } = makeContextPort("AUGMENTED PROMPT WITH SUPPLEMENT");
  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
    contextPort: port,
  });

  await strategy.execute(makeBlueprint(), makeContext(), makeOptions());

  assertEquals(calls[0][1], "AUGMENTED PROMPT WITH SUPPLEMENT");
  assertEquals(inputs.length, 1);
  assertEquals(inputs[0].executionTraceId, "11111111-1111-1111-1111-111111111111");
  assertEquals(inputs[0].surface, "cli_delegate");
  assertStringIncludes(inputs[0].originalPrompt, "Fix the null-guard bug in renderAvatar");
});

Deno.test("[CliDelegateStrategy] a prepare() failure aborts the launch before the subprocess spawns", async () => {
  const { run, calls } = makeFakeRun();
  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
    contextPort: makeFailingContextPort(),
  });

  await assertRejects(
    () => strategy.execute(makeBlueprint(), makeContext(), makeOptions()),
    AgentExecutionError,
  );
  assertEquals(calls.length, 0, "the CLI subprocess must never spawn when context assembly fails");
});

Deno.test("[CliDelegateStrategy] turn increments across resumed calls for the same trace_id", async () => {
  const { run } = makeFakeRun();
  const { port, inputs } = makeContextPort("prompt");
  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
    contextPort: port,
  });

  const context = makeContext();
  await strategy.execute(makeBlueprint(), context, makeOptions());
  await strategy.execute(makeBlueprint(), context, makeOptions());

  assertEquals(inputs.map((i) => i.turn), [0, 1]);
});

Deno.test("[CliDelegateStrategy] first-turn full-plan objective is preserved as the contextPort's originalPrompt", async () => {
  const { run } = makeFakeRun();
  const { port, inputs } = makeContextPort("prompt");
  const strategy = new CliDelegateStrategy({
    tool: "claude-code",
    bin: "claude",
    resolvePortalPath: () => "/tmp/portal",
    run,
    contextPort: port,
  });

  await strategy.execute(
    makeBlueprint(),
    makeContext({ full_plan: "Step 1: patch renderAvatar\nStep 2: add regression test" }),
    makeOptions(),
  );

  assertStringIncludes(inputs[0].originalPrompt, "FULL PLAN:");
  assertStringIncludes(inputs[0].originalPrompt, "Step 2: add regression test");
});
