/**
 * @module OpenRouterLiveMatrix
 * @path tests/integration/helpers/openrouter_live_matrix.ts
 * @description Runs the planned live analysis and records redacted wire and journal evidence.
 * @architectural-layer Integration
 * @dependencies [@exaix/ai, @exaix/ai-openrouter, @exaix/request, @exaix/testing]
 * @related-files [tests/integration/openrouter_structured_output_live_test.ts, tests/integration/parallel_tool_round_live_test.ts]
 */
import { assert } from "@std/assert";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { PricingTier } from "@exaix/core";
import { EventLogger } from "@exaix/core/logger";
import { ProviderFactory, setProviderRegistryBootstrap } from "@exaix/ai/provider_factory.ts";
import { ProviderRegistry } from "@exaix/ai/provider_registry.ts";
import { OPENROUTER_PROVIDER_METADATA, OpenRouterProviderFactory, PROVIDER_OPENROUTER } from "@exaix/ai-openrouter";
import { ConfigSchema } from "@exaix/schemas/config.ts";
import { type IRequestAnalysis, RequestAnalysisCoreSchema } from "@exaix/schemas/request_analysis.ts";
import { LlmAnalyzer } from "@exaix/request";
import { initTestDbService } from "@exaix/testing";
import { createOutputValidator } from "@exaix/tool-runtime";

export interface IWireObservation {
  status: number;
  model: string | null;
  provider: string | null;
  requestedFormat: string | null;
  finishReason: string | null;
  reasoning: JSONValue | null;
  usage: JSONValue | null;
  errorCode: JSONValue | null;
  toolCalls: number;
}

interface IChatRequest {
  response_format?: { type?: string };
  reasoning?: JSONValue;
}

interface IChatReply {
  model?: string;
  provider?: string;
  usage?: JSONValue;
  error?: { code?: JSONValue };
  choices?: Array<{ finish_reason?: string; message?: { tool_calls?: JSONValue[] } }>;
}

export interface ILiveAnalysis {
  analysis: IRequestAnalysis;
  validCore: boolean;
  calls: IWireObservation[];
}

export interface IResponsesProbeSummary {
  status: number;
  completed: boolean;
  validOutput: boolean;
  outputTypes: string[];
  contentTypes: string[];
  outputChars: number;
}

export const MATRIX_MODELS: readonly string[] = [
  "inclusionai/ling-3.0-flash",
  "~deepseek/deepseek-flash-latest",
  "xiaomi/mimo-v2.6-flash",
  "qwen/qwen3.7-flash",
  "z-ai/glm-5.3-flash",
];
const API_BASE = "https://openrouter.ai/api/v1";
const LIVE_TIMEOUT_MS = 180_000;
const EVIDENCE_DIR = ".cache/phase-211/step-9";
const ANALYSIS_REQUEST = "Add unit tests for src/user_service.ts. Cover its public methods. Do not add dependencies.";
const OTHER_KEYS: readonly string[] = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "DEEPSEEK_API_KEY"];

/** Live tests require both the explicit paid opt-in and the OpenRouter key. */
export function liveMatrixEnabled(): boolean {
  return Deno.env.get("EXA_TEST_ENABLE_PAID_LLM") === "1" && Boolean(Deno.env.get("OPENROUTER_API_KEY"));
}

/** Refuses a matrix run that could use an ambient credential for another provider. */
export function assertMatrixEnvironment(): void {
  assert(liveMatrixEnabled(), "the OpenRouter live matrix requires the paid opt-in and key");
  assert(OTHER_KEYS.every((key: string) => !Deno.env.get(key)), "unset the other provider keys before the matrix");
}

/** Saves only the supplied redacted record, using a filename derived from the fixed case label. */
export async function saveMatrixEvidence(label: string, record: JSONValue): Promise<void> {
  await Deno.mkdir(EVIDENCE_DIR, { recursive: true });
  const filename: string = label.replace(/[^a-zA-Z0-9_-]/g, "_");
  await Deno.writeTextFile(`${EVIDENCE_DIR}/${filename}.json`, JSON.stringify(record, null, 2) + "\n");
}

/** Drives the production analyzer through a factory-built provider and retains no response content. */
export async function runLiveAnalysis(model: string): Promise<ILiveAnalysis> {
  assertMatrixEnvironment();
  const { db, tempDir, cleanup } = await initTestDbService();
  const calls: IWireObservation[] = [];
  const originalFetch: typeof globalThis.fetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: Opt<RequestInit, Reason.OptionalInput>) => {
    const response: Response = await originalFetch(input, init);
    if (String(input).endsWith("/chat/completions")) {
      const body: IChatRequest = JSON.parse(String(init?.body));
      const reply: IChatReply = await response.clone().json();
      calls.push({
        status: response.status,
        model: reply.model ?? null,
        provider: reply.provider ?? null,
        requestedFormat: body.response_format?.type ?? null,
        finishReason: reply.choices?.[0]?.finish_reason ?? null,
        reasoning: body.reasoning ?? null,
        usage: reply.usage ?? null,
        errorCode: reply.error?.code ?? null,
        toolCalls: reply.choices?.[0]?.message?.tool_calls?.length ?? 0,
      });
    }
    return response;
  }) as typeof globalThis.fetch;
  ProviderRegistry.clear();
  setProviderRegistryBootstrap(() => {
    ProviderRegistry.registerWithMetadata(PROVIDER_OPENROUTER, new OpenRouterProviderFactory(), {
      ...OPENROUTER_PROVIDER_METADATA,
      capabilities: [...OPENROUTER_PROVIDER_METADATA.capabilities],
      strengths: [...OPENROUTER_PROVIDER_METADATA.strengths],
      pricingTier: PricingTier.MEDIUM,
    });
  });
  try {
    const config = ConfigSchema.parse({
      system: { root: tempDir },
      ai: { provider: PROVIDER_OPENROUTER, model, timeout_ms: LIVE_TIMEOUT_MS },
    });
    const provider = await ProviderFactory.create(config, db, new EventLogger({ db }));
    const analysis: IRequestAnalysis = await new LlmAnalyzer(provider, createOutputValidator({ autoRepair: false }))
      .analyze(ANALYSIS_REQUEST, {});
    const validCore: boolean = RequestAnalysisCoreSchema.safeParse(analysis).success;
    await saveMatrixEvidence(`analysis-${model}`, {
      model,
      unsetKeys: [...OTHER_KEYS],
      mode: analysis.metadata.mode,
      goalCount: analysis.goals.length,
      actionabilityScore: analysis.actionabilityScore,
      validCore,
      calls: calls.map((call: IWireObservation) => ({ ...call })),
    });
    return { analysis, validCore, calls };
  } finally {
    globalThis.fetch = originalFetch;
    ProviderRegistry.clear();
    await cleanup();
  }
}

/** One bounded Responses probe checks acceptance of function tools and JSON Schema in the same request. */
export async function runResponsesProbe(): Promise<IResponsesProbeSummary> {
  assertMatrixEnvironment();
  const response: Response = await fetch(`${API_BASE}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    body: JSON.stringify({
      model: MATRIX_MODELS[3],
      input: "Return the JSON object with ok set to true. Do not call the tool.",
      max_output_tokens: 512,
      reasoning: { enabled: false },
      store: false,
      tools: [{
        type: "function",
        name: "emit_marker",
        description: "Emit a marker",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        strict: true,
      }],
      text: {
        format: {
          type: "json_schema",
          name: "probe",
          strict: true,
          schema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  const reply: {
    status?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    model?: string;
    usage?: JSONValue;
    error?: { code?: JSONValue };
  } = await response.json();
  const output: string =
    reply.output?.flatMap((item) => item.content ?? []).find((part) => part.type === "output_text")?.text ?? "";
  let validOutput: boolean = false;
  try {
    validOutput = JSON.parse(output).ok === true;
  } catch { /* The probe reports invalid JSON without retaining its text. */ }
  const result: IResponsesProbeSummary = {
    status: response.status,
    completed: reply.status === "completed",
    validOutput,
    outputTypes: reply.output?.map((item) => item.type ?? "absent") ?? [],
    contentTypes: reply.output?.flatMap((item) => item.content ?? []).map((part) => part.type ?? "absent") ?? [],
    outputChars: output.length,
  };
  await saveMatrixEvidence("responses-probe", {
    ...result,
    model: reply.model ?? null,
    usage: reply.usage ?? null,
    errorCode: reply.error?.code ?? null,
  });
  return result;
}
