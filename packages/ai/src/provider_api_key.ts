// Utility to get API key from env and optionally persist to SecureCredentialStore
/**
 * @module ProviderApiKey
 * @path src/ai/provider_api_key.ts
 * @description utility for retrieving AI provider API keys from environment variables with optional persistence to secure storage.
 * @architectural-layer AI
 * @related-files [src/ai/factories/abstract_provider_factory.ts]
 */
import { SecureCredentialStore } from "@exaix/core";

/** Extended globalThis shape used when EXA_PERSIST_ENV_CREDENTIALS is set by the host process. */
interface ExaGlobal {
  EXA_PERSIST_ENV_CREDENTIALS?: boolean;
}

export async function getApiKeyWithOptionalPersistence(envKey: string): Promise<string | null> {
  const envValue = Deno.env.get(envKey);
  if (envValue) {
    // Only persist if EXA_PERSIST_ENV_CREDENTIALS is true
    const globalWithPersistence = globalThis as { EXA_PERSIST_ENV_CREDENTIALS?: boolean };
    if (globalWithPersistence.EXA_PERSIST_ENV_CREDENTIALS) {
      // Only persist if not already present in store
      const stored = await SecureCredentialStore.get(envKey);
      if (!stored) {
        await SecureCredentialStore.set(envKey, envValue);
      }
    }
    return envValue;
  }
  // Fallback to store
  return await SecureCredentialStore.get(envKey);
}
