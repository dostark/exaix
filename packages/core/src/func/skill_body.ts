/**
 * @module SkillBody
 * @path packages/core/src/func/skill_body.ts
 * @description Canonical `## Examples` heading handling for skill bodies: the splitter
 *   that separates an Examples section for structural addressability while keeping
 *   `instructions` byte-identical to the authored body, and the inverse stripper used
 *   by trimmed render mode. Ordering is part of the backward-compatibility contract —
 *   full mode means "the body verbatim", so the splitter never reorders content and the
 *   renderer never re-appends examples after all instructions.
 * @architectural-layer Core
 * @related-files [
 *   "packages/core/src/func/prompt_formatter.ts",
 *   "scripts/build_skills_index.ts",
 *   "packages/core/src/types/constants.ts"
 * ]
 */

/** The one canonical heading marker that separates an examples section from the body. */
export const SKILL_EXAMPLES_HEADING = "## Examples";

/** Splits a body into byte-identical `instructions` (full render mode) + the addressable
 *  `examples` section (trimmed mode / size governance); no heading is a lossless no-op. */
export function splitInstructionsAndExamples(body: string): { instructions: string; examples?: string } {
  const headingMatch = /^## Examples$/m.exec(body);
  if (!headingMatch) return { instructions: body };

  const afterHeading = body.slice(headingMatch.index + headingMatch[0].length).replace(/^\n+/, "");
  const nextHeadingMatch = /\n##\s/.exec(afterHeading);

  if (!nextHeadingMatch) {
    return { instructions: body, examples: afterHeading.replace(/\n+$/, "") };
  }

  const examples = afterHeading.slice(0, nextHeadingMatch.index).replace(/\n+$/, "");
  return { instructions: body, examples };
}

/** Removes the Examples section from a body, preserving every other byte in its original
 *  order with surrounding sections joined at a single blank line (used by trimmed render
 *  mode). No heading is a lossless no-op: the body is returned unchanged. */
export function stripExamplesSection(body: string): string {
  const headingMatch = /^## Examples$/m.exec(body);
  if (!headingMatch) return body;

  const before = body.slice(0, headingMatch.index).replace(/\n+$/, "");
  const afterHeading = body.slice(headingMatch.index + headingMatch[0].length).replace(/^\n+/, "");
  const nextHeadingMatch = /\n##\s/.exec(afterHeading);

  if (!nextHeadingMatch) return before;

  const after = afterHeading.slice(nextHeadingMatch.index).replace(/^\n+/, "");
  return before && after ? `${before}\n\n${after}` : (before || after);
}
