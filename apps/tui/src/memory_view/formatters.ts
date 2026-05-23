/**
 * @module MemoryFormatters
 * @path apps/tui/src/memory_view/formatters.ts
 * @description Specialized formatters for the TUI Memory View, converting memory models and tree nodes into human-readable markdown and TUI lines.
 * @architectural-layer TUI
 * @related-files ["apps/tui/src/memory_panels/index.ts"]
 */

import type {
  IExecutionMemory,
  IGlobalMemory,
  ILearning,
  IMemoryUpdateProposal,
  IProjectMemory,
} from "@exaix/schemas/memory_bank.ts";
import { MemoryTuiScope } from "./memory_scope.ts";
import {
  TUI_DETAIL_MAX_OVERVIEW_CHARS,
  TUI_MSG_PRESS_QUIT,
  TUI_PREFIX_EXECUTION,
  TUI_PREFIX_PROJECT,
} from "@exaix/tui/helpers/constants.ts";
import { renderCategoryBadge, renderConfidence, renderMarkdown } from "@exaix/tui/helpers/markdown_renderer.ts";
import { ConfidenceAssessmentLevel, ConfidenceLevel } from "@exaix/core";
import { DEFAULT_NONE_VALUE } from "@exaix/core";
import type { IMemoryService, ITreeNode } from "./types.ts";

function mapAssessmentConfidenceToConfidenceLevel(
  confidence: ConfidenceAssessmentLevel,
): ConfidenceLevel {
  switch (confidence) {
    case ConfidenceAssessmentLevel.HIGH:
    case ConfidenceAssessmentLevel.VERY_HIGH:
      return ConfidenceLevel.HIGH;
    case ConfidenceAssessmentLevel.MEDIUM:
      return ConfidenceLevel.MEDIUM;
    case ConfidenceAssessmentLevel.LOW:
    case ConfidenceAssessmentLevel.VERY_LOW:
    default:
      return ConfidenceLevel.LOW;
  }
}

export class MemoryFormatter {
  /**
   * Format scope detail for display
   */
  static formatScopeDetail(node: ITreeNode): string {
    if (node.id === MemoryTuiScope.GLOBAL) {
      const memory = node.data as IGlobalMemory | null;
      if (!memory) return "Global memory not initialized.\n\nRun: exactl memory global show";
      return [
        "# Global Memory",
        "",
        `Learnings: ${memory.learnings?.length ?? 0}`,
        `Patterns: ${memory.patterns?.length ?? 0}`,
        `Anti-patterns: ${memory.anti_patterns?.length ?? 0}`,
        "",
        "## Recent Learnings",
        ...(memory.learnings?.slice(0, 5).map((l: ILearning) => `- ${l.title} [${l.category}]`) ?? []),
      ].join("\n");
    }
    if (node.id === MemoryTuiScope.PROJECTS) {
      return [
        "# Projects",
        "",
        `${node.badge ?? 0} project memories`,
        "",
        "Select a project to view details.",
      ].join("\n");
    }
    if (node.id === MemoryTuiScope.EXECUTIONS) {
      return [
        "# Executions",
        "",
        `${node.badge ?? 0} total executions`,
        "",
        "Select an execution to view details.",
      ].join("\n");
    }
    if (node.id === MemoryTuiScope.PENDING) {
      return [
        "# Pending Proposals",
        "",
        `${node.badge ?? 0} proposals awaiting review`,
        "",
        "Press [a] to approve, [r] to reject.",
      ].join("\n");
    }
    return `Scope: ${node.label}`;
  }

  /**
   * Format project detail for display
   */
  static async formatProjectDetail(node: ITreeNode, service: IMemoryService): Promise<string> {
    const portal = node.id.replace(TUI_PREFIX_PROJECT, "");
    const memory = node.data as IProjectMemory | null;
    if (!memory) {
      const fresh = await service.getProjectMemory(portal);
      if (!fresh) return `Project '${portal}' has no memory bank.`;
      return this.formatProjectMemory(portal, fresh);
    }
    return this.formatProjectMemory(portal, memory);
  }

  /**
   * Format execution detail for display
   */
  static async formatExecutionDetail(node: ITreeNode, service: IMemoryService): Promise<string> {
    const traceId = node.id.replace(TUI_PREFIX_EXECUTION, "");
    const memory = node.data as IExecutionMemory | null;
    if (!memory) {
      const fresh = await service.getExecutionByTraceId(traceId);
      if (!fresh) return `Execution '${traceId}' not found.`;
      return this.formatExecutionMemory(fresh);
    }
    return this.formatExecutionMemory(memory);
  }

  /**
   * Format learning detail for display
   */
  static formatLearningDetail(node: ITreeNode, useColors: boolean): string {
    const proposal = node.data as IMemoryUpdateProposal | null;
    if (!proposal) return `Learning: ${node.label}`;

    const learning = proposal.learning;

    // Build content with color badges
    const categoryBadge = renderCategoryBadge(learning?.category || "observation", useColors);
    const confidenceBadge = renderConfidence(
      learning?.confidence ? mapAssessmentConfidenceToConfidenceLevel(learning.confidence) : ConfidenceLevel.MEDIUM,
      useColors,
    );

    const content = [
      `# ${learning?.title || "Proposed Learning"}`,
      "",
      `**Category:** ${categoryBadge}`,
      `**Confidence:** ${confidenceBadge}`,
      `**Scope:** ${proposal.target_scope}`,
      proposal.target_project ? `**Project:** ${proposal.target_project}` : "",
      `**Tags:** ${learning?.tags?.join(", ") ?? DEFAULT_NONE_VALUE}`,
      "",
      "## Description",
      learning?.description || "",
      "",
      "## Reason for Proposal",
      proposal.reason,
      "",
      `[a] Approve  [r] Reject`,
    ].filter((l) => l !== "").join("\n");

    return renderMarkdown(content, { useColors });
  }

  /**
   * Format project memory for display
   */
  static formatProjectMemory(portal: string, memory: IProjectMemory): string {
    const lines = [
      `# Project: ${portal}`,
      "",
    ];

    if (memory.overview) {
      lines.push("## Overview");
      lines.push(
        memory.overview.slice(0, TUI_DETAIL_MAX_OVERVIEW_CHARS) +
          (memory.overview.length > TUI_DETAIL_MAX_OVERVIEW_CHARS ? "..." : ""),
      );
      lines.push("");
    }

    if (memory.patterns && memory.patterns.length > 0) {
      lines.push("## Patterns");
      for (const p of memory.patterns.slice(0, 5)) {
        lines.push(`- ${p.name} [${p.tags?.join(", ") ?? ""}]`);
      }
      lines.push("");
    }

    if (memory.decisions && memory.decisions.length > 0) {
      lines.push("## Decisions");
      for (const d of memory.decisions.slice(0, 5)) {
        lines.push(`- ${d.decision}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Format execution memory for display
   */
  static formatExecutionMemory(memory: IExecutionMemory): string {
    const lines = [
      `# Execution: ${memory.trace_id.slice(0, 8)}...`,
      "",
      `**Status:** ${memory.status}`,
      `**Identity:** ${memory.identity_id}`,
      `**Portal:** ${memory.portal}`,
      `**Started:** ${memory.started_at}`,
      memory.completed_at ? `**Completed:** ${memory.completed_at}` : "",
      "",
    ];

    if (memory.summary) {
      lines.push("## Summary");
      lines.push(memory.summary.slice(0, TUI_DETAIL_MAX_OVERVIEW_CHARS));
      lines.push("");
    }

    if (memory.changes) {
      const totalChanges = (memory.changes.files_created?.length ?? 0) +
        (memory.changes.files_modified?.length ?? 0) +
        (memory.changes.files_deleted?.length ?? 0);
      if (totalChanges > 0) {
        lines.push("## Changes");
        if (memory.changes.files_created?.length) {
          lines.push(`  Created: ${memory.changes.files_created.length} files`);
        }
        if (memory.changes.files_modified?.length) {
          lines.push(`  Modified: ${memory.changes.files_modified.length} files`);
        }
        if (memory.changes.files_deleted?.length) {
          lines.push(`  Deleted: ${memory.changes.files_deleted.length} files`);
        }
        lines.push("");
      }
    }

    if (memory.lessons_learned && memory.lessons_learned.length > 0) {
      lines.push("## Lessons Learned");
      for (const lesson of memory.lessons_learned) {
        lines.push(`- ${lesson}`);
      }
    }

    return lines.filter((l) => l !== "").join("\n");
  }

  /**
   * Format complete detail content with quit message
   */
  static formatDetailWithQuit(content: string): string {
    return `${content}\n\n${TUI_MSG_PRESS_QUIT}`;
  }
}
