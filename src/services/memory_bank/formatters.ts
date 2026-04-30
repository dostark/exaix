/**
 * @module MemoryFormatters
 * @path src/services/memory_bank/formatters.ts
 * @description Formatter utilities for generating markdown summaries of execution memory.
 * @architectural-layer Services
 * @related-files ["src/services/memory/memory_bank.ts", "packages/schemas/src/memory_bank.ts"]
 */

import type { IExecutionMemory } from "@exaix/schemas/memory_bank.ts";

/**
 * Format execution summary to markdown
 */
export function formatExecutionSummary(exec: IExecutionMemory): string {
  let md = `# Execution Summary\n\n`;
  md += `**Trace ID:** ${exec.trace_id}\n`;
  md += `**Request ID:** ${exec.request_id}\n`;
  md += `**Portal:** ${exec.portal}\n`;
  md += `**Identity:** ${exec.identity_id}\n`;
  md += `**Status:** ${exec.status}\n`;
  md += `**Started:** ${exec.started_at}\n`;
  if (exec.completed_at) {
    md += `**Completed:** ${exec.completed_at}\n`;
  }
  md += `\n## Summary\n\n${exec.summary}\n`;

  if (exec.changes) {
    md += `\n## Changes\n\n`;
    if (exec.changes.files_created.length > 0) {
      md += `**Created:**\n${exec.changes.files_created.map((f: string) => `- ${f}`).join("\n")}\n\n`;
    }
    if (exec.changes.files_modified.length > 0) {
      md += `**Modified:**\n${exec.changes.files_modified.map((f: string) => `- ${f}`).join("\n")}\n\n`;
    }
    if (exec.changes.files_deleted.length > 0) {
      md += `**Deleted:**\n${exec.changes.files_deleted.map((f: string) => `- ${f}`).join("\n")}\n\n`;
    }
  }

  if (exec.lessons_learned && exec.lessons_learned.length > 0) {
    md += `\n## Lessons Learned\n\n`;
    md += exec.lessons_learned.map((l: string) => `- ${l}`).join("\n");
  }

  if (exec.error_message) {
    md += `\n## Error\n\n${exec.error_message}\n`;
  }

  return md;
}
