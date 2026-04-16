/**
 * @module MemoryFormatter
 * @path src/cli/formatters/memory_formatter.ts
 * @description Handles formatting of Memory Bank data for CLI output, supporting tables and markdown for projects, executions, learnings, and skills.
 * @architectural-layer CLI
 * * @related-files [src/cli/memory_commands.ts]
 */

import { MEMORY_COMMAND_DEFAULTS } from "../cli.config.ts";
import type { IMemoryBankSummary } from "../memory_types.ts";
import { MemoryScope } from "../../shared/enums.ts";
import type {
  IExecutionMemory,
  IGlobalMemory,
  IGlobalMemoryStats,
  ILearning,
  IMemorySearchResult,
  IMemoryUpdateProposal,
  IProjectMemory,
  ISkill,
  ISkillMatch,
} from "../../shared/schemas/memory_bank.ts";
import {
  CLI_LAYOUT_BOX_INDENT_WIDTH,
  CLI_LAYOUT_BOX_LABEL_WIDTH,
  CLI_LAYOUT_BOX_WIDTH_STANDARD,
  CLI_LAYOUT_BOX_WIDTH_WIDE,
  CLI_LAYOUT_PADDING_STANDARD,
  CLI_LAYOUT_SKILL_ID_WIDTH,
  CLI_LAYOUT_SKILL_NAME_WIDTH,
  CLI_LAYOUT_SKILL_SOURCE_WIDTH,
  CLI_LAYOUT_SKILL_STATUS_WIDTH,
  CLI_LAYOUT_SKILL_VERSION_WIDTH,
  CLI_PREVIEW_LENGTH_LONG,
  CLI_PREVIEW_LENGTH_SHORT,
  CLI_SEPARATOR_LENGTH,
  CLI_SEPARATOR_LONG,
  CLI_SEPARATOR_MEDIUM,
  CLI_SEPARATOR_NARROW,
  CLI_SEPARATOR_SHORT,
  CLI_SEPARATOR_WIDE,
  CLI_TRUNCATE_ID_LONG,
  CLI_TRUNCATE_ID_SHORT,
  CLI_TRUNCATE_TITLE_MEDIUM,
  CLI_TRUNCATE_TITLE_SHORT,
  DEFAULT_NONE_VALUE,
} from "../../shared/constants.ts";

const CLI_BOX_SEPARATOR = "├─────────────────────────────────────────────────────────────┤";

/**
 * Handles formatting of Memory Bank data for CLI output.
 */
export class MemoryFormatter {
  // ===== Memory List Formatting =====

  formatListTable(summary: IMemoryBankSummary): string {
    const lines: string[] = [
      "Memory Banks Summary",
      "═".repeat(CLI_SEPARATOR_LENGTH),
      "",
      `Projects:    ${summary.projects.length}`,
      `Executions:  ${summary.executions}`,
      `Last Active: ${summary.lastActivity || "Never"}`,
      "",
    ];

    if (summary.projects.length > 0) {
      lines.push("Projects:");
      lines.push("─".repeat(CLI_SEPARATOR_SHORT));
      for (const project of summary.projects) {
        lines.push(`  • ${project}`);
      }
    }

    return lines.join("\n");
  }

  formatListMarkdown(summary: IMemoryBankSummary): string {
    const lines: string[] = [
      "# Memory Banks Summary",
      "",
      "| Metric | Value |",
      "|--------|-------|",
      `| Projects | ${summary.projects.length} |`,
      `| Executions | ${summary.executions} |`,
      `| Last Active | ${summary.lastActivity || "Never"} |`,
      "",
    ];

    if (summary.projects.length > 0) {
      lines.push("## Projects");
      lines.push("");
      for (const project of summary.projects) {
        lines.push(`- ${project}`);
      }
    }

    return lines.join("\n");
  }

  // ===== Memory Search Formatting =====

  formatSearchTable(query: string, results: IMemorySearchResult[]): string {
    if (results.length === 0) {
      return `No results found for "${query}"`;
    }

    const lines: string[] = [
      `Search Results for "${query}"`,
      "═".repeat(CLI_SEPARATOR_MEDIUM),
      "",
      `Found ${results.length} result(s)`,
      "",
      "Type       │ Portal          │ Title",
      "───────────┼─────────────────┼" + "─".repeat(CLI_SEPARATOR_SHORT),
    ];

    for (const result of results) {
      const type = result.type.padEnd(MEMORY_COMMAND_DEFAULTS.PROJECT_PADDING);
      const portal = (result.portal || "-").padEnd(MEMORY_COMMAND_DEFAULTS.PORTAL_PADDING);
      const title = result.title.substring(0, MEMORY_COMMAND_DEFAULTS.TITLE_LENGTH);
      lines.push(`${type} │ ${portal} │ ${title}`);
    }

    return lines.join("\n");
  }

  formatSearchMarkdown(
    query: string,
    results: IMemorySearchResult[],
  ): string {
    if (results.length === 0) {
      return `# Search Results\n\nNo results found for "${query}"`;
    }

    const lines: string[] = [
      `# Search Results for "${query}"`,
      "",
      `Found ${results.length} result(s)`,
      "",
      "| Type | Portal | Title | Score |",
      "|------|--------|-------|-------|",
    ];

    for (const result of results) {
      const score = (result.relevance_score || 0).toFixed(2);
      lines.push(
        `| ${result.type} | ${result.portal || "-"} | ${result.title} | ${score} |`,
      );
    }

    return lines.join("\n");
  }

  // ===== Project Formatting =====

  formatProjectListTable(
    projects: { name: string; patterns: number; decisions: number }[],
  ): string {
    if (projects.length === 0) {
      return "No project memories found.";
    }

    const lines: string[] = [
      "Project Memories",
      "═".repeat(CLI_SEPARATOR_LENGTH),
      "",
      "Name                 │ Patterns │ Decisions",
      "─────────────────────┼──────────┼──────────",
    ];

    for (const project of projects) {
      const name = project.name.padEnd(MEMORY_COMMAND_DEFAULTS.PROJECT_NAME_PADDING);
      const patterns = String(project.patterns).padStart(MEMORY_COMMAND_DEFAULTS.PATTERNS_PADDING);
      const decisions = String(project.decisions).padStart(MEMORY_COMMAND_DEFAULTS.DECISIONS_PADDING);
      lines.push(`${name} │${patterns} │${decisions}`);
    }

    lines.push("");
    lines.push(`Total: ${projects.length} project(s)`);

    return lines.join("\n");
  }

  formatProjectListMarkdown(
    projects: { name: string; patterns: number; decisions: number }[],
  ): string {
    if (projects.length === 0) {
      return "# Project Memories\n\nNo project memories found.";
    }

    const lines: string[] = [
      "# Project Memories",
      "",
      "| Project | Patterns | Decisions |",
      "|---------|----------|-----------|",
    ];

    for (const project of projects) {
      lines.push(
        `| ${project.name} | ${project.patterns} | ${project.decisions} |`,
      );
    }

    lines.push("");
    lines.push(`**Total:** ${projects.length} project(s)`);

    return lines.join("\n");
  }

  formatProjectShowTable(project: IProjectMemory): string {
    const lines: string[] = [
      `Project Memory: ${project.portal}`,
      "═".repeat(CLI_SEPARATOR_MEDIUM),
      "",
      "Overview:",
      "─".repeat(40),
      project.overview.substring(0, CLI_PREVIEW_LENGTH_LONG),
      "",
    ];

    if (project.patterns.length > 0) {
      lines.push(`Patterns (${project.patterns.length}):`);
      lines.push("─".repeat(40));
      for (const pattern of project.patterns) {
        lines.push(`  • ${pattern.name}`);
        lines.push(`    ${pattern.description.substring(0, 60)}...`);
      }
      lines.push("");
    }

    if (project.decisions.length > 0) {
      lines.push(`Decisions (${project.decisions.length}):`);
      lines.push("─".repeat(40));
      for (const decision of project.decisions) {
        lines.push(`  • [${decision.date}] ${decision.decision.substring(0, CLI_PREVIEW_LENGTH_SHORT)}...`);
      }
      lines.push("");
    }

    if (project.references.length > 0) {
      lines.push(`References (${project.references.length}):`);
      lines.push("─".repeat(40));
      for (const ref of project.references) {
        lines.push(`  • [${ref.type}] ${ref.path}`);
      }
    }

    return lines.join("\n");
  }

  formatProjectShowMarkdown(project: IProjectMemory): string {
    const lines: string[] = [
      `# Project Memory: ${project.portal}`,
      "",
      "## Overview",
      "",
      project.overview,
      "",
    ];

    if (project.patterns.length > 0) {
      lines.push(`## Patterns (${project.patterns.length})`);
      lines.push("");
      for (const pattern of project.patterns) {
        lines.push(`### ${pattern.name}`);
        lines.push("");
        lines.push(pattern.description);
        if (pattern.tags && pattern.tags.length > 0) {
          lines.push("");
          lines.push(`**Tags:** ${pattern.tags.join(", ")}`);
        }
        lines.push("");
      }
    }

    if (project.decisions.length > 0) {
      lines.push(`## Decisions (${project.decisions.length})`);
      lines.push("");
      for (const decision of project.decisions) {
        lines.push(`### ${decision.date}`);
        lines.push("");
        lines.push(`**Decision:** ${decision.decision}`);
        lines.push("");
        lines.push(`**Rationale:** ${decision.rationale}`);
        if (decision.tags && decision.tags.length > 0) {
          lines.push("");
          lines.push(`**Tags:** ${decision.tags.join(", ")}`);
        }
        lines.push("");
      }
    }

    if (project.references.length > 0) {
      lines.push(`## References (${project.references.length})`);
      lines.push("");
      for (const ref of project.references) {
        lines.push(`- **[${ref.type}]** ${ref.path}: ${ref.description}`);
      }
    }

    return lines.join("\n");
  }

  // ===== Execution Formatting =====

  formatExecutionListTable(executions: IExecutionMemory[]): string {
    if (executions.length === 0) {
      return "No execution history found.";
    }

    const lines: string[] = [
      "Execution History",
      "═".repeat(CLI_SEPARATOR_WIDE),
      "",
      "Trace ID   │ Status    │ Portal          │ Started",
      "───────────┼───────────┼─────────────────┼" + "─".repeat(CLI_LAYOUT_PADDING_STANDARD),
    ];

    for (const exec of executions) {
      const traceId = exec.trace_id.substring(0, MEMORY_COMMAND_DEFAULTS.TRACE_ID_LENGTH) + "..";
      const status = exec.status.padEnd(MEMORY_COMMAND_DEFAULTS.STATUS_PADDING);
      const portal = exec.portal.padEnd(MEMORY_COMMAND_DEFAULTS.PORTAL_PADDING);
      const started = exec.started_at.substring(0, MEMORY_COMMAND_DEFAULTS.TIMESTAMP_LENGTH);
      lines.push(`${traceId} │ ${status} │ ${portal} │ ${started}`);
    }

    lines.push("");
    lines.push(`Showing ${executions.length} execution(s)`);

    return lines.join("\n");
  }

  formatExecutionListMarkdown(executions: IExecutionMemory[]): string {
    if (executions.length === 0) {
      return "# Execution History\n\nNo execution history found.";
    }

    const lines: string[] = [
      "# Execution History",
      "",
      "| Trace ID | Status | Portal | Agent | Started |",
      "|----------|--------|--------|-------|---------|",
    ];

    for (const exec of executions) {
      const traceId = exec.trace_id.substring(0, CLI_TRUNCATE_ID_SHORT);
      lines.push(
        `| ${traceId}... | ${exec.status} | ${exec.portal} | ${exec.identity_id} | ${exec.started_at} |`,
      );
    }

    lines.push("");
    lines.push(`**Showing:** ${executions.length} execution(s)`);

    return lines.join("\n");
  }

  formatExecutionShowTable(exec: IExecutionMemory): string {
    const lines: string[] = [
      `Execution Details: ${exec.trace_id}`,
      "═".repeat(CLI_SEPARATOR_LONG),
      "",
      `Trace ID:    ${exec.trace_id}`,
      `Request ID:  ${exec.request_id}`,
      `Status:      ${exec.status}`,
      `Portal:      ${exec.portal}`,
      `Identity:     ${exec.identity_id}`,
      `Started:     ${exec.started_at}`,
      `Completed:   ${exec.completed_at || "In progress"}`,
      "",
      "Summary:",
      "─".repeat(CLI_SEPARATOR_NARROW),
      exec.summary,
      "",
    ];

    if (exec.context_files && exec.context_files.length > 0) {
      lines.push(`Context Files (${exec.context_files.length}):`);
      lines.push("─".repeat(CLI_SEPARATOR_NARROW));
      for (const file of exec.context_files) {
        lines.push(`  • ${file}`);
      }
      lines.push("");
    }

    this.appendChangesSummary(lines, exec);
    this.appendLessonsAndError(lines, exec);

    return lines.join("\n");
  }

  formatExecutionShowMarkdown(exec: IExecutionMemory): string {
    const lines: string[] = [
      `# Execution: ${exec.trace_id}`,
      "",
      "## Details",
      "",
      "| Field | Value |",
      "|-------|-------|",
      `| Trace ID | \`${exec.trace_id}\` |`,
      `| Request ID | \`${exec.request_id}\` |`,
      `| Status | ${exec.status} |`,
      `| Portal | ${exec.portal} |`,
      `| Identity | ${exec.identity_id} |`,
      `| Started | ${exec.started_at} |`,
      `| Completed | ${exec.completed_at || "In progress"} |`,
      "",
      "## Summary",
      "",
      exec.summary,
      "",
    ];

    if (exec.context_files && exec.context_files.length > 0) {
      lines.push("## Context Files");
      lines.push("");
      for (const file of exec.context_files) {
        lines.push(`- \`${file}\``);
      }
      lines.push("");
    }

    // Reuse helper to append change sections in markdown format
    this.appendChangesMarkdown(lines, exec);

    if (exec.lessons_learned && exec.lessons_learned.length > 0) {
      lines.push("## Lessons Learned");
      lines.push("");
      for (const lesson of exec.lessons_learned) {
        lines.push(`- ${lesson}`);
      }
      lines.push("");
    }

    if (exec.error_message) {
      lines.push("## Error");
      lines.push("");
      lines.push("```");
      lines.push(exec.error_message);
      lines.push("```");
    }

    return lines.join("\n");
  }

  // ===== Global Memory Formatting =====

  formatGlobalShowTable(globalMem: IGlobalMemory): string {
    const lines: string[] = [
      "Global Memory",
      "═".repeat(CLI_SEPARATOR_MEDIUM),
      "",
      `Version:    ${globalMem.version}`,
      `Updated:    ${globalMem.updated_at}`,
      `Learnings:  ${globalMem.learnings.length}`,
      `Patterns:   ${globalMem.patterns.length}`,
      `Anti-Patterns: ${globalMem.anti_patterns.length}`,
      "",
    ];

    if (globalMem.learnings.length > 0) {
      lines.push("Recent Learnings (top 5):");
      lines.push("─".repeat(CLI_SEPARATOR_LENGTH));
      for (const learning of globalMem.learnings.slice(0, 5)) {
        lines.push(`  • [${learning.category}] ${learning.title}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  formatGlobalShowMarkdown(globalMem: IGlobalMemory): string {
    const lines: string[] = [
      "# Global Memory",
      "",
      "| Property | Value |",
      "|----------|-------|",
      `| Version | ${globalMem.version} |`,
      `| Updated | ${globalMem.updated_at} |`,
      `| Learnings | ${globalMem.learnings.length} |`,
      `| Patterns | ${globalMem.patterns.length} |`,
      `| Anti-Patterns | ${globalMem.anti_patterns.length} |`,
      "",
      "## Statistics",
      "",
      `- **Total Learnings:** ${globalMem.statistics.total_learnings}`,
      `- **Last IActivity:** ${globalMem.statistics.last_activity}`,
      "",
    ];

    if (Object.keys(globalMem.statistics.by_category).length > 0) {
      lines.push("### By Category");
      lines.push("");
      for (const [cat, count] of Object.entries(globalMem.statistics.by_category)) {
        lines.push(`- ${cat}: ${count}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  formatGlobalLearningsTable(learnings: ILearning[]): string {
    const lines: string[] = [
      "Global Learnings",
      "═".repeat(CLI_SEPARATOR_WIDE),
      "",
      "ID         │ Category      │ Confidence │ Title",
      "───────────┼───────────────┼────────────┼" + "─".repeat(CLI_SEPARATOR_NARROW),
    ];

    for (const l of learnings) {
      const id = l.id.substring(0, CLI_TRUNCATE_ID_SHORT) + "..";
      const category = l.category.padEnd(13);
      const confidence = l.confidence.padEnd(10);
      const title = l.title.substring(0, CLI_TRUNCATE_TITLE_MEDIUM);
      lines.push(`${id} │ ${category} │ ${confidence} │ ${title}`);
    }

    lines.push("");
    lines.push(`Total: ${learnings.length} learning(s)`);

    return lines.join("\n");
  }

  formatGlobalLearningsMarkdown(learnings: ILearning[]): string {
    const lines: string[] = [
      "# Global Learnings",
      "",
      "| ID | Category | Title | Confidence | Source |",
      "|----|----------|-------|------------|--------|",
    ];

    for (const l of learnings) {
      lines.push(
        `| ${
          l.id.substring(0, CLI_TRUNCATE_ID_SHORT)
        }... | ${l.category} | ${l.title} | ${l.confidence} | ${l.source} |`,
      );
    }

    lines.push("");
    lines.push(`**Total:** ${learnings.length} learning(s)`);

    return lines.join("\n");
  }

  formatGlobalStatsTable(stats: IGlobalMemoryStats): string {
    const lines: string[] = [
      "Global Memory Statistics",
      "═".repeat(CLI_SEPARATOR_LENGTH),
      "",
      `Total Learnings: ${stats.total_learnings}`,
      `Last IActivity:   ${stats.last_activity}`,
      "",
    ];

    if (Object.keys(stats.by_category).length > 0) {
      lines.push("By Category:");
      lines.push("─".repeat(CLI_SEPARATOR_SHORT));
      for (const [cat, count] of Object.entries(stats.by_category)) {
        lines.push(`  ${cat.padEnd(CLI_LAYOUT_PADDING_STANDARD)} ${count}`);
      }
      lines.push("");
    }

    if (Object.keys(stats.by_project).length > 0) {
      lines.push("By Project:");
      lines.push("─".repeat(CLI_SEPARATOR_SHORT));
      for (const [project, count] of Object.entries(stats.by_project)) {
        lines.push(`  ${project.padEnd(CLI_LAYOUT_PADDING_STANDARD)} ${count}`);
      }
    }

    return lines.join("\n");
  }

  formatGlobalStatsMarkdown(stats: IGlobalMemoryStats): string {
    const lines: string[] = [
      "# Global Memory Statistics",
      "",
      "| Metric | Value |",
      "|--------|-------|",
      `| Total Learnings | ${stats.total_learnings} |`,
      `| Last IActivity | ${stats.last_activity} |`,
      "",
    ];

    if (Object.keys(stats.by_category).length > 0) {
      lines.push("## By Category");
      lines.push("");
      for (const [cat, count] of Object.entries(stats.by_category)) {
        lines.push(`- **${cat}:** ${count}`);
      }
      lines.push("");
    }

    if (Object.keys(stats.by_project).length > 0) {
      lines.push("## By Project");
      lines.push("");
      for (const [project, count] of Object.entries(stats.by_project)) {
        lines.push(`- **${project}:** ${count}`);
      }
    }

    return lines.join("\n");
  }

  // ===== Pending Proposals Formatting =====

  formatPendingListTable(proposals: IMemoryUpdateProposal[]): string {
    const lines: string[] = [
      "Pending Memory Update Proposals",
      "═".repeat(CLI_SEPARATOR_WIDE),
      "",
      "ID".padEnd(38) + "Title".padEnd(30) + "Category".padEnd(15) + "Scope",
      "─".repeat(CLI_SEPARATOR_WIDE),
    ];

    for (const proposal of proposals) {
      const id = proposal.id.substring(0, CLI_TRUNCATE_ID_LONG);
      const title = proposal.learning.title.substring(0, CLI_TRUNCATE_TITLE_SHORT).padEnd(30);
      const category = proposal.learning.category.padEnd(15);
      const scope = proposal.target_project || MemoryScope.GLOBAL;
      lines.push(`${id}  ${title}${category}${scope}`);
    }

    lines.push("");
    lines.push(`Total: ${proposals.length} pending proposal(s)`);

    return lines.join("\n");
  }

  formatPendingDryRunTable(proposals: IMemoryUpdateProposal[]): string {
    const lines: string[] = [
      "Pending Auto-Approval Preview",
      "═".repeat(CLI_SEPARATOR_WIDE),
      "",
      "ID".padEnd(38) + "Title".padEnd(30) + "Confidence".padEnd(12) + "Age".padEnd(8) + "Eligible",
      "─".repeat(CLI_SEPARATOR_WIDE),
    ];

    for (const proposal of proposals) {
      const id = proposal.id.substring(0, CLI_TRUNCATE_ID_LONG);
      const title = proposal.learning.title.substring(0, CLI_TRUNCATE_TITLE_SHORT).padEnd(30);
      const confidence = proposal.learning.confidence.padEnd(12);
      const extractedAt = proposal.learning.extracted_at ? new Date(proposal.learning.extracted_at) : null;
      const age = extractedAt ? this.formatAge(extractedAt).padEnd(8) : "unknown".padEnd(8);
      lines.push(`${id}  ${title}${confidence}${age}yes`);
    }

    lines.push("");
    lines.push(`Total: ${proposals.length} eligible proposal(s)`);

    return lines.join("\n");
  }

  private formatAge(extractedAt: Date): string {
    const elapsed = Date.now() - extractedAt.getTime();
    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    if (hours < 1) {
      return "<1h";
    }
    if (hours < 24) {
      return `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  formatPendingListMarkdown(proposals: IMemoryUpdateProposal[]): string {
    const lines: string[] = [
      "# Pending Memory Update Proposals",
      "",
      "| ID | Title | Category | Scope | Created |",
      "|----|-------|----------|-------|---------|",
    ];

    for (const proposal of proposals) {
      const id = proposal.id.substring(0, CLI_TRUNCATE_ID_SHORT) + "...";
      const title = proposal.learning.title.substring(0, 30);
      const category = proposal.learning.category;
      const scope = proposal.target_project || MemoryScope.GLOBAL;
      const created = proposal.created_at.substring(0, 10);
      lines.push(`| ${id} | ${title} | ${category} | ${scope} | ${created} |`);
    }

    lines.push("");
    lines.push(`**Total:** ${proposals.length} pending proposal(s)`);

    return lines.join("\n");
  }

  formatPendingShowTable(proposal: IMemoryUpdateProposal): string {
    const lines: string[] = [
      "Pending Proposal Details",
      "═".repeat(CLI_SEPARATOR_MEDIUM),
      "",
      `ID:          ${proposal.id}`,
      `Status:      ${proposal.status}`,
      `Created:     ${proposal.created_at}`,
      `Identity:     ${proposal.identity_id}`,
      `Execution:   ${proposal.execution_id}`,
      "",
      "─".repeat(60),
      "ILearning:",
      "",
      `  Title:       ${proposal.learning.title}`,
      `  Category:    ${proposal.learning.category}`,
      `  Confidence:  ${proposal.learning.confidence}`,
      `  Scope:       ${proposal.target_scope}`,
      `  Project:     ${proposal.target_project || "(global)"}`,
      "",
      "  Description:",
      `  ${proposal.learning.description}`,
      "",
      `  Tags: ${proposal.learning.tags.join(", ")}`,
      "",
      "─".repeat(60),
      `Reason: ${proposal.reason}`,
    ];

    return lines.join("\n");
  }

  formatPendingShowMarkdown(proposal: IMemoryUpdateProposal): string {
    const lines: string[] = [
      "# Pending Proposal",
      "",
      "| Field | Value |",
      "|-------|-------|",
      `| ID | ${proposal.id} |`,
      `| Status | ${proposal.status} |`,
      `| Created | ${proposal.created_at} |`,
      `| Identity | ${proposal.identity_id} |`,
      `| Execution | ${proposal.execution_id} |`,
      "",
      "## ILearning",
      "",
      `**Title:** ${proposal.learning.title}`,
      "",
      `**Category:** ${proposal.learning.category}`,
      "",
      `**Confidence:** ${proposal.learning.confidence}`,
      "",
      `**Scope:** ${proposal.target_scope}${proposal.target_project ? ` (${proposal.target_project})` : ""}`,
      "",
      "### Description",
      "",
      proposal.learning.description,
      "",
      `**Tags:** ${proposal.learning.tags.join(", ")}`,
      "",
      "---",
      "",
      `**Reason:** ${proposal.reason}`,
    ];

    return lines.join("\n");
  }

  // ===== ISkills Formatting =====

  formatSkillListTable(skills: ISkill[]): string {
    const lines: string[] = [];
    lines.push("┌──────────────────────┬─────────────────────────┬──────────┬─────────┬────────────┐");
    lines.push("│ ISkill ID             │ Name                    │ Source   │ Version │ Status     │");
    lines.push("├──────────────────────┼─────────────────────────┼──────────┼─────────┼────────────┤");

    for (const skill of skills) {
      const id = skill.skill_id.padEnd(CLI_LAYOUT_SKILL_ID_WIDTH).slice(0, CLI_LAYOUT_SKILL_ID_WIDTH);
      const name = skill.name.padEnd(CLI_LAYOUT_SKILL_NAME_WIDTH).slice(0, CLI_LAYOUT_SKILL_NAME_WIDTH);
      const source = skill.source.padEnd(CLI_LAYOUT_SKILL_SOURCE_WIDTH).slice(0, CLI_LAYOUT_SKILL_SOURCE_WIDTH);
      const version = skill.version.padEnd(CLI_LAYOUT_SKILL_VERSION_WIDTH).slice(0, CLI_LAYOUT_SKILL_VERSION_WIDTH);
      const status = skill.status.padEnd(CLI_LAYOUT_SKILL_STATUS_WIDTH).slice(0, CLI_LAYOUT_SKILL_STATUS_WIDTH);
      lines.push(`│ ${id} │ ${name} │ ${source} │ ${version} │ ${status} │`);
    }

    lines.push("└──────────────────────┴─────────────────────────┴──────────┴─────────┴────────────┘");
    lines.push(`\nTotal: ${skills.length} skill(s)`);
    return lines.join("\n");
  }

  formatSkillListMarkdown(skills: ISkill[]): string {
    const lines: string[] = [];
    lines.push("# ISkills\n");
    lines.push("| ISkill ID | Name | Source | Version | Status |");
    lines.push("|---|---|---|---|---|");

    for (const skill of skills) {
      lines.push(`| ${skill.skill_id} | ${skill.name} | ${skill.source} | ${skill.version} | ${skill.status} |`);
    }

    lines.push(`\n**Total:** ${skills.length} skill(s)`);
    return lines.join("\n");
  }

  formatSkillShowTable(skill: ISkill): string {
    const lines: string[] = [];
    lines.push("┌─────────────────────────────────────────────────────────────┐");
    lines.push(`│ ISkill: ${skill.name.padEnd(CLI_LAYOUT_BOX_LABEL_WIDTH - 4)} │`);
    lines.push(CLI_BOX_SEPARATOR);
    lines.push(`│ ISkill ID:   ${skill.skill_id.padEnd(CLI_LAYOUT_BOX_WIDTH_STANDARD)} │`);
    lines.push(`│ Source:     ${skill.source.padEnd(CLI_LAYOUT_BOX_WIDTH_STANDARD)} │`);
    lines.push(`│ Scope:      ${skill.scope.padEnd(CLI_LAYOUT_BOX_WIDTH_STANDARD)} │`);
    lines.push(`│ Version:    ${skill.version.padEnd(CLI_LAYOUT_BOX_WIDTH_STANDARD)} │`);
    lines.push(`│ Status:     ${skill.status.padEnd(CLI_LAYOUT_BOX_WIDTH_STANDARD)} │`);
    lines.push(CLI_BOX_SEPARATOR);
    lines.push(`│ Description:                                                │`);

    // Wrap description
    const descWords = skill.description.split(" ");
    let descLine = "";
    for (const word of descWords) {
      if ((descLine + " " + word).length > CLI_LAYOUT_BOX_LABEL_WIDTH) {
        lines.push(`│   ${descLine.padEnd(CLI_LAYOUT_BOX_WIDTH_WIDE)} │`);
        descLine = word;
      } else {
        descLine = descLine ? `${descLine} ${word}` : word;
      }
    }
    if (descLine) {
      lines.push(`│   ${descLine.padEnd(CLI_LAYOUT_BOX_WIDTH_WIDE)} │`);
    }

    lines.push(CLI_BOX_SEPARATOR);
    lines.push(`│ Triggers:                                                   │`);
    lines.push(
      `│   Keywords:   ${
        (skill.triggers.keywords?.join(", ") || DEFAULT_NONE_VALUE).slice(0, CLI_LAYOUT_BOX_INDENT_WIDTH).padEnd(
          CLI_LAYOUT_BOX_INDENT_WIDTH,
        )
      } │`,
    );
    lines.push(
      `│   Task Types: ${
        (skill.triggers.task_types?.join(", ") || DEFAULT_NONE_VALUE).slice(0, CLI_LAYOUT_BOX_INDENT_WIDTH).padEnd(
          CLI_LAYOUT_BOX_INDENT_WIDTH,
        )
      } │`,
    );
    lines.push(
      `│   Tags:       ${
        (skill.triggers.tags?.join(", ") || DEFAULT_NONE_VALUE).slice(0, CLI_LAYOUT_BOX_INDENT_WIDTH).padEnd(
          CLI_LAYOUT_BOX_INDENT_WIDTH,
        )
      } │`,
    );
    lines.push(CLI_BOX_SEPARATOR);
    lines.push(`│ Instructions:                                               │`);

    // Show first few lines of instructions
    const instructionLines = skill.instructions.split("\n").slice(0, 5);
    for (const line of instructionLines) {
      lines.push(`│   ${line.slice(0, CLI_LAYOUT_BOX_LABEL_WIDTH).padEnd(CLI_LAYOUT_BOX_WIDTH_WIDE)} │`);
    }
    if (skill.instructions.split("\n").length > 5) {
      lines.push(
        `│   ... (${skill.instructions.split("\n").length - 5} more lines)`.padEnd(CLI_LAYOUT_BOX_WIDTH_WIDE + 2) +
          " │",
      );
    }

    lines.push("└─────────────────────────────────────────────────────────────┘");
    return lines.join("\n");
  }

  formatSkillShowMarkdown(skill: ISkill): string {
    const lines: string[] = [];
    lines.push(`# ${skill.name}\n`);
    lines.push(`**ISkill ID:** ${skill.skill_id}`);
    lines.push(`**Source:** ${skill.source}`);
    lines.push(`**Scope:** ${skill.scope}`);
    lines.push(`**Version:** ${skill.version}`);
    lines.push(`**Status:** ${skill.status}\n`);
    lines.push(`## Description\n`);
    lines.push(skill.description + "\n");
    lines.push(`## Triggers\n`);
    lines.push(`- **Keywords:** ${skill.triggers.keywords?.join(", ") || DEFAULT_NONE_VALUE}`);
    lines.push(`- **Task Types:** ${skill.triggers.task_types?.join(", ") || DEFAULT_NONE_VALUE}`);
    lines.push(`- **Tags:** ${skill.triggers.tags?.join(", ") || DEFAULT_NONE_VALUE}\n`);
    lines.push(`## Instructions\n`);
    lines.push("```");
    lines.push(skill.instructions);
    lines.push("```");
    return lines.join("\n");
  }

  formatSkillMatchTable(matches: ISkillMatch[]): string {
    const lines: string[] = [];
    lines.push("┌──────────────────────────────────┬────────────┬─────────────────────────────────┐");
    lines.push("│ ISkill ID                         │ Confidence │ Matched Triggers                │");
    lines.push("├──────────────────────────────────┼────────────┼─────────────────────────────────┤");

    for (const match of matches) {
      const id = match.skillId.padEnd(32).slice(0, 32);
      const confidence = (match.confidence.toFixed(2)).padStart(10);
      const triggerParts: string[] = [];
      if (match.matchedTriggers.keywords?.length) {
        triggerParts.push(`kw:${match.matchedTriggers.keywords.join(",")}`);
      }
      if (match.matchedTriggers.task_types?.length) {
        triggerParts.push(`tt:${match.matchedTriggers.task_types.join(",")}`);
      }
      if (match.matchedTriggers.tags?.length) {
        triggerParts.push(`tag:${match.matchedTriggers.tags.join(",")}`);
      }
      const triggers = (triggerParts.join(" ") || DEFAULT_NONE_VALUE).slice(0, 31).padEnd(31);
      lines.push(`│ ${id} │ ${confidence} │ ${triggers} │`);
    }

    lines.push("└──────────────────────────────────┴────────────┴─────────────────────────────────┘");
    lines.push(`\nMatched: ${matches.length} skill(s)`);
    return lines.join("\n");
  }

  formatSkillMatchMarkdown(matches: ISkillMatch[]): string {
    const lines: string[] = [];
    lines.push("# Matched ISkills\n");
    lines.push("| ISkill ID | Confidence | Matched Triggers |");
    lines.push("|---|---|---|");

    for (const match of matches) {
      const triggerParts: string[] = [];
      if (match.matchedTriggers.keywords?.length) {
        triggerParts.push(`keywords: ${match.matchedTriggers.keywords.join(", ")}`);
      }
      if (match.matchedTriggers.task_types?.length) {
        triggerParts.push(`task_types: ${match.matchedTriggers.task_types.join(", ")}`);
      }
      if (match.matchedTriggers.tags?.length) {
        triggerParts.push(`tags: ${match.matchedTriggers.tags.join(", ")}`);
      }
      lines.push(
        `| ${match.skillId} | ${match.confidence.toFixed(2)} | ${triggerParts.join("; ") || DEFAULT_NONE_VALUE} |`,
      );
    }

    lines.push(`\n**Matched:** ${matches.length} skill(s)`);
    return lines.join("\n");
  }

  // ===== Helpers =====

  private appendChangesSummary(lines: string[], exec: IExecutionMemory): void {
    if (!exec.changes) return;
    const created = exec.changes.files_created?.length || 0;
    const modified = exec.changes.files_modified?.length || 0;
    const deleted = exec.changes.files_deleted?.length || 0;

    if (created + modified + deleted > 0) {
      lines.push("Changes:");
      lines.push("─".repeat(40));
      this.appendFileChangeLines(lines, "Created", created, exec.changes.files_created, "+");
      this.appendFileChangeLines(lines, "Modified", modified, exec.changes.files_modified, "~");
      this.appendFileChangeLines(lines, "Deleted", deleted, exec.changes.files_deleted, "-");
      lines.push("");
    }
  }

  private appendFileChangeLines(
    lines: string[],
    label: string,
    count: number,
    files: string[] | undefined,
    symbol: string,
  ): void {
    if (count > 0 && files) {
      lines.push(`  ${label}:  ${count} file(s)`);
      for (const f of files) {
        lines.push(`    ${symbol} ${f}`);
      }
    }
  }

  private appendLessonsAndError(lines: string[], exec: IExecutionMemory): void {
    if (exec.lessons_learned && exec.lessons_learned.length > 0) {
      lines.push("Lessons Learned:");
      lines.push("─".repeat(40));
      for (const lesson of exec.lessons_learned) {
        lines.push(`  • ${lesson}`);
      }
      lines.push("");
    }

    if (exec.error_message) {
      lines.push("Error:");
      lines.push("─".repeat(40));
      lines.push(`  ${exec.error_message}`);
    }
  }

  private appendChangesMarkdown(lines: string[], exec: IExecutionMemory): void {
    if (!exec.changes) return;
    const created = exec.changes.files_created || [];
    const modified = exec.changes.files_modified || [];
    const deleted = exec.changes.files_deleted || [];

    if (created.length + modified.length + deleted.length > 0) {
      lines.push("## Changes");
      lines.push("");
      this.appendMarkdownFileChangeSection(lines, "Created", created);
      this.appendMarkdownFileChangeSection(lines, "Modified", modified);
      this.appendMarkdownFileChangeSection(lines, "Deleted", deleted);
    }
  }

  private appendMarkdownFileChangeSection(
    lines: string[],
    label: string,
    files: string[],
  ): void {
    if (files.length > 0) {
      lines.push(`### ${label}`);
      for (const f of files) lines.push(`- \`${f}\``);
      lines.push("");
    }
  }
}
