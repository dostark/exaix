/**
 * @module IagentService
 * @path src/shared/interfaces/i_agent_service.ts
 * @description Module for IagentService.
 * @architectural-layer Shared
 * * @related-files [src/shared/types/agent.ts]
 */

import type { AgentHealthData, AgentLogEntry, IAgentStatusItem } from "../types/agent.ts";

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
  getAgentLogs(identityId: string, limit?: number): Promise<AgentLogEntry[]>;

  /**
   * Get real-time health statistics for an agent.
   */
  getAgentHealth(identityId: string): Promise<AgentHealthData>;
}
