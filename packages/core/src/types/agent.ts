/**
 * @module Agent
 * @path packages/core/src/types/agent.ts
 * @description Module for Agent.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types/i_agent_service.ts]
 */

import type { AgentStatusType } from "@exaix/core/status/agent_status.ts";
import type { AgentHealth, LogLevel } from "@exaix/core";

/**
 * Information about an agent's current state and configuration.
 */
export interface IAgentStatusItem {
  id: string;
  name: string;
  model: string;
  status: AgentStatusType;
  lastActivity: string; // ISO timestamp
  capabilities: string[];
  defaultSkills: string[];
}

/**
 * Health statistics for an agent.
 */
export interface AgentHealthData {
  status: AgentHealth;
  issues: string[];
  uptime: number; // seconds
}

/**
 * Log entry emitted by an agent.
 */
export interface AgentLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  traceId?: string;
}
