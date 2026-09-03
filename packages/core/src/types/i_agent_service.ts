/**
 * @module IagentService
 * @path packages/core/src/types/i_agent_service.ts
 * @description Module for IagentService.
 * @architectural-layer Shared
 * @related-files [@exaix/core/types]
 */

import type { IAgentHealthData, IAgentLogEntry, IAgentStatusItem } from "@exaix/core/types";

export interface IAgentService {
  /**
   * List all registered agents with their current status.
   */
  listAgents(): Promise<IAgentStatusItem[]>;

  /** Get logs for a specific agent. */
  getAgentLogs(agentRole: string, limit?: number): Promise<IAgentLogEntry[]>;

  /**
   * Get real-time health statistics for an agent.
   */
  getAgentHealth(agentRole: string): Promise<IAgentHealthData>;
}
