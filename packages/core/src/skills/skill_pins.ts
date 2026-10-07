/**
 * @module SkillPins
 * @path packages/core/src/skills/skill_pins.ts
 * @description Builds and orders the durable skill pins a planning run hands to its plan. A pin
 *   names one immutable revision plus its provenance and selection metadata. Selected skills
 *   whose content the budget dropped keep their pin with `content_included` false.
 * @architectural-layer Core
 * @dependencies [./skill_types.ts, ../types/enums.ts]
 * @related-files [packages/schemas/src/skill_pin.ts, packages/execution/src/agent_runner.ts]
 */

import type { ISkill } from "@exaix/schemas/memory_bank.ts";
import { SkillMatchSource, type SkillRenderOutcome, type SkillRootKind } from "../types/enums.ts";
import type { ISkillsContext } from "../types/mod.ts";
import type { ISkillPin } from "./skill_types.ts";

type ISkillContextEntry = ISkillsContext["matched"][number];

/** The selection facts that turn a loaded skill into one prompt-ready entry. */
export interface ISkillEntryState {
  confidence: number;
  source: SkillMatchSource;
  matchedTriggers: ISkillContextEntry["matchedTriggers"];
}

/** The selection facts a pin keeps about one resolved skill. */
export interface ISkillPinSelection {
  skillId: string;
  revisionId: string;
  contentSha256: string;
  rootKind: SkillRootKind;
  sourcePath: string;
  source: SkillMatchSource;
  confidence: number;
  matchedTriggers: { task_types?: string[] };
  critical: boolean;
}

/** What one operation decided about a selected skill. */
export interface ISkillPinState {
  portal: string | null;
  renderMode: SkillRenderOutcome;
  contentIncluded: boolean;
}

/** One loaded skill as a prompt-ready entry carrying its revision identity and provenance. */
export function skillToContextEntry(skill: ISkill, state: ISkillEntryState): ISkillContextEntry {
  return {
    skillId: skill.skill_id,
    revisionId: skill.id,
    contentSha256: skill.content_sha256,
    rootKind: skill.root_kind,
    sourcePath: skill.path,
    name: skill.title,
    description: skill.description,
    content: skill.instructions,
    confidence: state.confidence,
    matchedTriggers: state.matchedTriggers,
    source: state.source,
    references: skill.references,
    tags: skill.triggers.tags || [],
    critical: skill.critical ?? false,
    effort: skill.effort,
    thinking: skill.thinking,
    examples: skill.examples,
  };
}

/** One pin. A skill the request named explicitly is required. */
export function buildSkillPin(selection: ISkillPinSelection, state: ISkillPinState): ISkillPin {
  return {
    name: selection.skillId,
    revision_id: selection.revisionId,
    content_sha256: selection.contentSha256,
    root_kind: selection.rootKind,
    source_path: selection.sourcePath,
    portal: state.portal,
    match_source: selection.source,
    confidence: selection.confidence,
    matched_task_types: [...(selection.matchedTriggers.task_types ?? [])],
    required: selection.source === SkillMatchSource.PINNED,
    render_mode: state.renderMode,
    content_included: state.contentIncluded,
  };
}

/** Descending confidence, then canonical name. */
export function orderSkillPins(pins: readonly ISkillPin[]): ISkillPin[] {
  return [...pins].sort((a, b) => b.confidence - a.confidence || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
