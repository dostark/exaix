/**
 * @module SkillPinTransport
 * @path packages/execution/src/skill_pin_transport.ts
 * @description Turns the pins a plan approved into prompt text and per-submission usage records.
 *   The pinned snapshots, never live files, supply the rendered blocks. Each execution transport
 *   asks the prompt to record the skills whose complete block it is about to submit, immediately
 *   before the provider call or CLI launch. A failed record throws, so nothing is dispatched.
 * @architectural-layer Services
 * @dependencies [@exaix/core, @exaix/core/skills, @exaix/core/func, @exaix/core/types]
 * @related-files [packages/execution/src/agent_composer.ts, packages/execution/src/strategies/react_loop_strategy.ts]
 */

import { SkillMatchSource, SkillRenderOutcome, type SkillSubmissionKind } from "@exaix/core";
import { renderCriticalSkillsSection, renderSkillEntry, renderSkillsSection } from "@exaix/core/func";
import {
  type IPinnedSkill,
  type ISkillOperationContext,
  type ISkillPin,
  type ISkillSubmissionItem,
  skillToContextEntry,
} from "@exaix/core/skills";
import type { ISkillsContext, ISkillsService } from "@exaix/core/types";

interface IPinnedPromptEntry {
  item: ISkillSubmissionItem;
  block: string;
  critical: boolean;
  entry: ISkillsContext["matched"][number];
}

/** The rendered, frozen skill text of one plan execution and the way to record its submissions. */
export interface IPinnedSkillPrompt {
  /** Critical then ordinary skill sections, ready to place in a prompt. Empty when nothing fits. */
  readonly text: string;
  /** Records one submission for each skill whose complete block is inside `submitted`. */
  record(submitted: string, kind: SkillSubmissionKind, round: number): Promise<void>;
  /** The same prompt cut to whole skills that fit in `maxChars`, critical skills first. */
  fit(maxChars: number): IPinnedSkillPrompt;
}

/**
 * Resolves the pins to their stored snapshots and renders the included ones. Returns null when no
 * pin carries content. Throws `skill_unavailable` for any pin that cannot be resolved, before
 * anything renders.
 */
export async function createPinnedSkillPrompt(
  skills: ISkillsService,
  pins: readonly ISkillPin[],
  operation: ISkillOperationContext,
): Promise<IPinnedSkillPrompt | null> {
  const resolved = await skills.resolvePinned(pins, operation);
  const included = resolved.filter((entry) => entry.pin.content_included);
  if (included.length === 0) return null;

  const trimmed = included.some((entry) => !entry.loaded.skill.critical && isTrimmed(entry));
  const entries: IPinnedPromptEntry[] = included.map((pinned) => {
    const entry = skillToContextEntry(pinned.loaded.skill, {
      confidence: pinned.pin.confidence,
      source: SkillMatchSource.PLAN_PINNED,
      matchedTriggers: {},
    });
    return {
      item: submissionItem(pinned, trimmed),
      block: renderSkillEntry(entry, entry.critical || !trimmed).trimEnd(),
      critical: entry.critical,
      entry,
    };
  });
  return assemble(skills, operation, entries, trimmed);
}

function assemble(
  skills: ISkillsService,
  operation: ISkillOperationContext,
  entries: readonly IPinnedPromptEntry[],
  trimmed: boolean,
): IPinnedSkillPrompt {
  const context: ISkillsContext = {
    matched: entries.map((entry) => entry.entry),
    totalAvailable: entries.length,
    retrievalLatencyMs: 0,
  };
  const text = [renderCriticalSkillsSection(context), renderSkillsSection(context, trimmed)]
    .filter((section) => section.length > 0)
    .join("\n\n");
  return {
    text,
    async record(submitted, kind, round) {
      const items = entries.filter((entry) => submitted.includes(entry.block)).map((entry) => entry.item);
      if (items.length === 0) return;
      await skills.recordSubmission(
        { callId: crypto.randomUUID(), submissionKind: kind, round, attempt: 1, items },
        operation,
      );
    },
    fit(maxChars) {
      const kept: IPinnedPromptEntry[] = [];
      const ordered = [...entries.filter((entry) => entry.critical), ...entries.filter((entry) => !entry.critical)];
      for (const candidate of ordered) {
        const next = assemble(skills, operation, [...kept, candidate], trimmed);
        if (next.text.length <= maxChars) kept.push(candidate);
      }
      return assemble(skills, operation, entries.filter((entry) => kept.includes(entry)), trimmed);
    },
  };
}

function isTrimmed(entry: IPinnedSkill): boolean {
  return entry.pin.render_mode === SkillRenderOutcome.TRIMMED;
}

function submissionItem(entry: IPinnedSkill, trimmed: boolean): ISkillSubmissionItem {
  const critical = entry.loaded.skill.critical === true;
  return {
    skillName: entry.pin.name,
    revisionId: entry.pin.revision_id,
    matchSource: SkillMatchSource.PLAN_PINNED,
    renderMode: critical ? SkillRenderOutcome.CRITICAL : trimmed ? SkillRenderOutcome.TRIMMED : SkillRenderOutcome.FULL,
    rootKind: entry.pin.root_kind,
    sourcePath: entry.pin.source_path,
  };
}
