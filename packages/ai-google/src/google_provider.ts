/**
 * @module GooglePackageProvider
 * @path packages/ai-google/src/google_provider.ts
 * @description Google Gemini provider implementation owned by the @exaix/ai-google package.
 * @architectural-layer AI
 * @related-files [packages/ai-google/src/google_factory.ts, packages/ai-google/src/google_provider.ts]
 */

import {
  DEFAULT_GOOGLE_ENDPOINT,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_GOOGLE_RETRY_BACKOFF_MS,
  DEFAULT_GOOGLE_RETRY_MAX_ATTEMPTS,
  DEFAULT_GOOGLE_TIMEOUT_MS,
  PROVIDER_GOOGLE,
} from "./constants.ts";
import {
  extractGoogleContent,
  extractGoogleToolCalls,
  type GoogleResponse,
  performProviderCall,
  tokenMapperGoogle,
} from "@exaix/ai/provider_common_utils.ts";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult } from "@exaix/ai/providers";
import {
  type IModelOptions,
  type IToolChoice,
  type IToolDefinition,
  TOOL_CHOICE_TYPE_NONE,
  TOOL_CHOICE_TYPE_TOOL,
} from "@exaix/ai/types.ts";
import type { JSONValue } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * Options for GoogleProvider.
 */
export type GoogleProviderOptions = IBaseProviderOptions;

/** One Gemini `contents[]` entry, covering the three shapes this module constructs
 *  (priorTurn's model functionCall + user functionResponse, plus the plain user prompt). */
type GoogleContent =
  | { role: "model"; parts: [{ functionCall: { name: string; args: Record<string, JSONValue> } }] }
  | { role: "user"; parts: [{ functionResponse: { name: string; response: { content: JSONValue } } }] }
  | { role: "user"; parts: [{ text: string }] };

/** Map IToolDefinition to Gemini's wire-format function declaration. */
function mapToolDefinitionGoogle(
  tool: IToolDefinition,
): { name: string; description?: string; parameters: Record<string, JSONValue> } {
  return {
    name: tool.name,
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    parameters: tool.inputSchema,
  };
}

/** Gemini's wire-format `toolConfig.functionCallingConfig`. */
type GoogleToolConfig = { functionCallingConfig: { mode: "AUTO" | "ANY" | "NONE"; allowedFunctionNames?: string[] } };

const GOOGLE_FUNCTION_CALLING_MODE_AUTO = "AUTO";
const GOOGLE_FUNCTION_CALLING_MODE_ANY = "ANY";
const GOOGLE_FUNCTION_CALLING_MODE_NONE = "NONE";

/** Map IToolChoice to Gemini's wire-format toolConfig per the Phase 153 mapping table.
 *  `disable_parallel_tool_use` has no documented Gemini API equivalent; the field is
 *  accepted on IToolChoice but has no effect for Google in this phase (Pre-Gap Analysis
 *  GAP-1). */
function mapToolChoiceGoogle(choice: IToolChoice): GoogleToolConfig {
  switch (choice.type) {
    case "auto":
      return { functionCallingConfig: { mode: GOOGLE_FUNCTION_CALLING_MODE_AUTO } };
    case "any":
      return { functionCallingConfig: { mode: GOOGLE_FUNCTION_CALLING_MODE_ANY } };
    case TOOL_CHOICE_TYPE_TOOL:
      return {
        functionCallingConfig: { mode: GOOGLE_FUNCTION_CALLING_MODE_ANY, allowedFunctionNames: [choice.name] },
      };
    case TOOL_CHOICE_TYPE_NONE:
      return { functionCallingConfig: { mode: GOOGLE_FUNCTION_CALLING_MODE_NONE } };
  }
}

/**
 * GoogleProvider implements IModelProvider for Gemini models.
 */
export class GoogleProvider extends BaseProvider {
  constructor(options: GoogleProviderOptions) {
    super({
      ...options,
      defaultModel: DEFAULT_GOOGLE_MODEL,
      defaultEndpoint: options.config?.ai_endpoints?.google || DEFAULT_GOOGLE_ENDPOINT,
      defaultTimeout: options.config?.ai_timeout?.providers?.google || DEFAULT_GOOGLE_TIMEOUT_MS,
      defaultRetryDelay: options.config?.ai_retry?.providers?.["google"]?.backoff_base_ms ||
        DEFAULT_GOOGLE_RETRY_BACKOFF_MS,
      defaultMaxRetries: options.config?.ai_retry?.providers?.["google"]?.max_attempts ||
        DEFAULT_GOOGLE_RETRY_MAX_ATTEMPTS,
    }, PROVIDER_GOOGLE);
  }

  protected override async attemptGenerate(
    prompt: string,
    options?: Opt<IModelOptions, Reason.OptionalInput>,
  ): Promise<IGenerateResult> {
    const endpoint = `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;

    const contents: GoogleContent[] = [];
    if (options?.priorTurn) {
      const priorTurn = options.priorTurn;
      contents.push({
        role: "model",
        parts: [{ functionCall: { name: priorTurn.toolName, args: priorTurn.toolInput } }],
      });
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: priorTurn.toolName,
            response: { content: priorTurn.toolResultContent as JSONValue },
          },
        }],
      });
    }
    contents.push({ role: "user", parts: [{ text: prompt }] });

    return await performProviderCall<GoogleResponse>(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: options?.max_tokens,
          temperature: options?.temperature,
          topP: options?.top_p,
          stopSequences: options?.stop,
        },
        tools: options?.tools ? [{ functionDeclarations: options.tools.map(mapToolDefinitionGoogle) }] : undefined,
        toolConfig: options?.toolChoice ? mapToolChoiceGoogle(options.toolChoice) : undefined,
      }),
    }, {
      id: this.id,
      maxAttempts: this.maxRetries,
      backoffBaseMs: this.retryDelayMs,
      timeoutMs: this.timeoutMs,
      logger: this.logger,
      tokenMapper: tokenMapperGoogle(this.model),
      extractor: extractGoogleContent,
      toolCallExtractor: extractGoogleToolCalls,
    });
  }
}
