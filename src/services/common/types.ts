/**
 * @module CommonTypes
 * @path src/services/common/types.ts
 * @description Shared type definitions for services, including ILogEvent and IServiceContext.
 * @architectural-layer Services
 * * @related-files [src/services/event_logger.ts, src/services/structured_logger.ts]
 */
import { ActorType, AgentKind, LogLevel } from "../../shared/enums.ts";
import { JSONValue } from "../../shared/types/json.ts";

/**
 * Actor types:
 * - "system" - Daemon, watcher, internal services
 * - "agent:<id>" - AI agent (e.g., "agent:senior-coder")
 * - "<user>" - Human user identity from git config or OS
 */
export type Actor = string;

/**
 * Structured log event
 */
export interface ILogEvent {
  /** Action type in domain.action format (e.g., "daemon.started") */
  action: string;

  /** Target entity (file path, service name, etc.) */
  target: string;

  /** Additional context as key-value pairs */
  payload?: Record<string, JSONValue>;

  /** Who triggered this event — maps to journal actor field */
  actor?: Actor;

  /** Category of actor */
  actorType?: ActorType | null;

  /** Trace ID for correlation */
  traceId?: string;

  /** Runtime agent handling this event, e.g. "identity-runner" — NOT an identity id */
  agentId?: string;

  /** Category of runtime agent */
  agentKind?: AgentKind | null;

  /** LLM identity blueprint used for this event, e.g. "senior-coder" */
  identityId?: string;

  /** Log level for console output */
  level?: LogLevel;

  /** Custom emoji/icon for console output */
  icon?: string;
}

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
