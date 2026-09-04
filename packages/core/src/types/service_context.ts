/**
 * @module ServiceContext
 * @path packages/core/src/types/service_context.ts
 * @description Shared service context contract for middleware and request-scoped execution metadata.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/types/service_context.ts", "packages/core/src/types/mod.ts"]
 */

import type { Actor, ActorType, RunnerKind } from "@exaix/core";

/** Subinterfaces extend this with their own typed properties. */
export interface IServiceContext {
  traceId?: string;
  /** Who initiated the enclosing request */
  actor?: Actor;
  /** Category of actor */
  actorType?: ActorType | null;
  /** Runner handling this service call — NOT an agent role id */
  runnerId?: string;
  /** Category of Runner */
  runnerKind?: RunnerKind | null;
  /** LLM agent role blueprint being executed */
  agentRole?: string;
}
