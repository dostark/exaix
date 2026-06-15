/**
 * @module VertexServiceAccount
 * @path packages-team/ai-vertex/src/auth/service_account.ts
 * @related-files ["packages-team/ai-vertex/src/auth/google_auth.ts", "packages-team/ai-vertex/src/constants.ts"]
 * @ungrounded
 * @architectural-layer AI
 * @dependencies ["zod", "@exaix/core", "@exaix/core/logger"]
 * @description Google service-account key schema (with token-endpoint allowlist), safe
 * env parsing that never logs credential material, and typed auth-event payload helpers.
 */

import { z } from "zod";
import type { LogMetadata } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import { EVENT_AUTH_INVALID_SERVICE_ACCOUNT, GOOGLE_TOKEN_HOST_SUFFIX, PROVIDER_VERTEX } from "../constants.ts";

/** True when the URL's host is under the allowlisted googleapis.com suffix. */
function isGoogleHost(url: string): boolean {
  try {
    return new URL(url).host.endsWith(GOOGLE_TOKEN_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Google Cloud service-account key. `auth_uri`/`token_uri` are constrained to
 * `*.googleapis.com` so a tampered key cannot redirect a signed JWT assertion to
 * an attacker-controlled host (SSRF / assertion exfiltration).
 */
export const ServiceAccountKeySchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1),
  private_key_id: z.string().min(1),
  private_key: z.string().min(1),
  client_email: z.string().email(),
  client_id: z.string().min(1),
  auth_uri: z.string().url().refine(isGoogleHost, { message: "auth_uri must be a *.googleapis.com host" }),
  token_uri: z.string().url().refine(isGoogleHost, { message: "token_uri must be a *.googleapis.com host" }),
  auth_provider_x509_cert_url: z.string().url(),
  client_x509_cert_url: z.string().url(),
});

export type ServiceAccountKey = z.infer<typeof ServiceAccountKeySchema>;

/** Typed, secret-free payload for provider auth events. */
export interface IProviderAuthEventPayload {
  provider: string;
  region?: string;
  refreshed: boolean;
}

/** Build a JSON-object log payload from the typed auth-event fields (never includes key material). */
export function authEventPayload(fields: IProviderAuthEventPayload): LogMetadata {
  return { provider: fields.provider, region: fields.region ?? null, refreshed: fields.refreshed };
}

/**
 * Parse and validate a service account from an environment variable.
 * On any failure returns `null` and emits a redacted event — the raw value and
 * parse error are NEVER logged, since they may contain `private_key` material.
 */
export function parseServiceAccountFromEnv(envVar: string, logger?: IEventLogger): ServiceAccountKey | null {
  const raw = Deno.env.get(envVar);
  if (!raw) {
    return null;
  }

  try {
    // safeParse handles structural validation; JSON.parse handles malformed input.
    // Either failure path emits a redacted event — never the raw value or error.
    const result = ServiceAccountKeySchema.safeParse(JSON.parse(raw));
    if (result.success) {
      return result.data;
    }
  } catch {
    // Fall through to the redacted failure event below.
  }

  void logger?.warn(
    EVENT_AUTH_INVALID_SERVICE_ACCOUNT,
    null,
    authEventPayload({ provider: PROVIDER_VERTEX, refreshed: false }),
  );
  return null;
}
