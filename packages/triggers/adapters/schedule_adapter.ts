/**
 * @module ScheduleAdapter
 * @path packages/triggers/adapters/schedule_adapter.ts
 * @architectural-layer Triggers
 * @dependencies ["@exaix/core/triggers"]
 * @related-files ["packages/triggers/adapters/adapter_registry.ts"]
 * @ungrounded
 * @description Optional trigger adapter for scheduled (cron-driven) signals. Validates
 * cron expressions against a strict 5-part subset — rejects @-style shortcuts (@reboot,
 * @daily), 6-part second-precision variants, and anything containing shell metacharacters.
 * Schedule expressions are stored in config, not provided by untrusted callers at runtime.
 */

import type { ExecutionTriggerEnvelope, ITriggerAdapter } from "@exaix/core/triggers";
import { normalizeIdempotencyKey } from "@exaix/core/triggers";

export interface IScheduleInput {
  cronExpression: string;
  /** Human-readable label for the scheduled job. Defaults to the cron expression. */
  subject?: string;
  /** Optional idempotency key override. Defaults to cron + ISO timestamp. */
  runId?: string;
}

// Matches exactly 5 whitespace-separated fields where each field is a valid
// cron token: *, number, range (n-m), list (a,b), or step (*/n, n-m/n).
// Phase 135 Step 5 (GAP-5): exported so the registry refresh scheduler reuses this
// canonical validator instead of duplicating the regex. Behaviour is unchanged.
export const CRON_FIELD_PATTERN =
  /^(\*|[0-9]+(-[0-9]+)?(\/[0-9]+)?|(\*\/[0-9]+))(,(\*|[0-9]+(-[0-9]+)?(\/[0-9]+)?|(\*\/[0-9]+)))*$/;

export function validateCronExpression(expr: string): void {
  if (!expr || expr.trim().length === 0) {
    throw new Error("Invalid cron expression: expression is empty");
  }

  if (expr.startsWith("@")) {
    throw new Error(
      `Invalid cron expression "${expr}": @-style shortcuts are not supported`,
    );
  }

  // Reject shell metacharacters to prevent injection
  if (/[;&|`$\\<>(){}[\]!#%^~]/.test(expr)) {
    throw new Error(
      `Invalid cron expression "${expr}": contains forbidden characters`,
    );
  }

  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expr}": must have exactly 5 fields (got ${parts.length})`,
    );
  }

  for (const part of parts) {
    if (!CRON_FIELD_PATTERN.test(part)) {
      throw new Error(
        `Invalid cron expression "${expr}": field "${part}" is not a valid cron token`,
      );
    }
  }
}

export class ScheduleAdapter implements ITriggerAdapter<IScheduleInput> {
  readonly source = "schedule" as const;

  parse(rawInput: IScheduleInput): Promise<ExecutionTriggerEnvelope> {
    try {
      validateCronExpression(rawInput.cronExpression);
    } catch (err) {
      return Promise.reject(err);
    }

    const subject = rawInput.subject ?? rawInput.cronExpression;
    const now = new Date().toISOString();
    const idempotencyKey = normalizeIdempotencyKey(
      rawInput.runId ?? `schedule-${rawInput.cronExpression}-${now}`,
    );

    return Promise.resolve({
      triggerId: crypto.randomUUID(),
      source: "schedule",
      action: "start_flow",
      idempotencyKey,
      subject,
      payload: { cronExpression: rawInput.cronExpression },
      metadata: {},
      occurredAt: now,
    });
  }
}
