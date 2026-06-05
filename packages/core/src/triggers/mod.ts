/**
 * @module TriggerCore
 * @path packages/core/src/triggers/mod.ts
 * @architectural-layer Core
 * @dependencies ["./schemas.ts", "./interfaces.ts", "./idempotency.ts"]
 * @related-files ["packages/core/src/events/domain_event_types.ts"]
 * @description Barrel export for the trigger adapter core types.
 */

export * from "./schemas.ts";
export * from "./interfaces.ts";
export * from "./idempotency.ts";
