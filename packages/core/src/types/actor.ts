/**
 * @module Actor
 * @path packages/core/src/types/actor.ts
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

/**
 * Valid actor identities in the system.
 *
 * These values are either exact ActorType categories or scoped actor strings
 * built from ActorType values.
 */
export type Actor = `${ActorType}` | `${ActorType}:${string}`;
