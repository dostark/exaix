/**
 * @module Actor
 * @path packages/core/src/types/actor.ts
 * @related-files []
 * @description Actor category and identity string types used across the core package.
 * @architectural-layer Shared
 */

/**
/**
 * Actor category values used for actor separation in logs and service context.
 */
export enum ActorType {
  USER = "user",
  SERVICE = "service",
  MCP_CLIENT = "mcp-client",
  IDENTITY = "identity",
  SYSTEM = "system",
  AGENT = "agent",
}

/** Either an exact ActorType, or a scoped `ActorType:id` string. */
export type Actor = `${ActorType}` | `${ActorType}:${string}`;
