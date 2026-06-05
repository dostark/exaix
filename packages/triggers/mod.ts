/**
 * @module TriggersPackage
 * @path packages/triggers/mod.ts
 * @architectural-layer Orchestration
 * @dependencies ["@exaix/core/triggers"]
 * @related-files []
 * @ungrounded
 * @description Barrel export for the triggers adapter package.
 */

export * from "./adapters/cli_adapter.ts";
export * from "./adapters/internal_event_adapter.ts";
