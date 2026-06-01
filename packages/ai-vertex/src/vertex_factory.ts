/**
 * @module VertexProviderFactory
 * @path packages/ai-vertex/src/vertex_factory.ts
 * @related-files ["packages/ai-vertex/src/vertex_provider.ts", "packages/ai-vertex/src/auth/service_account.ts", "packages/ai-vertex/src/constants.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/ai", "@exaix/ai/providers", "@exaix/ai-vertex/src/auth/service_account.ts"]
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
 * Note (Phase 80 Step 3): the service-account env var and region use package
 * defaults here. Config-driven overrides are wired in Step 5.
 */
export class VertexProviderFactory extends AbstractProviderFactory {
  create(options: IResolvedProviderOptions): Promise<IModelProvider> {
    const serviceAccount = parseServiceAccountFromEnv(DEFAULT_VERTEX_SERVICE_ACCOUNT_ENV, options.logger);
    if (!serviceAccount) {
      return Promise.reject(
        new AuthenticationError(
          PROVIDER_VERTEX,
          `Vertex AI requires a valid service account JSON in the ${DEFAULT_VERTEX_SERVICE_ACCOUNT_ENV} environment variable`,
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
        region: DEFAULT_VERTEX_REGION,
      }),
    );
  }
}
