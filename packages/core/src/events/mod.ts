/**
 * @module EventsIndex
 * @path packages/core/src/events/mod.ts
 * @architectural-layer Core
 * @dependencies ["packages/core/src/events/domain_event_types.ts", "packages/core/src/events/event_registry.ts"]
 * @related-files ["packages/core/src/events/domain_event_types.ts", "packages/core/src/events/event_registry.ts"]
 * @description Barrel export for event taxonomy and registry modules.
 */

export * from "./domain_event_types.ts";
export * from "./event_registry.ts";
