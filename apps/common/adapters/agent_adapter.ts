/**
 * @module AgentAdapter
 * @path apps/common/adapters/agent_adapter.ts
 * @description Module for AgentAdapter.
 * @architectural-layer Services
 * @ungrounded
 * @related-files ["packages/execution/src/agent_runner.ts", @exaix/core/types]
 */

import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { ActivityActor, AgentHealth, DEFAULT_AGENT_MODEL } from "@exaix/core";
import { AgentStatus } from "@exaix/core/status";
import type { AgentHealthData, AgentLogEntry, IAgentStatusItem } from "@exaix/core/types";
import type { IAgentService } from "@exaix/core/types";
export class AgentServiceAdapter extends BaseCommand implements IAgentService {
  private identitiesDir: string;

  constructor(context: ICommandContext) {
    super(context);
    this.identitiesDir = join(
      this.config.system.root!,
      this.config.paths.workspace!,
      this.config.paths.identities!,
    );
  }

  /**
   * List agents by scanning the Agents directory in the workspace.
   */
  async listAgents(): Promise<IAgentStatusItem[]> {
    const agents: IAgentStatusItem[] = [];

    try {
      if (!await exists(this.identitiesDir)) {
        // Return a default system agent if directory doesn't exist
        return [{
          id: ActivityActor.SYSTEM,
          name: "System Agent",
          status: AgentStatus.ACTIVE,
          model: this.config.ai?.model || DEFAULT_AGENT_MODEL,
          lastActivity: new Date().toISOString(),
          capabilities: ["core", "filesystem"],
          defaultSkills: [],
        }];
      }

      for await (const entry of Deno.readDir(this.identitiesDir)) {
        if (entry.isDirectory || (entry.isFile && entry.name.endsWith(".json"))) {
          const id = entry.name.replace(".json", "");
          agents.push({
            id: id,
            name: id.charAt(0).toUpperCase() + id.slice(1),
            status: AgentStatus.ACTIVE,
            model: DEFAULT_AGENT_MODEL,
            lastActivity: new Date().toISOString(),
            capabilities: [],
            defaultSkills: [],
          });
        }
      }
    } catch (error) {
      console.error("Failed to list agents:", error);
    }

    return agents;
  }

  /**
   * Get health data for a specific agent.
   */
  getAgentHealth(_identityId: string): Promise<AgentHealthData> {
    return Promise.resolve({
      status: AgentHealth.HEALTHY,
      issues: [],
      uptime: 0,
    });
  }

  /**
   * Get logs for a specific agent.
   */
  getAgentLogs(_identityId: string, _limit: number = 50): Promise<AgentLogEntry[]> {
    // Agent-specific log files are not yet standardized in core.
    return Promise.resolve([]);
  }
}
