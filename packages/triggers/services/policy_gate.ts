/**
 * @module TriggerPolicyGate
 * @path packages/triggers/services/policy_gate.ts
 * @architectural-layer Triggers
 * @dependencies ["@exaix/core/triggers"]
 * @related-files []
 * @ungrounded
 * @description Default policy gate for trigger evaluation. Enforces:
 * 1. Idempotency check — rejects duplicate idempotency keys
 * 2. Source authorization — currently allows all registered sources
 * 3. Payload schema validation — delegates to envelope schema
 * 4. Rate limiting — currently disabled (no-op)
 */

import type {
  ExecutionTriggerEnvelope,
  IIdempotencyLedger,
  ITriggerPolicyGate,
  TTriggerDecision,
} from "@exaix/core/triggers";

export class TriggerPolicyGate implements ITriggerPolicyGate {
  constructor(private readonly ledger: IIdempotencyLedger) {}

  async evaluate(trigger: ExecutionTriggerEnvelope): Promise<TTriggerDecision> {
    // 1. Idempotency check
    const duplicate = await this.ledger.isDuplicate(trigger.idempotencyKey);
    if (duplicate) {
      return {
        accepted: false,
        rejectionReason: "duplicate_idempotency_key",
      };
    }

    // 2. Source authorization — all sources allowed in default gate
    // 3. Payload schema validation — already validated at parse time
    // 4. Rate limiting — no limit in default gate

    return {
      accepted: true,
      normalizedIntent: `${trigger.source}:${trigger.action}:${trigger.subject}`,
      targetFlowId: trigger.targetFlowId,
    };
  }
}
