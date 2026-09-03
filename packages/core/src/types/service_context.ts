/**
 * @module ServiceContext
 * @path packages/core/src/types/service_context.ts
 * @description Shared service context contract for middleware and request-scoped execution metadata.
 * @architectural-layer Shared
 * @related-files ["packages/core/src/types/service_context.ts", "packages/core/src/types/mod.ts"]
 */

import type { Actor, ActorType, AgentKind } from "@exaix/core";

/** Subinterfaces extend this with their own typed properties. */
export interface IServiceContext {
  traceId?: string;
  /** Who initiated the enclosing request */
  actor?: Actor;
  /** Category of actor */
  actorType?: ActorType | null;
  /** Runtime agent handling this service call — NOT an identity id */
  agentId?: string;
  /** Category of runtime agent */
  agentKind?: AgentKind | null;
  /** LLM identity blueprint being executed */
  agentRole?: string;
}
