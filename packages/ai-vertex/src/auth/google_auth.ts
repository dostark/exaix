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
} from "../constants.ts";

/** Minimal OAuth2 token-endpoint response. */
interface IAccessTokenResponse {
  access_token: string;
  expires_in: number;
}

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
}

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

  constructor(private readonly opts: IGoogleAuthOptions) {}

  async getAccessToken(): Promise<string> {
    const now = (this.opts.nowFn ?? Date.now)();
    if (this.accessToken && now < this.expiryMs) {
      return this.accessToken;
    }
    await this.refresh(now);
    return this.accessToken as string;
  }

  private async refresh(now: number): Promise<void> {
    const assertion = await this.signJwt(now);
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const response = await fetchImpl(this.opts.serviceAccount.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT_TYPE, assertion }).toString(),
    });

    if (!response.ok) {
      // Sanitized: never surface the raw response body (may contain tokens/PII).
      throw new AuthenticationError(PROVIDER_VERTEX, `token refresh failed (status ${response.status})`);
    }

    const data = await response.json() as IAccessTokenResponse;
    this.accessToken = data.access_token;
    this.expiryMs = now + data.expires_in * MS_PER_SECOND;
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
