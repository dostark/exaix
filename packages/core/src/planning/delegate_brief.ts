/**
 * @module DelegateBrief
 * @path packages/core/src/planning/delegate_brief.ts
 * @description Pure helper to build delegate brief args (objective + acceptanceCriteria) from
 *   step data for the code-changes delegation callback (Phase 150 Step 1).
 * @architectural-layer Core
 * @related-files ["packages/core/src/planning/plan_executor.ts", "apps/daemon/main.ts"]
 */
export interface IDelegateBriefArgs {
  objective: string;
  acceptanceCriteria?: string[];
}

const ACCEPTANCE_HEADING_PATTERN = /^##\s+(?:Acceptance|Success\s+Criteria|Acceptance\s+Criteria)\s*$/im;

/** Extracts bullet items from an Acceptance/Success Criteria heading in step markdown;
 * returns [] when no such section exists. */
export function parseAcceptanceFromContent(content: string): string[] {
  const match = ACCEPTANCE_HEADING_PATTERN.exec(content);
  if (!match) return [];
  const sectionStart = match.index + match[0].length;
  const rest = content.slice(sectionStart);
  // Stop at the next heading (## or #) or end of content
  const nextHeading = /^#{1,2}\s/m.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const bullets: string[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const item = trimmed.slice(2).trim();
      if (item.length > 0) bullets.push(item);
    }
  }
  return bullets;
}

export function buildDelegateBriefArgs(
  step: { title: string; content: string; successCriteria?: string[] },
): IDelegateBriefArgs {
  const acceptance = step.successCriteria?.length
    ? [...step.successCriteria]
    : parseAcceptanceFromContent(step.content);
  return {
    objective: step.content,
    acceptanceCriteria: acceptance.length > 0 ? acceptance : undefined,
  };
}

/** Checks whether a brief objective is contentless (empty) or matches the legacy
 * placeholder shape ("Execute step N"); true means the guard should reject the brief. */
export function isContentlessBrief(objective: string): boolean {
  if (!objective || objective.trim().length === 0) return true;
  const placeholderPattern = /^[Ee]xecute\s+step\s+\d+/;
  return placeholderPattern.test(objective.trim());
}
