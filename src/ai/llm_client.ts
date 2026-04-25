/**
 * @module LlmClient
 * @path src/ai/llm_client.ts
 * @description ReAct reasoning engine that prompts LLM for next action selection.
 * @architectural-layer AI
 * * @related-files [src/flows/dynamic_step_executor.ts, src/ai/providers.ts]
 */
import type { ILlmClient, ToolArgs } from "../flows/dynamic_step_executor.ts";
import type { IBlueprintFrontmatter } from "@exaix/schemas/blueprint.ts";
import { McpToolName, ReActActionType } from "../shared/enums.ts";
import { ModelFactory } from "./providers.ts";
import type { Config } from "@exaix/schemas/config.ts";
import { z } from "zod";
import type { JSONValue } from "@exaix/core";

interface RawLlmError {
  message?: string;
  [key: string]: JSONValue | undefined;
}

type LlmErrorPayload = Error | string | object | null | undefined;

function getErrorMessage(error: LlmErrorPayload): string {
  return error instanceof Error ? error.message : String(error);
}

const ReActResponseSchema = z.object({
  reasoning: z.string(),
  action: z.object({
    type: z.nativeEnum(ReActActionType),
    tool: z.nativeEnum(McpToolName).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    output: z.string().optional(),
  }),
});

const REACT_PROMPT_TEMPLATE = `
You are {identity_name}, {identity_description}.

Step Objective: {step_objective}

Available Tools:
{tools_description}

Current Context:
{accumulated_context}

Iteration: {iteration} of {max_iterations}

Reason about what action to take next. Either:
1. Select a tool and provide arguments, OR
2. Declare the step complete with your findings

Respond in JSON format:
{
  "reasoning": "Why I'm taking this action",
  "action": {
    "type": "${ReActActionType.TOOL_CALL} | ${ReActActionType.COMPLETE}",
    "tool": "tool_name",
    "args": {...},
    "output": "final output when complete"
  }
}
`;

export class LlmClient implements ILlmClient {
  constructor(private readonly config?: Config) {}

  async reasonNextAction(params: {
    identity: IBlueprintFrontmatter;
    stepObjective: string;
    accumulatedContext: string;
    availableTools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, JSONValue>;
    }>;
    iteration: number;
    maxIterations: number;
  }): Promise<{
    done: boolean;
    tool?: McpToolName;
    args?: ToolArgs;
    output?: string;
  }> {
    const { identity, stepObjective, accumulatedContext, availableTools, iteration, maxIterations } = params;

    const providerModel = identity.model ?? "gpt-4o";
    const provider = await ModelFactory.create(providerModel, this.config?.models?.[providerModel]);

    // Provide detailed tools description with JSON schemas
    const toolsDesc = availableTools
      .map((t) => `- ${t.name}: ${t.description}\n  Schema: ${JSON.stringify(t.inputSchema)}`)
      .join("\n");
    const accCtx = accumulatedContext || "[No previous tool calls yet]";

    const prompt = REACT_PROMPT_TEMPLATE
      .replace("{identity_name}", identity.name)
      .replace("{identity_description}", identity.description ?? "an expert assistant")
      .replace("{step_objective}", stepObjective)
      .replace("{tools_description}", toolsDesc)
      .replace("{accumulated_context}", accCtx)
      .replace("{iteration}", iteration.toString())
      .replace("{max_iterations}", maxIterations.toString());

    const result = await provider.generate(prompt);
    const responseStr = result.content;

    // Attempt multiple parsing strategies
    let jsonMatch = responseStr.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      jsonMatch = responseStr.match(/```\n([\s\S]*?)\n```/);
    }

    let rawJsonStr = jsonMatch ? jsonMatch[1] : responseStr;
    rawJsonStr = rawJsonStr.trim();

    // In rare cases the model might prepend logic, so a simple `{` index search can help fallback
    if (rawJsonStr.indexOf("{") !== 0) {
      const startIdx = rawJsonStr.indexOf("{");
      const endIdx = rawJsonStr.lastIndexOf("}");
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        rawJsonStr = rawJsonStr.substring(startIdx, endIdx + 1);
      }
    }

    try {
      const parsed = JSON.parse(rawJsonStr);
      const decision = ReActResponseSchema.parse(parsed);

      if (decision.action.type === "complete") {
        return {
          done: true,
          output: decision.action.output,
        };
      }

      if (decision.action.type === "tool_call" && decision.action.tool) {
        return {
          done: false,
          tool: decision.action.tool,
          args: (decision.action.args ?? {}) as ToolArgs,
        };
      }

      throw new Error("Invalid reasoning response format: missing tool name for tool_call");
    } catch (error) {
      // For now, fail loudly on schema validation
      throw new Error(`Failed to parse LLM response: ${getErrorMessage(error as LlmErrorPayload)}`);
    }
  }
}
