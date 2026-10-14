/**
 * @module NativeToolRoundHarness
 * @path tests/helpers/native_tool_round_harness.ts
 * @description Shared harness for the phase-202 round-replay tests. A wire family builds the
 *   response a provider returns for a tool round and reads the follow-up request back. The family
 *   is chosen from the binding's adapter, so a test is parametrized by provider and model, not by
 *   a hand-written fixture. runBoundRound binds a provider with createLlmProvider and runs it through
 *   PlanningToolLoop with scripted HTTP.
 * @architectural-layer Test
 * @dependencies [@exaix/execution, @exaix/ai, @exaix/core, ./llm_bindings.ts]
 * @related-files [
 *   "tests/integration/native_tool_round_provider_test.ts",
 *   "tests/integration/native_tool_round_live_test.ts",
 *   "packages/execution/src/planning_tool_loop.ts"
 * ]
 */

import { PlanningToolLoop } from "@exaix/execution";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import type { IModelOptions } from "@exaix/ai/types.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { IBindingSpec, IToolsRoundPolicy } from "@exaix/schemas";
import type { IPromptBudget } from "@exaix/schemas/prompt_budget.ts";
import type { ITool, IToolRegistry, IToolResult, JSONValue, Opt, Reason } from "@exaix/core/types";
import type { IModelProvider, JSONObject } from "@exaix/ai/types.ts";
import { createLlmProvider } from "./llm_bindings.ts";

/** One tool call of a scripted round. Gemini calls have no id, so their id is only used to join results. */
export interface IWireCall {
  id: string;
  name: string;
  input: JSONObject;
}

/** The response a round returns, and the assistant turn the follow-up request must replay verbatim. */
export interface IWireRound {
  body: JSONObject;
  assistant: JSONValue;
}

export interface IGeminiRequest {
  contents: Array<{ role: string; parts: JSONValue[] }>;
}

export interface IAnthropicRequest {
  messages: Array<{ role: string; content: JSONValue }>;
}

export interface IChatRequest {
  messages: Array<{ role: string; content?: JSONValue; tool_call_id?: string }>;
}

export interface IResponsesRequest {
  input: JSONObject[];
}

/** Any follow-up request a wire family reads back. */
export type IWireRequest = IGeminiRequest | IAnthropicRequest | IChatRequest | IResponsesRequest;

/** One replayed exchange: an assistant turn and the results that answer it, in order. */
export interface IWireExchange {
  assistant: JSONValue;
  results: string[];
}

/** The adapter-specific wire shape of one family of providers. */
export interface IWireFamily {
  /** The model is the id the fixture reports, so a provider that prices by returned model matches the request. */
  roundResponse(calls: readonly IWireCall[], model: string): IWireRound;
  finalResponse(text: string, model: string): JSONObject;
  /** The assistant turn of the follow-up request: the second message of the conversation. */
  replayedAssistant(request: IWireRequest): JSONValue;
  /** The content of each result the follow-up request carries, in order. */
  replayedResults(request: IWireRequest): string[];
  /** Every exchange the request replays natively, oldest first. */
  replayedExchanges(request: IWireRequest): IWireExchange[];
}

/** What a planning run returns: the registry that recorded the reads, and the final text. */
export interface IPlanningRoundRun {
  registry: RecordingToolRegistry;
  final: string;
}

/** A planning run against a bound provider, with every request its scripted transport received. */
export interface IBoundRoundRun extends IPlanningRoundRun {
  requests: IWireRequest[];
}

/** The inputs of one planning run. A budget and a measurement are set when a test measures each round. */
export interface IPlanningRoundOptions {
  /** The request to plan. Absent, the shared fixture asks for a generic change. */
  prompt?: string;
  modelId: string;
  maxRounds: number;
  portalRoot: string;
  traceId: string;
  baseOptions?: IModelOptions;
  promptBudget?: IPromptBudget;
  measureInputTokens?: IModelProvider["measureInputTokens"];
  /** The tool-round policy read on each model turn. Absent, the loop's own caps and auto apply. */
  toolsRoundPolicy?: () => IToolsRoundPolicy;
}

/** The adapter a binding resolves to. OpenAI itself uses the Responses shape. Compatible servers keep Chat Completions. */
export function wireFamilyFor(adapter: string): IWireFamily {
  if (adapter === "google") return GEMINI_FAMILY;
  if (adapter === "anthropic") return ANTHROPIC_FAMILY;
  if (adapter === "openai") return RESPONSES_FAMILY;
  if (adapter === "openrouter") return OPENROUTER_FAMILY;
  return CHAT_FAMILY;
}

function asObject(value?: Opt<JSONValue, Reason.ShapeValidation>): JSONObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
  throw new Error("expected a JSON object in the replayed request");
}

function asArray(value?: Opt<JSONValue, Reason.ShapeValidation>): JSONValue[] {
  if (Array.isArray(value)) return value;
  throw new Error("expected a JSON array in the replayed request");
}

function textOf(value?: Opt<JSONValue, Reason.ShapeValidation>): string {
  if (typeof value === "string") return value;
  throw new Error("expected a string result in the replayed request");
}

const TEXT_PREAMBLE = "I will read both files.";
const USAGE = { promptTokenCount: 1, candidatesTokenCount: 1 };

const GEMINI_FAMILY: IWireFamily = {
  roundResponse(calls) {
    const parts: JSONObject[] = [
      { text: TEXT_PREAMBLE },
      ...calls.map((call, index): JSONObject => ({
        functionCall: { name: call.name, args: call.input },
        ...(index === 0 ? { thoughtSignature: "sig-a" } : {}),
      })),
    ];
    return {
      body: { candidates: [{ content: { role: "model", parts } }], usageMetadata: USAGE },
      assistant: { role: "model", parts },
    };
  },
  finalResponse(text) {
    return { candidates: [{ content: { role: "model", parts: [{ text }] } }], usageMetadata: USAGE };
  },
  replayedAssistant(request) {
    return (request as IGeminiRequest).contents[1];
  },
  replayedResults(request) {
    const parts = (request as IGeminiRequest).contents[2]?.parts ?? [];
    return parts
      .map((part) => asObject(part))
      .filter((part) => part.functionResponse !== undefined)
      .map((part) => textOf(asObject(asObject(part.functionResponse).response).content));
  },
  replayedExchanges(request) {
    const exchanges: IWireExchange[] = [];
    for (const content of (request as IGeminiRequest).contents.slice(1)) {
      if (content.role === "model") {
        exchanges.push({ assistant: content, results: [] });
        continue;
      }
      const answered = content.parts
        .map((part) => asObject(part))
        .filter((part) => part.functionResponse !== undefined)
        .map((part) => textOf(asObject(asObject(part.functionResponse).response).content));
      exchanges.at(-1)?.results.push(...answered);
    }
    return exchanges;
  },
};

const ANTHROPIC_FAMILY: IWireFamily = {
  roundResponse(calls) {
    const content: JSONObject[] = [
      { type: "thinking", thinking: "Read both files first.", signature: "sig-thinking" },
      { type: "text", text: TEXT_PREAMBLE },
      ...calls.map((call): JSONObject => ({ type: "tool_use", id: call.id, name: call.name, input: call.input })),
    ];
    return {
      body: { content, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } },
      assistant: { role: "assistant", content },
    };
  },
  finalResponse(text) {
    return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  },
  replayedAssistant(request) {
    return (request as IAnthropicRequest).messages[1]!;
  },
  replayedResults(request) {
    return asArray((request as IAnthropicRequest).messages[2]?.content)
      .map((block) => asObject(block))
      .filter((block) => block.type === "tool_result")
      .map((block) => textOf(block.content));
  },
  replayedExchanges(request) {
    const exchanges: IWireExchange[] = [];
    for (const message of (request as IAnthropicRequest).messages.slice(1)) {
      if (message.role === "assistant") {
        exchanges.push({ assistant: message, results: [] });
        continue;
      }
      const answered = Array.isArray(message.content)
        ? message.content
          .map((block) => asObject(block))
          .filter((block) => block.type === "tool_result")
          .map((block) => textOf(block.content))
        : [];
      exchanges.at(-1)?.results.push(...answered);
    }
    return exchanges;
  },
};

const REASONING_DETAILS: JSONObject[] = [
  { type: "reasoning.text", text: "Read both files first.", signature: "sig-r" },
  { type: "reasoning.summary", summary: "Two reads." },
];

const CHAT_FAMILY: IWireFamily = {
  roundResponse(calls, model) {
    const toolCalls = calls.map((call): JSONObject => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.input) },
    }));
    const message: JSONObject = {
      role: "assistant",
      content: TEXT_PREAMBLE,
      reasoning_content: "Read both first.",
      reasoning_details: REASONING_DETAILS,
      tool_calls: toolCalls,
    };
    return {
      body: {
        model,
        choices: [{ message, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
      assistant: { role: "assistant", ...message },
    };
  },
  finalResponse(text, model) {
    return {
      model,
      choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  },
  replayedAssistant(request) {
    return (request as IChatRequest).messages[1]!;
  },
  replayedResults(request) {
    return (request as IChatRequest).messages
      .slice(2)
      .filter((message) => message.role === "tool")
      .map((message) => textOf(message.content));
  },
  replayedExchanges(request) {
    const exchanges: IWireExchange[] = [];
    for (const message of (request as IChatRequest).messages.slice(1)) {
      if (message.role === "assistant") exchanges.push({ assistant: message, results: [] });
      else if (message.role === "tool") exchanges.at(-1)?.results.push(textOf(message.content));
    }
    return exchanges;
  },
};

/** OpenRouter replays `reasoning_details` only, so the replayed assistant carries no `reasoning_content`. */
const OPENROUTER_FAMILY: IWireFamily = {
  ...CHAT_FAMILY,
  roundResponse(calls, model) {
    const round = CHAT_FAMILY.roundResponse(calls, model);
    const assistant = { ...asObject(round.assistant) };
    delete assistant.reasoning_content;
    return { ...round, assistant };
  },
};

/** The /v1/responses shape. A round's output items are the assistant turn, and each result is a function_call_output. */
const RESPONSES_FAMILY: IWireFamily = {
  roundResponse(calls, model) {
    const output: JSONObject[] = [
      { type: "reasoning", id: "rs_round", summary: [], encrypted_content: "ENC-round" },
      ...calls.map((call): JSONObject => ({
        type: "function_call",
        id: `fc_${call.id}`,
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.input),
        status: "completed",
      })),
    ];
    return {
      body: { model, status: "completed", output, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      assistant: output,
    };
  },
  finalResponse(text, model) {
    return {
      model,
      status: "completed",
      output: [{
        type: "message",
        id: "msg_final",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
  },
  replayedAssistant(request) {
    // The round instruction is a user control message, not replayed assistant content.
    return (request as IResponsesRequest).input.slice(1).filter((item) =>
      item.type !== "function_call_output" && item.role !== "user"
    );
  },
  replayedResults(request) {
    return (request as IResponsesRequest).input
      .filter((item) => item.type === "function_call_output")
      .map((item) => textOf(item.output));
  },
  replayedExchanges(request) {
    const exchanges: IWireExchange[] = [];
    for (const item of (request as IResponsesRequest).input.slice(1)) {
      if (item.role === "user") continue;
      if (item.type === "function_call_output") {
        exchanges.at(-1)?.results.push(textOf(item.output));
        continue;
      }
      const current = exchanges.at(-1);
      if (current === undefined || current.results.length > 0) exchanges.push({ assistant: [item], results: [] });
      else if (Array.isArray(current.assistant)) current.assistant.push(item);
    }
    return exchanges;
  },
};

/** A body-less request to this path is a capability lookup, not a scripted model call. */
const MODELS_CATALOG_PATH = "/models";

/** Serves scripted bodies in order and records every model request body it receives. */
export function scriptedFetch(bodies: JSONObject[]): { requests: IWireRequest[]; restore: () => void } {
  const requests: IWireRequest[] = [];
  const original = globalThis.fetch;
  let index = 0;
  globalThis.fetch = (input: string | Request | URL, init?: Opt<RequestInit, Reason.AbstractBoundary>) => {
    if (init?.body === undefined && String(input).endsWith(MODELS_CATALOG_PATH)) {
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    }
    requests.push(JSON.parse((init?.body as string) ?? "{}"));
    const body = bodies[index++];
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  };
  return { requests, restore: () => void (globalThis.fetch = original) };
}

/** Serves the portal fixture. Each read is recorded as `read_file:<path>` after alias enrichment. */
export class RecordingToolRegistry implements IToolRegistry {
  public calls: string[] = [];
  constructor(private readonly root: string) {}
  getTools(): ITool[] {
    return [{
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
    }];
  }
  execute(toolName: string, params: Record<string, JSONValue>): Promise<IToolResult> {
    this.calls.push(`${toolName}:${String(params.path)}`);
    return Promise.resolve({ success: true, data: { content: `BODY-${String(params.path)}` } });
  }
  getBaseDir(): string {
    return this.root;
  }
}

/** Runs PlanningToolLoop over a built provider, generating every round through that provider. */
export async function runPlanningRound(
  provider: IModelProvider,
  options: IPlanningRoundOptions,
): Promise<IPlanningRoundRun> {
  const registry = new RecordingToolRegistry(options.portalRoot);
  const loop = new PlanningToolLoop({
    toolRegistry: registry,
    tokenizer: {
      countTokens: (t: string) => Promise.resolve(Math.ceil(t.length / 4)),
      countTokensBatch: (ts: string[]) => Promise.resolve(ts.map((t) => Math.ceil(t.length / 4))),
    },
    modelId: options.modelId,
    providerId: provider.id,
    generate: (prompt: string, opts: IModelOptions): Promise<IGenerateResult> => provider.generate(prompt, opts),
    measureInputTokens: options.measureInputTokens,
    toolsRoundPolicy: options.toolsRoundPolicy,
  });
  const result = await loop.run({
    prompt: options.prompt ?? "Plan the change.",
    baseOptions: options.baseOptions ?? {},
    nextCallSite: () => ({ scenarioId: "native-round", stepId: "replay", callIndex: 0 }),
    portalAlias: "fixture",
    portalRoot: options.portalRoot,
    allowedTools: new Set(["read_file"]),
    maxRounds: options.maxRounds,
    maxToolResultTokens: 2000,
    maxToolCallsPerRound: 10,
    traceId: options.traceId,
    promptBudget: options.promptBudget,
  });
  return { registry, final: result.final.content };
}

/** Binds the spec's provider, scripts its HTTP, and runs the planning loop with that provider id. */
export async function runBoundRound(options: {
  spec: IBindingSpec;
  apiKeyEnv: string;
  responses: JSONObject[];
  baseOptions?: IModelOptions;
  maxRounds: number;
  portalRoot: string;
  traceId: string;
  toolsRoundPolicy?: () => IToolsRoundPolicy;
}): Promise<IBoundRoundRun> {
  const { provider } = await createLlmProvider(options.spec);
  const scripted = scriptedFetch(options.responses);
  try {
    const run = await runPlanningRound(provider, {
      modelId: options.spec.service_model_id ?? "",
      maxRounds: options.maxRounds,
      portalRoot: options.portalRoot,
      traceId: options.traceId,
      baseOptions: options.baseOptions,
      toolsRoundPolicy: options.toolsRoundPolicy,
    });
    return { ...run, requests: scripted.requests };
  } finally {
    scripted.restore();
    ProviderRegistry.clear();
  }
}
