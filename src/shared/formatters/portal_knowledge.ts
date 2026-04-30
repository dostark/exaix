/**
 * @module KnowledgeFormatter
 * @path src/shared/formatters/portal_knowledge.ts
 * @description Provides logic for formatting IPortalKnowledge objects into human-readable text.
 * @architectural-layer Shared
 * @related-files ["packages/schemas/src/portal_knowledge.ts", src/cli/commands/portal_commands.ts]
 */

import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";

/**
 * Renders an IPortalKnowledge record into an array of strings for CLI or TUI output.
 */
export function formatKnowledge(knowledge: IPortalKnowledge): string[] {
  const lines: string[] = [];

  formatArchitectureOverview(knowledge, lines);
  formatKeyFiles(knowledge, lines);
  formatConventions(knowledge, lines);
  formatDependencies(knowledge, lines);

  return lines;
}

function formatArchitectureOverview(knowledge: IPortalKnowledge, lines: string[]): void {
  if (knowledge.architectureOverview) {
    lines.push("=== Architecture Overview ===");
    // Limit overview to 20 lines to avoid overwhelming output
    const overviewLines = knowledge.architectureOverview.split("\n");
    for (const line of overviewLines.slice(0, 20)) {
      lines.push(line);
    }
    if (overviewLines.length > 20) {
      lines.push("  ...");
    }
  }
}

function formatKeyFiles(knowledge: IPortalKnowledge, lines: string[]): void {
  if (knowledge.keyFiles && knowledge.keyFiles.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("=== Key Files ===");
    for (const kf of knowledge.keyFiles) {
      lines.push(`  ${kf.path} [${kf.role}]: ${kf.description}`);
    }
  }
}

function formatConventions(knowledge: IPortalKnowledge, lines: string[]): void {
  if (knowledge.conventions && knowledge.conventions.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("=== Conventions ===");
    const byCategory = new Map<string, Array<{ name: string; description: string }>>();
    for (const conv of knowledge.conventions) {
      const category = conv.category || "General";
      const existing = byCategory.get(category) ?? [];
      existing.push({ name: conv.name, description: conv.description });
      byCategory.set(category, existing);
    }
    for (const [category, items] of byCategory) {
      lines.push(`  [${category}]`);
      for (const item of items) {
        lines.push(`    • ${item.name}: ${item.description}`);
      }
    }
  }
}

function formatDependencies(knowledge: IPortalKnowledge, lines: string[]): void {
  if (knowledge.dependencies && knowledge.dependencies.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("=== Dependencies ===");
    for (const dep of knowledge.dependencies) {
      for (const kd of dep.keyDependencies) {
        const purpose = kd.purpose ? ` — ${kd.purpose}` : "";
        lines.push(`  ${kd.name}${purpose}`);
      }
    }
  }
}
