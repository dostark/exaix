/**
 * @module MemoryParsers
 * @path packages/memory/src/bank/parsers.ts
 * @description Parser utilities for extracting patterns and decisions from memory bank markdown content.
 * @architectural-layer Services
 * @related-files ["packages/memory/src/bank/memory_bank.ts", "packages/schemas/src/memory_bank.ts"]
 */

import type { IDecision, IPattern } from "@exaix/schemas/memory_bank.ts";

const TAGS_SECTION_HEADER = "**Tags:";

function parseTags(lines: string[]): string[] | undefined {
  const tagsLine = lines.find((line) => line.startsWith(TAGS_SECTION_HEADER));
  if (!tagsLine) return undefined;
  const tagsMatch = tagsLine.match(/\*\*Tags:\*\* (.+)/);
  return tagsMatch ? tagsMatch[1].split(", ").map((t) => t.trim()) : undefined;
}

/**
 * Parse patterns from markdown content
 */
export function parsePatterns(content: string): IPattern[] {
  const patterns: IPattern[] = [];
  const sections = content.split(/^## /m).filter((s) => s.trim());

  for (const section of sections) {
    const lines = section.split("\n");
    const name = lines[0].trim();

    // Find the description (everything until **Examples** or **Tags**)
    let descriptionEnd = lines.length;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith("**Examples:**") || lines[i].startsWith(TAGS_SECTION_HEADER)) {
        descriptionEnd = i;
        break;
      }
    }

    const description = lines.slice(1, descriptionEnd).join("\n").trim();

    // Parse examples
    const examples: string[] = [];
    const examplesStart = lines.findIndex((line) => line.startsWith("**Examples:**"));
    if (examplesStart !== -1) {
      for (let i = examplesStart + 1; i < lines.length; i++) {
        if (lines[i].startsWith("**") || lines[i].trim() === "") break;
        const match = lines[i].match(/^- (.+)$/);
        if (match) {
          examples.push(match[1]);
        }
      }
    }

    const tags = parseTags(lines);

    if (name && description) {
      patterns.push({
        name,
        description,
        examples,
        tags,
      });
    }
  }

  return patterns;
}

/**
 * Parse decisions from markdown content
 */
export function parseDecisions(content: string): IDecision[] {
  const decisions: IDecision[] = [];
  const sections = content.split(/^## /m).filter((s) => s.trim());

  for (const section of sections) {
    const lines = section.split("\n");
    const match = lines[0].match(/^(\d{4}-\d{2}-\d{2}): (.+)$/);

    if (match) {
      const date = match[1];
      const decision = match[2];

      // Find the rationale (everything until **Alternatives** or **Tags**)
      let rationaleEnd = lines.length;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith("**Alternatives considered:**") || lines[i].startsWith(TAGS_SECTION_HEADER)) {
          rationaleEnd = i;
          break;
        }
      }

      const rationale = lines.slice(1, rationaleEnd).join("\n").trim();

      // Parse alternatives
      let alternatives: string[] | undefined;
      const alternativesLine = lines.find((line) => line.startsWith("**Alternatives considered:"));
      if (alternativesLine) {
        const alternativesMatch = alternativesLine.match(/\*\*Alternatives considered:\*\* (.+)/);
        if (alternativesMatch) {
          alternatives = alternativesMatch[1].split(", ").map((a) => a.trim());
        }
      }

      const tags = parseTags(lines);

      decisions.push({
        date,
        decision,
        rationale,
        alternatives,
        tags,
      });
    }
  }

  return decisions;
}
