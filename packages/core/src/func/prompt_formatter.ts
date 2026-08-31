/**
 * @module PromptFormatter
 * @path packages/core/src/func/prompt_formatter.ts
 * @description Helpers for formatting agent prompts with structured context (Phase 70).
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts]
 */

import type { ISkillsContext } from "@exaix/core/types";

/** A single matched-skill entry (element of `ISkillsContext.matched`). */
type ISkillMatchEntry = ISkillsContext["matched"][number];

/** Renders a heading + the supplied skill matches as a markdown block. */
function renderSkillBlock(heading: string, intro: string, skills: ISkillMatchEntry[]): string {
  if (skills.length === 0) return "";

  let output = `### ${heading}\n${intro}\n\n`;
  for (const skill of skills) {
    output += `#### ${skill.title}\n`;
    output += `${skill.description}\n\n`;
    output += `**Instructions:**\n${skill.content}\n\n`;
    if (skill.tags.length > 0) {
      output += `*Tags: ${skill.tags.join(", ")}*\n\n`;
    }
  }
  return output;
}

/** Critical skills are rendered separately by {@link renderCriticalSkillsSection} so the
 *  prompt assembler can place them in a protected, non-droppable segment. */
export function renderSkillsSection(context: ISkillsContext | null): string {
  if (!context || context.matched.length === 0) return "";

  const ordinary = context.matched.filter((s) => !s.critical);
  let output = renderSkillBlock(
    "APPLICABLE SKILLS & PROCEDURES",
    "The following specialized procedures should be applied to this task:",
    ordinary,
  );

  if (output && context.matched.length < context.totalAvailable) {
    output += `*(Note: ${
      context.totalAvailable - context.matched.length
    } additional skills were matched but omitted due to context budget)*\n`;
  }

  return output.trim();
}

/** The prompt assembler places this in a protected, non-compactable segment so the
 *  output contract and hard constraints survive context-budget pressure. */
export function renderCriticalSkillsSection(context: ISkillsContext | null): string {
  if (!context || context.matched.length === 0) return "";
  return renderSkillBlock(
    "REQUIRED SKILLS & CONTRACT",
    "The following procedures are MANDATORY and must be applied in full:",
    context.matched.filter((s) => s.critical),
  ).trim();
}
