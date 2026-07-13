/**
 * @module VertexProvider
 * @path packages-team/ai-vertex/src/vertex_provider.ts
 * @related-files ["packages-team/ai-vertex/src/vertex_factory.ts", "packages-team/ai-vertex/src/auth/google_auth.ts", "packages-team/ai-vertex/src/constants.ts"]
 * @ungrounded
 * @architectural-layer AI
 * @dependencies ["@exaix/ai/providers", "@exaix/ai/provider_common_utils.ts", "@exaix-team/ai-vertex/src/auth/google_auth.ts"]
 * @description Vertex AI provider: authenticates via a service-account bearer token and calls
 * the regional generateContent endpoint, parsing the Gemini response into IGenerateResult.
 */

import {
  extractGoogleContent,
  type GoogleResponse,
  performProviderCall,
  tokenMapperGoogle,
} from "@exaix/ai/provider_common_utils.ts";
import { BaseProvider, type IBaseProviderOptions, type IGenerateResult } from "@exaix/ai/providers";
import type { IModelOptions } from "@exaix/ai/types.ts";
import { GoogleAuth, type IGoogleAuth } from "./auth/google_auth.ts";
import type { ServiceAccountKey } from "./auth/service_account.ts";
import {
  buildVertexEndpoint,
  DEFAULT_VERTEX_ENDPOINT,
  DEFAULT_VERTEX_MODEL,
  DEFAULT_VERTEX_RETRY_BACKOFF_MS,
  DEFAULT_VERTEX_RETRY_MAX_ATTEMPTS,
  DEFAULT_VERTEX_TIMEOUT_MS,
  PROVIDER_VERTEX,
} from "./constants.ts";

/** Options for VertexProvider. `auth` is injectable for network-free testing. */
export type VertexProviderOptions = IBaseProviderOptions & {
  serviceAccount: ServiceAccountKey;
  region: string;
  auth?: IGoogleAuth;
};

/**
 * VertexProvider implements IModelProvider for Gemini models on Vertex AI.
 */
export class VertexProvider extends BaseProvider {
  private readonly auth: IGoogleAuth;
  private readonly region: string;
  private readonly projectId: string;

  constructor(options: VertexProviderOptions) {
    super({
      ...options,
      defaultModel: DEFAULT_VERTEX_MODEL,
      defaultEndpoint: options.baseUrl || DEFAULT_VERTEX_ENDPOINT,
      defaultTimeout: options.timeoutMs || DEFAULT_VERTEX_TIMEOUT_MS,
      defaultRetryDelay: options.retryDelayMs || DEFAULT_VERTEX_RETRY_BACKOFF_MS,
      defaultMaxRetries: options.maxRetries || DEFAULT_VERTEX_RETRY_MAX_ATTEMPTS,
    }, PROVIDER_VERTEX);
    this.region = options.region;
    this.projectId = options.serviceAccount.project_id;
    this.auth = options.auth ?? new GoogleAuth({ serviceAccount: options.serviceAccount, logger: options.logger });
  }

  protected override async attemptGenerate(prompt: string, options?: IModelOptions): Promise<IGenerateResult> {
    const accessToken = await this.auth.getAccessToken();
    const endpoint = buildVertexEndpoint(this.region, this.projectId, this.model);

    return await performProviderCall<GoogleResponse>(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: options?.max_tokens,
          temperature: options?.temperature,
          topP: options?.top_p,
          stopSequences: options?.stop,
        },
      }),
    }, {
      id: this.id,
      maxAttempts: this.maxRetries,
      backoffBaseMs: this.retryDelayMs,
      timeoutMs: this.timeoutMs,
      logger: this.logger,
      tokenMapper: tokenMapperGoogle(this.model),
      extractor: extractGoogleContent,
    });
  }
}
