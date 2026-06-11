/**
 * @module WebhookAdapter
 * @path packages/triggers/adapters/webhook_adapter.ts
 * @architectural-layer Triggers
 * @dependencies ["@exaix/core/triggers", "@exaix/core/types"]
 * @related-files ["packages/triggers/adapters/adapter_registry.ts"]
 * @ungrounded
 * @description Optional trigger adapter for HTTP webhook payloads. Enforces a
 * configurable payload size limit and MANDATORY HMAC-SHA256 signature verification:
 * an adapter with no configured `secret` fails closed and rejects every payload
 * (Finding 9) rather than accepting unsigned, unauthenticated flow triggers. External
 * adapters are optional: Exaix operates fully offline when no webhook infra is active.
 */

import type { ExecutionTriggerEnvelope, ITriggerAdapter } from "@exaix/core/triggers";
import { normalizeIdempotencyKey } from "@exaix/core/triggers";
import { TRIGGER_PAYLOAD_MAX_BYTES } from "@exaix/core/types";

/** Recursive JSON value from a parsed webhook body. */
type TWebhookBodyValue =
  | string
  | number
  | boolean
  | null
  | IWebhookBodyObject
  | TWebhookBodyValue[];

/** Parsed JSON object from a webhook HTTP request body. */
interface IWebhookBodyObject {
  [key: string]: TWebhookBodyValue;
}

export interface IWebhookAdapterConfig {
  /**
   * HMAC-SHA256 secret. REQUIRED to accept payloads: the adapter verifies the
   * `x-hub-signature-256` header against it. Without a secret the adapter fails
   * closed and rejects every payload (Finding 9).
   */
  secret?: string;
  /** Override header name for the HMAC signature. Defaults to "x-hub-signature-256". */
  signatureHeader?: string;
  /** Maximum payload size in bytes. Defaults to TRIGGER_PAYLOAD_MAX_BYTES (1 MB). */
  maxPayloadBytes?: number;
}

export interface IWebhookInput {
  body: string | Uint8Array;
  headers: Record<string, string>;
  /** Human-readable event label. Falls back to "webhook" if omitted. */
  subject?: string;
}

export class WebhookAdapter implements ITriggerAdapter<IWebhookInput> {
  readonly source = "webhook" as const;

  private readonly secret: string | undefined;
  private readonly signatureHeader: string;
  private readonly maxPayloadBytes: number;

  constructor(config: IWebhookAdapterConfig) {
    this.secret = config.secret;
    this.signatureHeader = config.signatureHeader ?? "x-hub-signature-256";
    this.maxPayloadBytes = config.maxPayloadBytes ?? TRIGGER_PAYLOAD_MAX_BYTES;
  }

  async parse(rawInput: IWebhookInput): Promise<ExecutionTriggerEnvelope> {
    const bodyBytes = typeof rawInput.body === "string" ? new TextEncoder().encode(rawInput.body) : rawInput.body;

    if (bodyBytes.byteLength > this.maxPayloadBytes) {
      throw new Error(
        `Webhook payload size ${bodyBytes.byteLength} bytes exceeds limit of ${this.maxPayloadBytes} bytes`,
      );
    }

    // Fail closed (Finding 9): a webhook with no configured secret must not accept
    // unsigned payloads — that would allow unauthenticated flow triggers.
    if (this.secret === undefined || this.secret === "") {
      throw new Error(
        "Webhook secret is not configured: refusing to accept an unsigned payload. " +
          "Set a webhook secret to enable mandatory HMAC-SHA256 verification.",
      );
    }
    await this.verifyHmac(bodyBytes, rawInput.headers);

    const subject = rawInput.subject ?? "webhook";
    const bodyText = new TextDecoder().decode(bodyBytes);

    let parsedPayload: IWebhookBodyObject = {};
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedPayload = parsed as IWebhookBodyObject;
      }
    } catch {
      // Non-JSON body — store as raw string
      parsedPayload = { raw: bodyText };
    }

    return {
      triggerId: crypto.randomUUID(),
      source: "webhook",
      action: "start_flow",
      idempotencyKey: normalizeIdempotencyKey(`webhook-${subject}-${crypto.randomUUID()}`),
      subject,
      payload: parsedPayload,
      metadata: {},
      occurredAt: new Date().toISOString(),
    };
  }

  private async verifyHmac(
    body: Uint8Array,
    headers: Record<string, string>,
  ): Promise<void> {
    const headerValue = headers[this.signatureHeader] ??
      headers[this.signatureHeader.toLowerCase()];

    if (!headerValue) {
      throw new Error(
        `Missing webhook signature header "${this.signatureHeader}"`,
      );
    }

    const expected = await this.computeHmac(body);

    if (!timingSafeEqual(expected, headerValue)) {
      throw new Error("Webhook signature verification failed");
    }
  }

  private async computeHmac(body: Uint8Array): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.secret!),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, body.slice());
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `sha256=${hex}`;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}
