/**
 * @module AgentStatusTreeBuilder
 * @path src/tui/agent_status/tree_builder.ts
 * @description Tree builder utilities for Agent Status View, supporting flat and grouped (by status or model) tree constructions.
 * @architectural-layer TUI
 * * @related-files [src/tui/agent_status_view.ts]
 */

import { createGroupNode, createNode, type ITreeNode } from "../helpers/tree_view.ts";
import type { IAgentStatusItem } from "../../shared/types/agent.ts";
import { AGENT_STATUS_ORDER, AgentStatus, type AgentStatusType } from "../../shared/status/agent_status.ts";
import {
  TUI_AGENT_STATUS_ICONS,
  TUI_ICON_AGENT,
  TUI_ICON_BRAIN,
  TUI_NODE_TYPE_AGENT,
  TUI_NODE_TYPE_MODEL_GROUP,
  TUI_NODE_TYPE_STATUS_GROUP,
} from "../helpers/constants.ts";

const AGENT_STATUS_ICONS: Record<string, string> = {
  [AgentStatus.ACTIVE]: TUI_AGENT_STATUS_ICONS.active,
  [AgentStatus.INACTIVE]: TUI_AGENT_STATUS_ICONS.inactive,
  [AgentStatus.ERROR]: TUI_AGENT_STATUS_ICONS.error,
};

/**
 * Build flat agent tree (no grouping)
 */
export function buildFlatTree(agents: IAgentStatusItem[]): ITreeNode[] {
  return agents.map((agent) => {
    const icon = AGENT_STATUS_ICONS[agent.status] || "⚪";
    const label = `${icon} ${agent.name} (${agent.model})`;
    return createNode(agent.id, label, TUI_NODE_TYPE_AGENT, { expanded: true });
  });
}

/**
 * Build agent tree grouped by status
 */
export function buildTreeByStatus(agents: IAgentStatusItem[]): ITreeNode[] {
  const byStatus = new Map<string, IAgentStatusItem[]>();
  for (const agent of agents) {
    if (!byStatus.has(agent.status)) {
      byStatus.set(agent.status, []);
    }
    byStatus.get(agent.status)!.push(agent);
  }

  // Order: active, inactive, error
  return AGENT_STATUS_ORDER
    .filter((status: AgentStatusType) => byStatus.has(status))
    .map((status: AgentStatusType) => {
      const statusAgents = byStatus.get(status)!;
      const icon = AGENT_STATUS_ICONS[status] || "⚪";
      const children = statusAgents.map((agent) => {
        const label = `${TUI_ICON_AGENT} ${agent.name} (${agent.model})`;
        return createNode(agent.id, label, TUI_NODE_TYPE_AGENT, { expanded: true });
      });
      return createGroupNode(
        `status-${status}`,
        `${icon} ${status.charAt(0).toUpperCase() + status.slice(1)} (${statusAgents.length})`,
        TUI_NODE_TYPE_STATUS_GROUP,
        children,
      );
    });
}

/**
 * Build agent tree grouped by model
 */
export function buildTreeByModel(agents: IAgentStatusItem[]): ITreeNode[] {
  const byModel = new Map<string, IAgentStatusItem[]>();
  for (const agent of agents) {
    if (!byModel.has(agent.model)) {
      byModel.set(agent.model, []);
    }
    byModel.get(agent.model)!.push(agent);
  }

  return Array.from(byModel.entries()).map(([model, modelAgents]) => {
    const children = modelAgents.map((agent) => {
      const icon = AGENT_STATUS_ICONS[agent.status] || "⚪";
      const label = `${icon} ${agent.name}`;
      return createNode(agent.id, label, TUI_NODE_TYPE_AGENT, { expanded: true });
    });
    return createGroupNode(
      `model-${model}`,
      `${TUI_ICON_BRAIN} ${model} (${modelAgents.length})`,
      TUI_NODE_TYPE_MODEL_GROUP,
      children,
    );
  });
}
