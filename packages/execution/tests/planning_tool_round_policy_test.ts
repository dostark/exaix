/**
 * @module PlanningToolRoundPolicyTest
 * @path packages/execution/tests/planning_tool_round_policy_test.ts
 * @description Verifies that PlanningToolLoop reads the resolved tool-round policy on each model turn:
 *   off runs one call per round and asks the provider for one, auto runs up to the loop cap and sends no
 *   disable hint, and the final NONE round is unchanged. A policy change applies from the next round.
 * @architectural-layer Test
 * @related-files [packages/execution/src/planning_tool_loop.ts, packages/schemas/src/tools_round_policy.ts]
 */

import { assertEquals } from "@std/assert";
import { PlanningToolLoop } from "../src/planning_tool_loop.ts";
import type { IPlanningToolLoopDeps, IPlanningToolLoopOptions } from "../src/planning_tool_loop.ts";
import type { ICallSite, IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult, IProviderToolCall } from "@exaix/ai/providers";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";
import { ToolsRoundMode } from "@exaix/core";
import type { IToolsRoundPolicy } from "@exaix/schemas";

const REFUSAL_TEXT = "tool call limit reached for this round; call skipped";

/** A real portal: the confinement guard resolves each path, so the files must exist. */
const PORTAL_ROOT = Deno.makeTempDirSync({ prefix: "planning-round-policy-" });
for (const name of ["a.ts", "b.ts", "c.ts", "file-0.ts", "file-1.ts", "file-2.ts"]) {
  Deno.writeTextFileSync(`${PORTAL_ROOT}/${name}`, "export {};\n");
}
globalThis.addEventListener("unload", () => Deno.removeSync(PORTAL_ROOT, { recursive: true }));

class RecordingRegistry implements IToolRegistry {
  calls: Array<{ name: string; params: Record<string, JSONValue> }> = [];
  getTools(): ITool[] {
    return [{ name: "read_file", description: "Read", parameters: { type: "object", properties: {} } }];
  }
  execute(name: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    this.calls.push({ name, params });
    return Promise.resolve({ success: true, data: { ok: true } });
  }
  getBaseDir(): string {
    return "/tmp/planning-round-policy";
  }
}

const TOKENIZER = {
  countTokens: (text: string) => Promise.resolve(Math.ceil(text.length / 4)),
  countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((t) => Math.ceil(t.length / 4))),
};

function result(toolCalls: IProviderToolCall[] | undefined, content = ""): IGenerateResult {
  return {
    content,
    toolCalls,
    usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
    model: "policy-model",
    provider: "policy-provider",
  };
}

function calls(count: number, idPrefix = "call"): IProviderToolCall[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${idPrefix}-${index}`,
    name: "read_file",
    input: { path: `file-${index}.ts` },
  }));
}

class ScriptedGenerate {
  calls: Array<{ prompt: string; options: IModelOptions }> = [];
  private index = 0;
  constructor(private readonly responses: IGenerateResult[]) {}
  generate = (prompt: string, options: IModelOptions): Promise<IGenerateResult> => {
    this.calls.push({ prompt, options });
    const response = this.responses[this.index++];
    if (!response) throw new Error(`no scripted response for call ${this.index}`);
    return Promise.resolve(response);
  };
}

function policy(mode: ToolsRoundMode, executionCap: number): IToolsRoundPolicy {
  return {
    mode,
    executionCap,
    concurrency: mode === ToolsRoundMode.OFF ? 1 : 4,
    maxResponseCalls: 64,
    maxArgumentBytes: 65536,
    maxReplayBytes: 1048576,
    resultTokenCap: 2000,
  };
}

function options(overrides: Partial<IPlanningToolLoopOptions> = {}): IPlanningToolLoopOptions {
  return {
    prompt: "Plan the change.",
    baseOptions: {},
    nextCallSite: (): ICallSite | undefined => undefined,
    portalAlias: "policy",
    portalRoot: PORTAL_ROOT,
    allowedTools: new Set(["read_file"]),
    maxRounds: 2,
    maxToolResultTokens: 2000,
    maxToolCallsPerRound: 10,
    traceId: "trace-policy",
    ...overrides,
  };
}

function loop(
  generate: ScriptedGenerate,
  registry: RecordingRegistry,
  toolsRoundPolicy?: () => IToolsRoundPolicy,
): PlanningToolLoop {
  const deps: IPlanningToolLoopDeps = {
    toolRegistry: registry,
    tokenizer: TOKENIZER,
    modelId: "policy-model",
    generate: generate.generate,
    ...(toolsRoundPolicy ? { toolsRoundPolicy } : {}),
  };
  return new PlanningToolLoop(deps);
}

Deno.test("[planning tools policy] off runs one call of three and refuses the other two with error results", async () => {
  const registry = new RecordingRegistry();
  const generate = new ScriptedGenerate([result(calls(3)), result(undefined, "plan")]);
  await loop(generate, registry, () => policy(ToolsRoundMode.OFF, 1)).run(options());

  assertEquals(registry.calls.length, 1);
  // The last call of a legacy round replays as priorTurn. The earlier ones sit in the prompt transcript.
  const next = generate.calls[1];
  const replayed = next.prompt + JSON.stringify(next.options.priorTurn ?? {});
  assertEquals(replayed.split(REFUSAL_TEXT).length - 1, 2);
});

Deno.test("[planning tools policy] auto runs up to the policy cap and sends no disable hint on a round", async () => {
  const registry = new RecordingRegistry();
  const generate = new ScriptedGenerate([result(calls(3)), result(undefined, "plan")]);
  await loop(generate, registry, () => policy(ToolsRoundMode.AUTO, 3)).run(options());

  assertEquals(registry.calls.length, 3);
  assertEquals(generate.calls[0].options.toolChoice, { type: "auto" });
});

Deno.test("[planning tools policy] off sends the disable hint on each tool round and NONE on the final round", async () => {
  const registry = new RecordingRegistry();
  const generate = new ScriptedGenerate([result(calls(1)), result(undefined, "plan")]);
  await loop(generate, registry, () => policy(ToolsRoundMode.OFF, 1)).run(options());

  assertEquals(generate.calls[0].options.toolChoice, { type: "auto", disable_parallel_tool_use: true });
  assertEquals(generate.calls[1].options.toolChoice, { type: "none" });
});

Deno.test("[planning tools policy] a policy change applies from the next round, not mid-round", async () => {
  const registry = new RecordingRegistry();
  const policies = [policy(ToolsRoundMode.OFF, 1), policy(ToolsRoundMode.AUTO, 3), policy(ToolsRoundMode.AUTO, 3)];
  let reads = 0;
  const generate = new ScriptedGenerate([
    result(calls(1, "first")),
    result(calls(3, "second")),
    result(undefined, "plan"),
  ]);
  await loop(generate, registry, () => policies[reads++]).run(options({ maxRounds: 3 }));

  assertEquals(reads, 3);
  assertEquals(generate.calls[0].options.toolChoice, { type: "auto", disable_parallel_tool_use: true });
  assertEquals(generate.calls[1].options.toolChoice, { type: "auto" });
  assertEquals(registry.calls.length, 4);
});
