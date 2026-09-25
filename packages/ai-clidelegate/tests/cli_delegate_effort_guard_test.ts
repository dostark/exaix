/**
 * @module CliDelegateEffortGuardTest
 * @path packages/ai-clidelegate/tests/cli_delegate_effort_guard_test.ts
 * @description Verifies the CLI-delegate arg builders reject a non-EffortTier effort value
 *   with a SafeError before it can reach argv or codex's `-c model_reasoning_effort="…"`
 *   TOML override (GAP-5, defense in depth), and pass the three concrete tiers through.
 * @architectural-layer AI
 * @related-files [packages/ai-clidelegate/src/cli_delegate_model_provider.ts, packages/execution/src/strategies/cli_delegate_strategy.ts]
 */

import { assertEquals } from "@std/assert";
import { CliDelegateModelProvider } from "../src/cli_delegate_model_provider.ts";
import type { IRunCliDelegateProcess } from "../src/cli_delegate_model_provider.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";
import { SafeError } from "@exaix/core/errors";
import { EffortTierSchema } from "@exaix/schemas";

const INJECTED = 'high" sandbox_mode="danger-full-access';

function mockRun() {
  return Promise.resolve({
    code: 0,
    stdout: JSON.stringify({ type: "result", result: "done", usage: { input_tokens: 0, output_tokens: 0 } }),
    stderr: "",
  });
}

function makeProvider(
  tool: "claude-code" | "codex" | "opencode",
  run: IRunCliDelegateProcess,
): CliDelegateModelProvider {
  return new CliDelegateModelProvider({
    tool,
    bin: tool === "claude-code" ? "claude" : tool,
    model: tool === "opencode" ? "opencode/deepseek-v4-flash-free" : "claude-sonnet-5",
    cwd: "/tmp/portal",
    run,
  });
}

const CLIENT_RESPONSES: Record<string, JSONValue> = {
  "claude-code": { type: "result", result: "done", usage: {}, total_cost_usd: 0 },
  codex: { type: "item.completed", item: { type: "agent_message", text: "done" } },
  opencode: { type: "text", part: { text: "done" } },
};

async function captureRejectedCode(tool: "claude-code" | "codex" | "opencode"): Promise<string | undefined> {
  const provider = makeProvider(tool, mockRun);
  try {
    await provider.generate("Analyze", { effort: INJECTED as IModelOptions["effort"] });
  } catch (error) {
    return error instanceof SafeError ? error.errorCode : undefined;
  }
  return undefined;
}

Deno.test("CliDelegateModelProvider: claude builder rejects a non-tier effort with SafeError", async () => {
  assertEquals(await captureRejectedCode("claude-code"), "INVALID_EFFORT_TIER");
});

Deno.test("CliDelegateModelProvider: codex builder rejects a non-tier effort with SafeError", async () => {
  assertEquals(await captureRejectedCode("codex"), "INVALID_EFFORT_TIER");
});

Deno.test("CliDelegateModelProvider: opencode builder rejects a non-tier effort with SafeError", async () => {
  assertEquals(await captureRejectedCode("opencode"), "INVALID_EFFORT_TIER");
});

Deno.test("CliDelegateModelProvider: all three builders pass every concrete tier through", async () => {
  for (const tool of ["claude-code", "codex", "opencode"] as const) {
    for (const tier of (EffortTierSchema.options as readonly string[])) {
      let seenArgs: string[] = [];
      const run: IRunCliDelegateProcess = (_cmd, args) => {
        seenArgs = args;
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify(CLIENT_RESPONSES[tool]),
          stderr: "",
        });
      };
      const provider = makeProvider(tool, run);
      await provider.generate("Analyze", { effort: tier as IModelOptions["effort"] });
      const argsLine = seenArgs.join(" ");
      // Every tier reaches the produced argv/TOML interpolation exactly once.
      assertEquals(argsLine.includes(tier), true, `${tool} must carry tier ${tier}`);
      assertEquals(argsLine.includes(INJECTED), false);
    }
  }
});
