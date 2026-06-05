/**
 * @module AdapterRegistry
 * @path packages/triggers/adapters/adapter_registry.ts
 * @architectural-layer Triggers
 * @dependencies ["@exaix/core/triggers"]
 * @related-files [
 *   "packages/triggers/adapters/webhook_adapter.ts",
 *   "packages/triggers/adapters/schedule_adapter.ts",
 *   "packages/triggers/adapters/filesystem_adapter.ts"
 * ]
 * @ungrounded
 * @description Pluggable adapter registry for the trigger boundary. External adapters
 * (webhook, schedule, filesystem, mcp) are registered at startup and are optional —
 * the registry only holds adapters that were explicitly registered. Unregistered sources
 * produce UnsupportedTriggerSourceError. Configuration is off by default; no external
 * adapter is active unless the operator registers it.
 */

import type { ExecutionTriggerEnvelope, ITriggerAdapter, TTriggerSource } from "@exaix/core/triggers";

/**
 * Structural input type for registry-level dispatch. Each adapter narrows and validates
 * its own specific shape inside parse() — this type is intentionally broad to accept all
 * registered adapter input shapes without coupling the registry to concrete types.
 */
interface IAdapterDispatchInput {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | Uint8Array
    | IAdapterDispatchInput
    | (string | number | boolean | null | Uint8Array | IAdapterDispatchInput)[];
}

export class UnsupportedTriggerSourceError extends Error {
  constructor(source: string) {
    super(`No adapter registered for trigger source: "${source}"`);
    this.name = "UnsupportedTriggerSourceError";
  }
}

export class AdapterRegistry {
  private readonly adapters = new Map<TTriggerSource, ITriggerAdapter<unknown>>();

  register<T>(adapter: ITriggerAdapter<T>): void {
    this.adapters.set(adapter.source, adapter as ITriggerAdapter<unknown>);
  }

  resolve(source: TTriggerSource): ITriggerAdapter<unknown> | undefined {
    return this.adapters.get(source);
  }

  parseRaw(source: TTriggerSource, rawInput: IAdapterDispatchInput): Promise<ExecutionTriggerEnvelope> {
    const adapter = this.adapters.get(source);
    if (!adapter) {
      return Promise.reject(new UnsupportedTriggerSourceError(source));
    }
    return adapter.parse(rawInput);
  }
}
