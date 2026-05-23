/**
 * @module PromptFormatter
 * @path packages/core/src/func/prompt_formatter.ts
 * @description Helpers for formatting agent prompts with structured context (Phase 70).
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts]
 */

import type { ISkillsContext } from "@exaix/core/types";

export function renderSkillsSection(context: ISkillsContext | null): string {
  if (!context || context.matched.length === 0) {
    return "";
  }

  let output = "### APPLICABLE SKILLS & PROCEDURES\n";
  output += "The following specialized procedures should be applied to this task:\n\n";

  for (const skill of context.matched) {
    output += `#### ${skill.title}\n`;
    output += `${skill.description}\n\n`;
    output += `**Instructions:**\n${skill.content}\n\n`;

    if (skill.tags.length > 0) {
      output += `*Tags: ${skill.tags.join(", ")}*\n\n`;
    }
  }

  if (context.matched.length < context.totalAvailable) {
    output += `*(Note: ${
      context.totalAvailable - context.matched.length
    } additional skills were matched but omitted due to context budget)*\n`;
  }

  return output.trim();
}
