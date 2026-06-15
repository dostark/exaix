/**
 * @module VertexPackageConstants
 * @path packages/ai-vertex/src/constants.ts
 * @related-files ["packages/ai-vertex/src/auth/google_auth.ts", "packages/ai-vertex/src/auth/service_account.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/core"]
 * @description Vertex AI provider + service-account auth constants owned by @exaix-team/ai-vertex.
 */

import { type IProviderDefaults, ProviderCostTier, ProviderType } from "@exaix/core";

export const PROVIDER_VERTEX = ProviderType.VERTEX;

/** Inbound service-account OAuth/token endpoints must live under this host suffix (SSRF guard). */
export const GOOGLE_TOKEN_HOST_SUFFIX = ".googleapis.com";

/** OAuth2 scope required for Vertex AI / Cloud Platform access. */
export const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** RFC 7523 JWT bearer grant type. */
export const JWT_BEARER_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
export const JWT_ALG_RS256 = "RS256";
export const JWT_TYPE = "JWT";

/** Standard OAuth2 assertion lifetime; the actual cache TTL uses the provider's expires_in. */
export const OAUTH_TOKEN_TTL_SECONDS = 3600;
export const MS_PER_SECOND = 1000;

/** Upper bound on the token-endpoint exchange before it is aborted. */
export const TOKEN_REFRESH_TIMEOUT_MS = 10000;
/** Early-refresh margin subtracted from the reported expiry to absorb clock skew / latency. */
export const TOKEN_EXPIRY_SKEW_SECONDS = 60;

/** Chunk size for streaming base64 encoding to avoid call-stack overflow on large inputs. */
export const BASE64_CHUNK_SIZE = 0x8000;

/** Typed activity-journal event actions for provider auth. */
export const EVENT_AUTH_INVALID_SERVICE_ACCOUNT = "provider.auth.invalid_service_account";
export const EVENT_AUTH_TOKEN_REFRESHED = "provider.auth.token_refreshed";

// ============================================================================
// Vertex AI provider defaults + endpoint construction
// ============================================================================

export const DEFAULT_VERTEX_MODEL = "gemini-2.5-flash";
export const DEFAULT_VERTEX_REGION = "us-central1";
export const DEFAULT_VERTEX_TIMEOUT_MS = 30000;
export const DEFAULT_VERTEX_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_VERTEX_RETRY_BACKOFF_MS = 1000;

/** Environment variable holding the service-account JSON (single line). */
export const DEFAULT_VERTEX_SERVICE_ACCOUNT_ENV = "VERTEX_AI_SERVICE_ACCOUNT";

/** Regional Vertex AI host: `{region}` + this suffix. */
export const VERTEX_AI_HOST_SUFFIX = "-aiplatform.googleapis.com";
/** Nominal default endpoint (the real URL is built per-request from region/project/model). */
export const DEFAULT_VERTEX_ENDPOINT = "https://us-central1-aiplatform.googleapis.com/v1";

/**
 * Build the regional generateContent endpoint for a project + model.
 * e.g. https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/m:generateContent
 */
export function buildVertexEndpoint(region: string, projectId: string, model: string): string {
  return `https://${region}${VERTEX_AI_HOST_SUFFIX}/v1/projects/${projectId}/locations/${region}` +
    `/publishers/google/models/${model}:generateContent`;
}

export const PROVIDER_VERTEX_DESCRIPTION = "Google Vertex AI (service-account auth, project quotas)";
export const PROVIDER_VERTEX_CAPABILITIES = ["chat", "vision", "long-context"] as const;
export const PROVIDER_VERTEX_STRENGTHS = ["enterprise-quotas", "regional-endpoints", "gcp-billing"] as const;
export const PROVIDER_VERTEX_COST_TIER = ProviderCostTier.PAID;

export const VERTEX_PROVIDER_METADATA = {
  name: PROVIDER_VERTEX,
  description: PROVIDER_VERTEX_DESCRIPTION,
  capabilities: PROVIDER_VERTEX_CAPABILITIES,
  costTier: PROVIDER_VERTEX_COST_TIER,
  strengths: PROVIDER_VERTEX_STRENGTHS,
} as const;

export const VERTEX_DEFAULTS: IProviderDefaults = {
  defaultModel: DEFAULT_VERTEX_MODEL,
  defaultEndpoint: DEFAULT_VERTEX_ENDPOINT,
  defaultTimeoutMs: DEFAULT_VERTEX_TIMEOUT_MS,
  defaultRetryMaxAttempts: DEFAULT_VERTEX_RETRY_MAX_ATTEMPTS,
  defaultRetryBackoffMs: DEFAULT_VERTEX_RETRY_BACKOFF_MS,
};
