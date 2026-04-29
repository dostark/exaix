/**
 * @module AgentStatusModule
 * @path src/shared/status/agent_status.ts
 * @description Canonical, type-safe agent status values and utility functions for status coercion and validation.
 * @architectural-layer TUI
 * @related-files [src/tui/agent_status_view.ts]
 */

import { MessageType } from "@exaix/core";
import type { JSONValue } from "@exaix/core/types/json.ts";

export const AgentStatus = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  ERROR: MessageType.ERROR,
} as const;

export type AgentStatusType = typeof AgentStatus[keyof typeof AgentStatus];

export const AGENT_STATUS_VALUES: readonly AgentStatusType[] = [
  AgentStatus.ACTIVE,
  AgentStatus.INACTIVE,
  AgentStatus.ERROR,
];

export const AGENT_STATUS_ORDER: readonly AgentStatusType[] = [
  AgentStatus.ACTIVE,
  AgentStatus.INACTIVE,
  AgentStatus.ERROR,
];

export function isAgentStatus(value: JSONValue): value is AgentStatusType {
  return typeof value === "string" && (AGENT_STATUS_VALUES as readonly string[]).includes(value);
}

export function coerceAgentStatus(
  value: JSONValue,
  fallback: AgentStatusType = AgentStatus.INACTIVE,
): AgentStatusType {
  return isAgentStatus(value) ? value : fallback;
}
