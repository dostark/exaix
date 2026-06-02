/**
 * @module VertexGoogleAuth
 * @path packages/ai-vertex/src/auth/google_auth.ts
 * @related-files ["packages/ai-vertex/src/auth/service_account.ts", "packages/ai-vertex/src/auth/encoding.ts", "packages/ai-vertex/src/constants.ts"]
 * @architectural-layer AI
 * @dependencies ["@exaix/ai/providers", "@exaix/core", "@exaix/core/logger"]
 * @description OAuth2 service-account authentication for Vertex AI: signs an RS256 JWT
 * assertion via Web Crypto, exchanges it for an access token, caches by expiry, and
 * surfaces only sanitized errors (never the upstream response body).
 */

import { z } from "zod";
import { AuthenticationError } from "@exaix/ai/providers";
import type { IEventLogger } from "@exaix/core/logger";
import { authEventPayload, type ServiceAccountKey } from "./service_account.ts";
import { base64UrlEncode } from "./encoding.ts";
import {
  EVENT_AUTH_TOKEN_REFRESHED,
  GOOGLE_OAUTH_SCOPE,
  JWT_ALG_RS256,
  JWT_BEARER_GRANT_TYPE,
  JWT_TYPE,
  MS_PER_SECOND,
  OAUTH_TOKEN_TTL_SECONDS,
  PROVIDER_VERTEX,
  TOKEN_EXPIRY_SKEW_SECONDS,
  TOKEN_REFRESH_TIMEOUT_MS,
} from "../constants.ts";

export interface IGoogleAuth {
  /** Returns a cached access token, refreshing via the JWT-bearer flow when expired. */
  getAccessToken(): Promise<string>;
}

export interface IGoogleAuthOptions {
  serviceAccount: ServiceAccountKey;
  logger?: IEventLogger;
  /** Injectable fetch (defaults to global fetch) — enables network-free testing. */
  fetchImpl?: typeof fetch;
  /** Injectable clock in ms (defaults to Date.now) — enables deterministic expiry tests. */
  nowFn?: () => number;
  /** Token-exchange timeout in ms (defaults to TOKEN_REFRESH_TIMEOUT_MS). */
  tokenTimeoutMs?: number;
}

/** OAuth2 token-endpoint response — validated so a malformed 200 never poisons the cache. */
const AccessTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

/** Strip PEM envelope/whitespace and import a pkcs8 RSA key for RS256 signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * GoogleAuth performs service-account (JWT-bearer) authentication for Vertex AI.
 */
export class GoogleAuth implements IGoogleAuth {
  private accessToken: string | null = null;
  private expiryMs = 0;
  /** In-flight refresh shared across concurrent callers (single token fetch). */
  private refreshing: Promise<void> | null = null;

  constructor(private readonly opts: IGoogleAuthOptions) {}

  async getAccessToken(): Promise<string> {
    const now = (this.opts.nowFn ?? Date.now)();
    if (this.accessToken && now < this.expiryMs) {
      return this.accessToken;
    }
    // Dedup concurrent refreshes: the first caller starts it, the rest await it.
    this.refreshing ??= this.refresh(now).finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
    return this.accessToken as string;
  }

  private async refresh(now: number): Promise<void> {
    const assertion = await this.signJwt(now);
    const fetchImpl = this.opts.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await fetchImpl(this.opts.serviceAccount.token_uri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT_TYPE, assertion }).toString(),
        signal: AbortSignal.timeout(this.opts.tokenTimeoutMs ?? TOKEN_REFRESH_TIMEOUT_MS),
      });
    } catch {
      // Timeout/network error — sanitized, never surface upstream detail.
      throw new AuthenticationError(PROVIDER_VERTEX, "token refresh request failed or timed out");
    }

    if (!response.ok) {
      // Sanitized: never surface the raw response body (may contain tokens/PII).
      throw new AuthenticationError(PROVIDER_VERTEX, `token refresh failed (status ${response.status})`);
    }

    const parsed = AccessTokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new AuthenticationError(PROVIDER_VERTEX, "token refresh returned an invalid response");
    }

    this.accessToken = parsed.data.access_token;
    // Apply an early-refresh skew margin (never negative).
    const ttlSeconds = Math.max(parsed.data.expires_in - TOKEN_EXPIRY_SKEW_SECONDS, 0);
    this.expiryMs = now + ttlSeconds * MS_PER_SECOND;
    void this.opts.logger?.info(
      EVENT_AUTH_TOKEN_REFRESHED,
      null,
      authEventPayload({ provider: PROVIDER_VERTEX, refreshed: true }),
    );
  }

  private async signJwt(now: number): Promise<string> {
    const sa = this.opts.serviceAccount;
    const iat = Math.floor(now / MS_PER_SECOND);
    const exp = iat + OAUTH_TOKEN_TTL_SECONDS;
    const header = base64UrlEncode(JSON.stringify({ alg: JWT_ALG_RS256, typ: JWT_TYPE }));
    const claim = base64UrlEncode(
      JSON.stringify({ iss: sa.client_email, scope: GOOGLE_OAUTH_SCOPE, aud: sa.token_uri, exp, iat }),
    );
    const unsigned = `${header}.${claim}`;
    const key = await importPrivateKey(sa.private_key);
    const signature = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      new TextEncoder().encode(unsigned),
    );
    return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
  }
}
