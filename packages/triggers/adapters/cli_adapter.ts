/**
 * @module CliAdapter
 * @path packages/triggers/adapters/cli_adapter.ts
 * @architectural-layer Triggers
 * @dependencies ["@exaix/core/triggers"]
 * @related-files []
 * @ungrounded
 * @description Trigger adapter for CLI invocations. Converts argv-style input into
 * an ExecutionTriggerEnvelope with source "cli" and action "start_flow".
 */

import type { ExecutionTriggerEnvelope, ITriggerAdapter } from "@exaix/core/triggers";
import { normalizeIdempotencyKey } from "@exaix/core/triggers";

interface ICliInput {
  args?: string[];
  cwd?: string;
}

export class CliAdapter implements ITriggerAdapter<ICliInput> {
  readonly source = "cli" as const;

  parse(rawInput: ICliInput): Promise<ExecutionTriggerEnvelope> {
    const args = rawInput.args ?? [];
    const subject = args.join(" ") || "cli-invocation";
    return Promise.resolve({
      triggerId: crypto.randomUUID(),
      source: "cli",
      action: "start_flow",
      idempotencyKey: normalizeIdempotencyKey(`cli-${subject}-${Date.now()}`),
      subject,
      payload: { args, cwd: rawInput.cwd },
      metadata: {},
      occurredAt: new Date().toISOString(),
    });
  }
}
