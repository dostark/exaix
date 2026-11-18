/**
 * @module PortalKnowledgeSummary
 * @path packages/request/src/portal_knowledge_summary.ts
 * @description The capped Markdown summary of a portal's knowledge, shared by the request processor and its context builder.
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/request/src/processor.ts, packages/request/src/portal_context_builder.ts]
 */

import { PORTAL_KNOWLEDGE_PROMPT_MAX_LINES } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import type { IPortalKnowledge } from "@exaix/schemas/portal_knowledge.ts";

/** Build a capped Markdown summary of IPortalKnowledge for injection into agent prompts. Includes: architecture overview (first 20 lines), top-5 key files, top-5 conventions sorted by evidenceCount descending. Capped at maxLines lines. */
export function buildPortalKnowledgeSummary(
  knowledge: IPortalKnowledge,
  maxLines: Opt<number, Reason.SensibleDefault> = PORTAL_KNOWLEDGE_PROMPT_MAX_LINES,
): string {
  const lines: string[] = ["## Portal Knowledge Summary"];

  if (knowledge.architectureOverview) {
    lines.push("### Architecture");
    const overviewLines = knowledge.architectureOverview.split("\n").slice(0, 20);
    lines.push(...overviewLines);
  }

  if (knowledge.keyFiles.length > 0) {
    lines.push("### Key Files");
    for (const kf of knowledge.keyFiles.slice(0, 5)) {
      lines.push(`- \`${kf.path}\` (${kf.role}): ${kf.description}`);
    }
  }

  const topConventions = [...knowledge.conventions]
    .sort((a, b) => b.evidenceCount - a.evidenceCount)
    .slice(0, 5);
  if (topConventions.length > 0) {
    lines.push("### Conventions");
    for (const c of topConventions) {
      lines.push(`- ${c.name}: ${c.description}`);
    }
  }

  return lines.slice(0, maxLines).join("\n");
}
