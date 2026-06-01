/**
 * @module VertexPackageConstants
 * @path packages/ai-vertex/src/constants.ts
 * @related-files ["packages/ai-vertex/src/auth/google_auth.ts", "packages/ai-vertex/src/auth/service_account.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/core"]
 * @description Vertex AI provider + service-account auth constants owned by @exaix/ai-vertex.
 */

import { ProviderType } from "@exaix/core";

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

/** Chunk size for streaming base64 encoding to avoid call-stack overflow on large inputs. */
export const BASE64_CHUNK_SIZE = 0x8000;

/** Typed activity-journal event actions for provider auth. */
export const EVENT_AUTH_INVALID_SERVICE_ACCOUNT = "provider.auth.invalid_service_account";
export const EVENT_AUTH_TOKEN_REFRESHED = "provider.auth.token_refreshed";
