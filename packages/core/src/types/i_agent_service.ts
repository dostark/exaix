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

  /**
   * Get logs for a specific agent.
   * @param identityId The ID of the agent to fetch logs for.
   * @param limit Maximum number of log entries to return.
   */
  getAgentLogs(identityId: string, limit?: number): Promise<IAgentLogEntry[]>;

  /**
   * Get real-time health statistics for an agent.
   */
  getAgentHealth(identityId: string): Promise<IAgentHealthData>;
}
