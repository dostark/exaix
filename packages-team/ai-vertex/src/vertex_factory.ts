/**
 * @module VertexProviderFactory
 * @path packages-team/ai-vertex/src/vertex_factory.ts
 * @related-files ["packages-team/ai-vertex/src/vertex_provider.ts", "packages-team/ai-vertex/src/auth/service_account.ts", "packages-team/ai-vertex/src/constants.ts"]
 * @ungrounded
 * @architectural-layer AI
 * @dependencies ["@exaix/ai", "@exaix/ai/providers", "@exaix-team/ai-vertex/src/auth/service_account.ts"]
 * @description Factory for creating VertexProvider instances. Resolves the service account
 * from its environment variable and fails with an actionable error when it is missing/invalid.
 */

import { AbstractProviderFactory } from "@exaix/ai/factories/abstract_provider_factory.ts";
import { AuthenticationError } from "@exaix/ai/providers";
import type { IModelProvider, IResolvedProviderOptions } from "@exaix/ai/types.ts";
import { parseServiceAccountFromEnv } from "./auth/service_account.ts";
import { VertexProvider } from "./vertex_provider.ts";
import { DEFAULT_VERTEX_REGION, DEFAULT_VERTEX_SERVICE_ACCOUNT_ENV, PROVIDER_VERTEX } from "./constants.ts";

/**
 * Creates VertexProvider instances from a Google service-account credential.
 *
 * Honours the `[ai_vertex]` config block (`service_account_env`, `region`),
 * falling back to package defaults when the block or a field is absent.
 */
export class VertexProviderFactory extends AbstractProviderFactory {
  create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const vertexConfig = options.config?.ai_vertex;
    const serviceAccountEnv = vertexConfig?.service_account_env ?? DEFAULT_VERTEX_SERVICE_ACCOUNT_ENV;
    const region = vertexConfig?.region ?? DEFAULT_VERTEX_REGION;

    const serviceAccount = parseServiceAccountFromEnv(serviceAccountEnv, options.logger);
    if (!serviceAccount) {
      return Promise.reject(
        new AuthenticationError(
          PROVIDER_VERTEX,
          `Vertex AI requires a valid service account JSON in the ${serviceAccountEnv} environment variable`,
        ),
      );
    }

    return Promise.resolve(
      new VertexProvider({
        apiKey: "",
        model: options.model,
        id: this.generateId(PROVIDER_VERTEX, options.model, options.id),
        logger: options.logger,
        timeoutMs: options.timeoutMs,
        serviceAccount,
        region,
      }),
    );
  }
}
