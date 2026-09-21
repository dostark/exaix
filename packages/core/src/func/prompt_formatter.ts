/**
 * @module PromptFormatter
 * @path packages/core/src/func/prompt_formatter.ts
 * @description Helpers for formatting agent prompts with structured context (Phase 70).
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts]
 */

import type { ISkillsContext } from "@exaix/core/types";
import { stripExamplesSection } from "./skill_body.ts";

/** A single matched-skill entry (element of `ISkillsContext.matched`). */
type ISkillMatchEntry = ISkillsContext["matched"][number];

/** Renders a heading + skill matches. `instructions` carry the full body byte-identically
 *  (ordering is a compatibility contract), so examples are never re-appended; `false` strips
 *  the Examples section for trimmed mode. */
function renderSkillBlock(
  heading: string,
  intro: string,
  skills: ISkillMatchEntry[],
  includeExamples: boolean,
): string {
  if (skills.length === 0) return "";

  let output = `### ${heading}\n${intro}\n\n`;
  for (const skill of skills) {
    output += `#### ${skill.title}\n`;
    output += `${skill.description}\n\n`;
    const instructions = includeExamples ? skill.content : stripExamplesSection(skill.content);
    output += `**Instructions:**\n${instructions}\n\n`;
    if (skill.tags.length > 0) {
      output += `*Tags: ${skill.tags.join(", ")}*\n\n`;
    }
  }
  return output;
}

/** Ordinary skills render in a compactable segment via {@link renderSkillsSection};
 *  `trimmed` (default `false`) strips each ordinary skill's Examples section, leaving all
 *  other content untouched and in original order. */
export function renderSkillsSection(context: ISkillsContext | null, trimmed = false): string {
  if (!context || context.matched.length === 0) return "";

  const ordinary = context.matched.filter((s) => !s.critical);
  let output = renderSkillBlock(
    "APPLICABLE SKILLS & PROCEDURES",
    "The following specialized procedures should be applied to this task:",
    ordinary,
    !trimmed,
  );

  if (output && context.matched.length < context.totalAvailable) {
    output += `*(Note: ${
      context.totalAvailable - context.matched.length
    } additional skills were matched but omitted due to context budget)*\n`;
  }

  return output.trim();
}

/** Critical skills render in the protected, non-compactable segment; always full (never
 *  trimmed), so the output contract and hard constraints survive budget pressure. */
export function renderCriticalSkillsSection(context: ISkillsContext | null): string {
  if (!context || context.matched.length === 0) return "";
  return renderSkillBlock(
    "REQUIRED SKILLS & CONTRACT",
    "The following procedures are MANDATORY and must be applied in full:",
    context.matched.filter((s) => s.critical),
    true,
  ).trim();
}
