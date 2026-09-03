/**
 * @module ILogEvent
 * @path packages/core/src/types/i_log_event.ts
 * @related-files []
 * @description Shared structured log event contract used by EventLogger and related services.
 * @architectural-layer Shared
 */

import type { Actor, ActorType } from "./actor.ts";
import type { LogLevel, RuntimeKind } from "./enums.ts";
import type { JSONValue } from "./json.ts";

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
  agentKind?: RuntimeKind | null;

  /** LLM identity blueprint used for this event, e.g. "senior-coder" */
  agentRole?: string;

  /** Log level for console output */
  level?: LogLevel;

  /** Custom emoji/icon for console output */
  icon?: string;

  /** Count of tokens in prompt */
  promptTokens?: number;

  /** Count of tokens in completion */
  completionTokens?: number;

  /** Estimated cost in USD */
  costUsd?: number;
}
