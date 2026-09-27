/**
 * @module AiErrors
 * @path packages/ai/src/errors.ts
 * @description Specialized error classes for the AI layer, specifically for provider factory failures.
 * @architectural-layer AI
 * @related-files [packages/ai/src/providers/lazy_provider.ts, packages/ai/src/provider_api_key.ts]
 */
import { ModelProviderError } from "./providers/common.ts";
import type { Opt, Reason } from "@exaix/core/types";

export type ProviderFactoryReasonCode =
  | "credential_missing"
  | "env_permission_denied"
  | "net_permission_denied"
  | "profile_mismatch"
  | "registration_missing"
  | "capture_unsupported";

export const PROVIDER_REASON_PROFILE_MISMATCH: ProviderFactoryReasonCode = "profile_mismatch";

export class ProviderFactoryError extends Error {
  constructor(message: string, public readonly reasonCode?: Opt<ProviderFactoryReasonCode, Reason.OptionalContext>) {
    super(message);
    this.name = "ProviderFactoryError";
  }
}

export type ProviderCallPolicyReasonCode = "unsupported_call_option" | "pricing_unavailable";

/** Terminal failure of the bounded compatible conversation contract. */
export class ProviderProtocolError extends ModelProviderError {
  readonly reasonCode = "protocol_invalid";
  constructor(message: string, provider: string) {
    super(message, provider);
    this.name = "ProviderProtocolError";
    Object.setPrototypeOf(this, ProviderProtocolError.prototype);
  }
}

/** Safe terminal rejection before a compatible call can perform provider I/O. */
export class ProviderCallPolicyError extends ModelProviderError {
  constructor(public readonly reasonCode: ProviderCallPolicyReasonCode, profile: string) {
    super(`${reasonCode}: compatible call policy rejected the request`, profile);
    this.name = "ProviderCallPolicyError";
    Object.setPrototypeOf(this, ProviderCallPolicyError.prototype);
  }
}

/** Exposes only declared codes from genuine provider errors, never arbitrary properties. */
export function getProviderFailureReason(
  error: Error,
): ProviderFactoryReasonCode | ProviderCallPolicyReasonCode | ProviderProtocolError["reasonCode"] | undefined {
  if (error instanceof ProviderProtocolError) return "protocol_invalid";
  if (error instanceof ProviderCallPolicyError) {
    return error.reasonCode === "unsupported_call_option" || error.reasonCode === "pricing_unavailable"
      ? error.reasonCode
      : undefined;
  }
  if (!(error instanceof ProviderFactoryError)) return undefined;
  switch (error.reasonCode) {
    case "credential_missing":
    case "env_permission_denied":
    case "net_permission_denied":
    case "profile_mismatch":
    case "registration_missing":
    case "capture_unsupported":
      return error.reasonCode;
    default:
      return undefined;
  }
}
