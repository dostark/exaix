/**
 * @module MemoryPanels
 * @path src/tui/memory_panels/index.ts
 * @description Reusable panel components for the TUI Memory View, providing visualization for project, global, execution, and search results.
 * @architectural-layer TUI
 * * @related-files [src/tui/memory_view/index.ts]
 */

import type {
  IExecutionMemory,
  IGlobalMemory,
  IMemorySearchResult,
  IMemoryUpdateProposal,
  IProjectMemory,
} from "../../shared/schemas/memory_bank.ts";
import { ANSI } from "../helpers/colors.ts";
import {
  TUI_DETAIL_MAX_OVERVIEW_CHARS,
  TUI_DETAIL_MAX_SUMMARY_CHARS,
  TUI_ICON_FAILURE,
  TUI_ICON_SUCCESS,
  TUI_LIMIT_LONG,
  TUI_LIMIT_MEDIUM,
  TUI_LIMIT_SHORT,
} from "../helpers/constants.ts";

// ===== Color Constants =====

// ===== Panel Interface =====

export interface IPanelRenderOptions {
  width: number;
  height: number;
  useColors: boolean;
}

// ===== Color Constants =====

export const MemoryColors = {
  global: ANSI.magenta,
  project: ANSI.blue,
  execution: ANSI.green,
  pending: ANSI.yellow,
  pattern: ANSI.cyan,
  antiPattern: ANSI.red,
  decision: ANSI.magenta,
  insight: ANSI.blue,
  troubleshooting: ANSI.yellow,
  high: ANSI.bold,
  medium: "",
  low: ANSI.dim,
  reset: ANSI.reset,
};

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + "...";
}

function pushLimitedList(
  lines: string[],
  items: string[],
  limit: number,
  render: (item: string) => string,
): void {
  for (const item of items.slice(0, limit)) {
    lines.push(render(item));
  }
  if (items.length > limit) {
    lines.push(`  ... and ${items.length - limit} more`);
  }
}

function renderProjectOverview(lines: string[], overview: string): void {
  lines.push("## Overview");
  lines.push(truncateText(overview, TUI_DETAIL_MAX_OVERVIEW_CHARS));
  lines.push("");
}

function renderProjectPatterns(
  lines: string[],
  patterns: IProjectMemory["patterns"],
  c: { pattern: string; reset: string },
): void {
  if (!patterns || patterns.length === 0) return;
  lines.push(`${c.pattern}## Patterns (${patterns.length})${c.reset}`);
  const limit = TUI_LIMIT_MEDIUM;
  for (const p of patterns.slice(0, limit)) {
    const tags = p.tags?.length ? ` [${p.tags.join(", ")}]` : "";
    lines.push(`  • ${p.name}${tags}`);
  }
  if (patterns.length > limit) {
    lines.push(`  ... and ${patterns.length - limit} more`);
  }
  lines.push("");
}

function renderProjectDecisions(
  lines: string[],
  decisions: IProjectMemory["decisions"],
  c: { decision: string; reset: string },
): void {
  if (!decisions || decisions.length === 0) return;
  lines.push(`${c.decision}## Decisions (${decisions.length})${c.reset}`);
  const limit = TUI_LIMIT_SHORT;
  for (const d of decisions.slice(0, limit)) {
    lines.push(`  • ${d.decision}`);
  }
  if (decisions.length > limit) {
    lines.push(`  ... and ${decisions.length - limit} more`);
  }
  lines.push("");
}

function renderProjectReferences(
  lines: string[],
  references: IProjectMemory["references"],
): void {
  if (!references || references.length === 0) return;
  lines.push(`## References (${references.length})`);
  const limit = TUI_LIMIT_SHORT;
  for (const r of references.slice(0, limit)) {
    lines.push(`  • ${r.type}: ${r.path}`);
  }
  if (references.length > limit) {
    lines.push(`  ... and ${references.length - limit} more`);
  }
}

// ===== Project Panel =====

export function renderProjectPanel(
  memory: IProjectMemory | null,
  portal: string,
  options: IPanelRenderOptions,
): string {
  const lines: string[] = [];
  const { useColors } = options;
  const c = useColors ? MemoryColors : { project: "", reset: "", pattern: "", decision: "" };

  lines.push(`${c.project}# Project: ${portal}${c.reset}`);
  lines.push("");

  if (!memory) {
    lines.push("No memory bank initialized for this project.");
    lines.push("");
    lines.push("Memory banks are created automatically when:");
    lines.push("- An agent executes a task for this project");
    lines.push("- A pattern or decision is recorded");
    return lines.join("\n");
  }

  if (memory.overview) renderProjectOverview(lines, memory.overview);
  renderProjectPatterns(lines, memory.patterns, c);
  renderProjectDecisions(lines, memory.decisions, c);
  renderProjectReferences(lines, memory.references);

  return lines.join("\n");
}

// ===== Global Panel =====

export function renderGlobalPanel(
  memory: IGlobalMemory | null,
  options: IPanelRenderOptions,
): string {
  const lines: string[] = [];
  const { useColors } = options;
  const c = useColors ? MemoryColors : { global: "", reset: "", pattern: "", antiPattern: "" };

  lines.push(`${c.global}# Global Memory${c.reset}`);
  lines.push("");

  if (!memory) {
    lines.push("Global memory not initialized.");
    lines.push("");
    lines.push("Run: exactl memory init --global");
    return lines.join("\n");
  }

  if (memory.patterns && memory.patterns.length > 0) {
    lines.push(
      `${c.pattern}## Global Patterns (${memory.patterns.length})${c.reset}`,
    );
    const limit = TUI_LIMIT_SHORT;
    for (const p of memory.patterns.slice(0, limit)) {
      lines.push(`  • ${p.name}`);
    }
    if (memory.patterns.length > limit) {
      lines.push(`  ... and ${memory.patterns.length - limit} more`);
    }
    lines.push("");
  }

  if (memory.anti_patterns && memory.anti_patterns.length > 0) {
    lines.push(
      `${c.antiPattern}## Anti-Patterns (${memory.anti_patterns.length})${c.reset}`,
    );
    const limit = TUI_LIMIT_SHORT;
    for (const ap of memory.anti_patterns.slice(0, limit)) {
      lines.push(`  ⚠ ${ap.name}`);
    }
    if (memory.anti_patterns.length > limit) {
      lines.push(`  ... and ${memory.anti_patterns.length - limit} more`);
    }
    lines.push("");
  }

  if (memory.learnings && memory.learnings.length > 0) {
    lines.push(`## Learnings (${memory.learnings.length})`);
    const limit = TUI_LIMIT_MEDIUM;
    for (const l of memory.learnings.slice(0, limit)) {
      lines.push(`  • ${l.title} [${l.category}]`);
    }
    if (memory.learnings.length > limit) {
      lines.push(`  ... and ${memory.learnings.length - limit} more`);
    }
  }

  return lines.join("\n");
}

// ===== Execution Panel =====

export function renderExecutionPanel(
  memory: IExecutionMemory | null,
  options: IPanelRenderOptions,
): string {
  if (!memory) return "No execution selected.";

  const lines: string[] = [];
  const { useColors } = options;
  const c = useColors ? MemoryColors : { execution: "", reset: "" };

  renderExecutionHeader(lines, memory, c);
  renderExecutionDetails(lines, memory, useColors, c);
  renderExecutionSummary(lines, memory);
  renderExecutionFilesChanged(lines, memory);
  renderExecutionLessons(lines, memory);

  return lines.join("\n");
}

function renderExecutionHeader(
  lines: string[],
  memory: IExecutionMemory,
  c: { execution: string; reset: string },
): void {
  lines.push(`${c.execution}# Execution: ${memory.trace_id.slice(0, 12)}...${c.reset}`);
  lines.push("");
}

function getExecutionStatusPresentation(
  status: IExecutionMemory["status"],
): { icon: string; color: string } {
  if (status === "completed") return { icon: TUI_ICON_SUCCESS, color: "\x1b[32m" };
  if (status === "failed") return { icon: TUI_ICON_FAILURE, color: "\x1b[31m" };
  return { icon: "◐", color: "\x1b[33m" };
}

function renderExecutionDetails(
  lines: string[],
  memory: IExecutionMemory,
  useColors: boolean,
  c: { reset: string },
): void {
  const statusPresentation = getExecutionStatusPresentation(memory.status);

  lines.push("## Details");
  lines.push(
    `  Status: ${useColors ? statusPresentation.color : ""}${statusPresentation.icon} ${memory.status}${c.reset}`,
  );
  lines.push(`  Identity: ${memory.identity_id}`);
  lines.push(`  Started: ${formatDate(memory.started_at)}`);
  if (memory.completed_at) lines.push(`  Completed: ${formatDate(memory.completed_at)}`);
  lines.push("");
}

function renderExecutionSummary(lines: string[], memory: IExecutionMemory): void {
  if (!memory.summary) return;
  lines.push("## Summary");
  lines.push(`  ${truncateText(memory.summary, TUI_DETAIL_MAX_SUMMARY_CHARS)}`);
  lines.push("");
}

function renderExecutionFilesChanged(lines: string[], memory: IExecutionMemory): void {
  const allChanges = [
    ...memory.changes.files_created,
    ...memory.changes.files_modified,
    ...memory.changes.files_deleted,
  ];
  lines.push(`## Files Changed (${allChanges.length})`);
  pushLimitedList(lines, allChanges, TUI_LIMIT_SHORT, (file) => `  • ${file}`);
  lines.push("");
}

function renderExecutionLessons(lines: string[], memory: IExecutionMemory): void {
  if (!memory.lessons_learned || memory.lessons_learned.length === 0) return;
  lines.push("## Lessons Learned");
  for (const lesson of memory.lessons_learned) {
    lines.push(`  💡 ${lesson}`);
  }
}

// ===== Execution List Panel =====

export function renderExecutionListPanel(
  executions: IExecutionMemory[],
  selectedIndex: number,
  options: IPanelRenderOptions,
): string {
  const lines: string[] = [];
  const { height } = options;

  lines.push("# Recent Executions");
  lines.push("");

  if (executions.length === 0) {
    lines.push("No executions yet.");
    return lines.join("\n");
  }

  const maxVisible = Math.min(executions.length, height - 4);
  const startIdx = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
  const endIdx = Math.min(executions.length, startIdx + maxVisible);

  for (let i = startIdx; i < endIdx; i++) {
    const exec = executions[i];
    const selected = i === selectedIndex ? ">" : " ";
    const statusIcon = exec.status === "completed"
      ? TUI_ICON_SUCCESS
      : exec.status === "failed"
      ? TUI_ICON_FAILURE
      : "◐";
    const summary = exec.summary?.slice(0, 40) ?? "";
    lines.push(`${selected} ${statusIcon} ${exec.trace_id.slice(0, 8)} ${summary}`);
  }

  if (executions.length > maxVisible) {
    lines.push("");
    lines.push(`Showing ${startIdx + 1}-${endIdx} of ${executions.length}`);
  }

  return lines.join("\n");
}

// ===== Search Panel =====

export function renderSearchPanel(
  query: string,
  results: IMemorySearchResult[],
  selectedIndex: number,
  options: IPanelRenderOptions,
): string {
  const lines: string[] = [];
  const { useColors } = options;

  lines.push("# Search Results");
  lines.push("");
  lines.push(`Query: "${query}"`);
  lines.push("");

  if (results.length === 0) {
    lines.push("No results found.");
    lines.push("");
    lines.push("Try:");
    lines.push("  • Different keywords");
    lines.push("  • Broader search terms");
    lines.push("  • Tag-based search with #tag");
    return lines.join("\n");
  }

  lines.push(`Found ${results.length} results:`);
  lines.push("");

  const limit = TUI_LIMIT_LONG;
  for (let i = 0; i < Math.min(results.length, limit); i++) {
    const result = results[i];
    const selected = i === selectedIndex ? ">" : " ";
    const score = (result.relevance_score ?? 0).toFixed(2);
    const typeColor = useColors ? getCategoryColor(result.type) : "";
    const reset = useColors ? MemoryColors.reset : "";

    lines.push(`${selected} ${typeColor}[${result.type}]${reset} ${result.title}`);
    lines.push(`    Score: ${score} | Portal: ${result.portal ?? "global"}`);
  }

  if (results.length > limit) {
    lines.push("");
    lines.push(`... and ${results.length - limit} more results`);
  }

  return lines.join("\n");
}

// ===== Pending Panel =====

export function renderPendingPanel(
  proposals: IMemoryUpdateProposal[],
  selectedIndex: number,
  options: IPanelRenderOptions,
): string {
  const lines: string[] = [];
  const { useColors } = options;
  const c = useColors ? MemoryColors : { pending: "", reset: "" };

  lines.push(`${c.pending}# Pending Proposals${c.reset}`);
  lines.push("");

  if (proposals.length === 0) {
    lines.push("No pending proposals.");
    lines.push("");
    lines.push("Proposals are created when agents identify");
    lines.push("patterns, decisions, or insights during execution.");
    return lines.join("\n");
  }

  lines.push(`${proposals.length} proposal(s) awaiting review:`);
  lines.push("");

  const limit = TUI_LIMIT_MEDIUM;
  for (let i = 0; i < Math.min(proposals.length, limit); i++) {
    const proposal = proposals[i];
    const selected = i === selectedIndex ? ">" : " ";
    const age = formatAge(proposal.created_at);

    lines.push(`${selected} [${proposal.learning.category}] ${proposal.learning.title}`);
    lines.push(`    Scope: ${proposal.target_scope} | ${age}`);
  }

  if (proposals.length > limit) {
    lines.push("");
    lines.push(`... and ${proposals.length - limit} more`);
  }

  return lines.join("\n");
}

// ===== Stats Panel =====

export function renderStatsPanel(
  stats: {
    projectCount: number;
    executionCount: number;
    pendingCount: number;
    globalLearnings: number;
  },
  options: IPanelRenderOptions,
): string {
  const lines: string[] = [];
  const { useColors } = options;
  const c = useColors ? MemoryColors : { global: "", project: "", execution: "", pending: "", reset: "" };

  lines.push("# Memory Statistics");
  lines.push("");
  lines.push(`${c.project}Projects:${c.reset}   ${stats.projectCount}`);
  lines.push(`${c.execution}Executions:${c.reset} ${stats.executionCount}`);
  lines.push(`${c.global}Learnings:${c.reset}  ${stats.globalLearnings}`);
  lines.push(`${c.pending}Pending:${c.reset}    ${stats.pendingCount}`);

  return lines.join("\n");
}

// ===== Helper Functions =====

function getCategoryColor(category: string): string {
  switch (category) {
    case "pattern":
      return MemoryColors.pattern;
    case "decision":
      return MemoryColors.decision;
    case "anti-pattern":
      return MemoryColors.antiPattern;
    case "insight":
      return MemoryColors.insight;
    case "troubleshooting":
      return MemoryColors.troubleshooting;
    default:
      return "";
  }
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch {
    return dateStr;
  }
}

function formatAge(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins} min ago`;
    }
    if (diffHours < 24) {
      return `${diffHours} hours ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} days ago`;
  } catch {
    return dateStr;
  }
}
