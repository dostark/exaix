/**
 * @module Agent
 * @path src/shared/types/agent.ts
 * @description Module for Agent.
 * @architectural-layer Shared
 * * @related-files [src/shared/interfaces/i_agent_service.ts]
 */

import type { AgentStatusType } from "../status/agent_status.ts";
import type { AgentHealth, LogLevel } from "../enums.ts";

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
