/**
 * @module CommonTypes
 * @path src/services/common/types.ts
 * @description Shared type definitions for services, including ILogEvent and IServiceContext.
 * @architectural-layer Services
 * @related-files ["packages/core/src/logger/event_logger.ts", "packages/core/src/logger/structured_logger.ts"]
 */
import type { Actor, ActorType, AgentKind } from "@exaix/core";

/**
 * Common service context for middleware.
 * Subinterfaces (ToolContext, RequestProcessingContext, etc.) extend this
 * with their own typed properties — no index signature needed.
 */
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
  identityId?: string;
}
