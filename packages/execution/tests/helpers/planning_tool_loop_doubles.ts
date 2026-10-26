/**
 * @module PlanningToolLoopTestDoubles
 * @path packages/execution/tests/helpers/planning_tool_loop_doubles.ts
 * @description Tool registry, tokenizer, and scripted-generate doubles shared by the planning tool loop tests.
 * @architectural-layer Test
 * @related-files [packages/execution/tests/planning_tool_loop_test.ts, packages/execution/tests/planning_tool_loop_security_test.ts]
 */

import type { IPlanningToolLoopDeps } from "../../src/planning_tool_loop.ts";
import type { ICallSite, IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { ITool, IToolRegistry, IToolResult, JSONValue } from "@exaix/core/types";

/** Records every execute() call and dispatches to a per-tool handler (or a default). */
export class StubToolRegistry implements IToolRegistry {
  public calls: Array<{ name: string; params: Record<string, JSONValue> }> = [];
  constructor(
    private readonly tools: ITool[] = [],
    private readonly handlers: Record<
      string,
      (params: Record<string, JSONValue>) => IToolResult | Promise<IToolResult>
    > = {},
    private readonly defaultResult: IToolResult = { success: true, data: {} },
  ) {}
  getTools(): ITool[] {
    return this.tools;
  }
  async execute(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    this.calls.push({ name: toolName, params });
    const handler = this.handlers[toolName];
    return handler ? await handler(params) : this.defaultResult;
  }
  getBaseDir(): string {
    return "/tmp/stub-tool-registry";
  }
}

export function fixtureTool(name: string): ITool {
  return { name, description: `${name} description`, parameters: { type: "object", properties: {} } };
}

/** A network-free tokenizer for tests that do not need the real catalog. It counts one token per 4 characters. */
export const stubTokenizer = {
  countTokens: (text: string) => Promise.resolve(Math.ceil(text.length / 4)),
  countTokensBatch: (texts: string[]) => Promise.resolve(texts.map((t) => Math.ceil(t.length / 4))),
};

/** Replays scripted IGenerateResult responses in order and records every (prompt, options) pair. */
export class ScriptedGenerate {
  public calls: Array<{ prompt: string; options: IModelOptions }> = [];
  private index = 0;
  constructor(private readonly responses: IGenerateResult[]) {}
  generate = (prompt: string, options: IModelOptions): Promise<IGenerateResult> => {
    this.calls.push({ prompt, options });
    const response = this.responses[this.index];
    this.index++;
    if (!response) throw new Error(`ScriptedGenerate: no scripted response for call #${this.index}`);
    return Promise.resolve(response);
  };
}

export function makeDeps(overrides: Partial<IPlanningToolLoopDeps> = {}): IPlanningToolLoopDeps {
  return {
    toolRegistry: new StubToolRegistry(),
    tokenizer: stubTokenizer,
    modelId: "gpt-4",
    generate: () => {
      throw new Error("generate() not stubbed for this test");
    },
    ...overrides,
  };
}

export function nextCallSiteFrom(scenarioId: string, stepId: string): () => ICallSite {
  let callIndex = 0;
  return () => ({ scenarioId, stepId, callIndex: callIndex++ });
}
