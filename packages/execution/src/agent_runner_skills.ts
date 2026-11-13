/**
 * @module AgentRunnerSkills
 * @path packages/execution/src/agent_runner_skills.ts
 * @description The skill steps of one agent run: dynamic matching with a timeout, hydration, the durable pin vector, the submission audit and the journal rows of each.
 * @architectural-layer Services
 * @related-files [packages/execution/src/agent_runner.ts, packages/execution/tests/skill_suppression_test.ts]
 */

import type { IBlueprint } from "@exaix/core/blueprint";
import type { IParsedRequest } from "./agent_runner.ts";
import type { IGenerateResult } from "@exaix/ai/providers";
import type { EffortTier } from "@exaix/schemas";
import type { JSONValue } from "@exaix/core";
import { SkillMatchSource, SkillRenderOutcome, SkillRootKind, SkillSubmissionKind } from "@exaix/core";
import type { ISkill, ISkillMatch } from "@exaix/schemas/memory_bank.ts";
import type { ISkillsContext, ISkillsService } from "@exaix/core/types";
import {
  buildSkillPin,
  createSkillOperationContext,
  type ISkillOperationContext,
  type ISkillPin,
  type ISkillSubmissionItem,
  orderSkillPins,
  resolveDefaultSkillIds,
  skillToContextEntry,
} from "@exaix/core/skills";
import { extractKeywords } from "@exaix/core/func";
import { renderSkillEntry } from "@exaix/core/func";
import {
  SKILL_EVENT_RESOLVED,
  SKILL_EVENT_RETRIEVAL_FAILED,
  SKILL_EVENT_RETRIEVAL_TIMEOUT,
  SKILL_MATCH_TIMEOUT_MS,
} from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";

/**
 * IParsedRequest represents the user's intent and any additional context
 */
/** The skills one run submits to the model, with the round counter and any audit failure it hit. */
export interface ISkillUsagePlan {
  operation: ISkillOperationContext;
  items: ISkillSubmissionItem[];
  round: number;
  auditError?: Error;
}

/** Where the skill steps write their journal rows. */
interface ISkillJournal {
  record(action: string, target: string, payload: Record<string, JSONValue>): void;
}

// unslop-ignore-next-line unused-type
/** What the skill steps of one runner need from it. */
export interface IAgentRunnerSkillsDependencies {
  readonly skillsService: Opt<ISkillsService, Reason.OptionalDependency>;
  readonly disableSkills: boolean;
  /** The configured character budget for skill context, read on each match. */
  readonly contextBudgetChars: () => number | undefined;
  readonly journal: ISkillJournal;
}

/** Comma-separated skill ids to exclude from the resolved set for this process.
 *  A skill-ablation arm sets it. The scenario framework runs one scenario per daemon process. */
export const EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR = "EXA_EVAL_SUPPRESS_SKILLS";

/** The skill ids that `EXA_EVAL_SUPPRESS_SKILLS` excludes from this process. */
export function readSuppressedSkillIds(): Set<string> {
  const raw = Deno.env.get(EXA_EVAL_SUPPRESS_SKILLS_ENV_VAR) ?? "";
  return new Set(raw.split(",").map((id) => id.trim()).filter((id) => id.length > 0));
}

/** Skill matching, hydration, pinning and submission audit for one agent runner. */
export class AgentRunnerSkills {
  private readonly skillsService: Opt<ISkillsService, Reason.OptionalDependency>;
  private readonly disableSkills: boolean;
  private readonly contextBudgetChars: () => number | undefined;
  private readonly journal: ISkillJournal;

  constructor(dependencies: IAgentRunnerSkillsDependencies) {
    this.skillsService = dependencies.skillsService;
    this.disableSkills = dependencies.disableSkills;
    this.contextBudgetChars = dependencies.contextBudgetChars;
    this.journal = dependencies.journal;
  }

  /**
   * Match and apply skills for the given request
   */
  async matchAndApplySkills(
    blueprint: IBlueprint,
    request: IParsedRequest,
    agentRole: string,
    operation: ISkillOperationContext = this.buildSkillOperation(request, agentRole),
  ): Promise<{ skillIds: string[]; skillsContext: ISkillsContext | null }> {
    if (!this.skillsService || this.disableSkills) {
      return { skillIds: [], skillsContext: null };
    }
    const skills = this.skillsService.forContext(operation);

    const matchingStartTime = Date.now();
    try {
      // One rule: the set is pinned, plus matched, plus the agent-role defaults.
      // Keep default_skills short to limit prompt size.
      const matchScores = new Map<string, number>();
      const sources = new Map<string, SkillMatchSource>();
      const matchedTriggers = new Map<string, ISkillMatch["matchedTriggers"]>();
      const skillIds: string[] = [];
      const add = (id: string, score: number, source: SkillMatchSource) => {
        if (skillIds.includes(id)) return;
        skillIds.push(id);
        matchScores.set(id, score);
        sources.set(id, source);
      };

      const pinned = request.skills ?? [];
      for (const id of pinned) add(id, 1.0, SkillMatchSource.PINNED);

      // Pinned skills state what the caller wants, so dynamic matching is skipped.
      const matched: string[] = [];
      if (!pinned.length) {
        try {
          const result = await this.performDynamicSkillMatching(request, agentRole, skills);
          for (const match of result.matches) {
            matched.push(match.skillId);
            matchedTriggers.set(match.skillId, match.matchedTriggers);
            add(match.skillId, match.confidence, SkillMatchSource.MATCHED);
          }
        } catch (error: unknown) {
          this.logSkillRetrievalFailure(error instanceof Error ? error.message : String(error), agentRole);
        }
      }

      const defaults = resolveDefaultSkillIds(
        request.outputContract ?? blueprint.outputContract,
        blueprint.defaultSkills,
      );
      for (const id of defaults) add(id, 0.5, SkillMatchSource.DEFAULT);

      // Suppression applies to the final set, so pinned and default skills are suppressed too.
      const suppressed = readSuppressedSkillIds();
      const suppressedPresent = skillIds.filter((id) => suppressed.has(id));
      for (const id of suppressedPresent) {
        skillIds.splice(skillIds.indexOf(id), 1);
        matchScores.delete(id);
      }

      this.logSkillResolution(agentRole, skillIds, pinned, matched, defaults, suppressedPresent);

      const totalAvailable = skillIds.length;

      // 5. Hydration
      const skillsContext = await this.hydrateSkills(
        skills,
        skillIds,
        { matchScores, sources, matchedTriggers },
        totalAvailable,
        matchingStartTime,
      );

      return { skillIds, skillsContext };
    } catch (error) {
      console.error("[IAgentRunner] Skill management critical failure:", error);
      return { skillIds: [], skillsContext: null };
    }
  }

  /** One immutable skill operation context per run, shared by matching, hydration and snapshots. */
  buildSkillOperation(request: IParsedRequest, agentRole: string): ISkillOperationContext {
    return createSkillOperationContext({
      agentRole,
      portal: request.portal,
      traceId: request.traceId,
      requestId: request.requestId,
      flowId: request.flowId,
      flowStepId: request.flowStepId,
      configGeneration: this.skillsService?.currentConfigGeneration(),
    });
  }

  /** The skills whose complete rendered block survived budget fitting, one item each. Null when no skill reached the prompt.
   *  A skill the budget dropped or truncated is not included. */
  buildSkillUsagePlan(
    skillsContext: ISkillsContext | null,
    combinedPrompt: string,
    trimmed: boolean,
    operation: ISkillOperationContext,
  ): ISkillUsagePlan | null {
    if (!this.skillsService || !skillsContext) return null;
    const items: ISkillSubmissionItem[] = [];
    for (const match of skillsContext.matched) {
      const includeExamples = match.critical || !trimmed;
      if (!combinedPrompt.includes(renderSkillEntry(match, includeExamples).trimEnd())) continue;
      items.push({
        skillName: match.skillId,
        revisionId: match.revisionId,
        matchSource: match.source,
        renderMode: match.critical
          ? SkillRenderOutcome.CRITICAL
          : trimmed
          ? SkillRenderOutcome.TRIMMED
          : SkillRenderOutcome.FULL,
        rootKind: match.rootKind,
        sourcePath: match.sourcePath,
      });
    }
    return items.length === 0 ? null : { operation, items, round: 0 };
  }

  /** The durable pin vector for every skill this run selected, ordered by confidence.
   *  A skill the budget dropped stays a pin with `content_included` false. Pins are durable before the provider call.
   *  A failure stops the run. Undefined when skills are off. */
  async persistSkillPins(
    skillsContext: ISkillsContext | null,
    usage: ISkillUsagePlan | null,
    trimmed: boolean,
    operation: ISkillOperationContext,
  ): Promise<ISkillPin[] | undefined> {
    if (!this.skillsService || this.disableSkills) return undefined;
    const included = new Set(usage?.items.map((item) => item.skillName));
    const pins = orderSkillPins(
      (skillsContext?.matched ?? []).map((match) =>
        buildSkillPin(match, {
          portal: match.rootKind === SkillRootKind.PROJECT ? operation.portal : null,
          renderMode: match.critical
            ? SkillRenderOutcome.CRITICAL
            : trimmed
            ? SkillRenderOutcome.TRIMMED
            : SkillRenderOutcome.FULL,
          contentIncluded: included.has(match.skillId),
        })
      ),
    );
    await this.skillsService.ensureRevisions(pins.map((pin) => pin.revision_id), operation);
    return pins;
  }

  /** Wraps one provider dispatch round. Each attempt records the skill vector under a fresh call id first.
   *  A recording failure is rethrown unchanged and no further attempt reaches the provider. */
  withSkillUsage(
    usage: ISkillUsagePlan | null,
    generate: () => Promise<IGenerateResult>,
  ): () => Promise<IGenerateResult> {
    const skills = this.skillsService;
    if (!usage || !skills) return generate;
    usage.round += 1;
    const round = usage.round;
    let attempt = 0;
    return async () => {
      if (usage.auditError) throw usage.auditError;
      attempt += 1;
      try {
        await skills.recordSubmission({
          callId: crypto.randomUUID(),
          submissionKind: SkillSubmissionKind.PROVIDER,
          round,
          attempt,
          items: usage.items,
        }, usage.operation);
      } catch (error) {
        if (error instanceof Error) usage.auditError = error;
        throw error;
      }
      return await generate();
    };
  }

  /** Performs dynamic skill matching with a timeout guard. */
  private async performDynamicSkillMatching(
    request: IParsedRequest,
    agentRole: string,
    skills: ISkillsService,
  ): Promise<{ matches: ISkillMatch[]; totalAvailable: number }> {
    const matchingPromise = skills.matchSkills({
      requestText: request.userPrompt,
      keywords: extractKeywords(request.userPrompt),
      taskType: request.taskType,
      filePaths: request.filePaths,
      tags: request.tags,
      agentRole,
      contextBudgetChars: this.contextBudgetChars(),
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<{ matches: ISkillMatch[]; totalAvailable: number }>((_, reject) =>
      timeoutId = setTimeout(() => reject(new Error("Skill matching timed out")), SKILL_MATCH_TIMEOUT_MS)
    );

    try {
      return await Promise.race([matchingPromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Hydrate skill IDs into full ISkillsContext for prompt injection
   */
  private async hydrateSkills(
    skills: ISkillsService,
    skillIds: string[],
    resolution: {
      matchScores: Map<string, number>;
      sources: Map<string, SkillMatchSource>;
      matchedTriggers: Map<string, ISkillMatch["matchedTriggers"]>;
    },
    totalAvailable: number,
    startTime: number,
  ): Promise<ISkillsContext | null> {
    if (skillIds.length === 0) return null;

    const skillsFound = await Promise.all(
      skillIds.map((id) => skills.getSkill(id)),
    );

    const validSkills = skillsFound.filter((s): s is ISkill => s !== null);

    return {
      matched: validSkills.map((s) =>
        skillToContextEntry(s, {
          confidence: resolution.matchScores.get(s.skill_id) ?? 0.5,
          source: resolution.sources.get(s.skill_id) ?? SkillMatchSource.MATCHED,
          matchedTriggers: resolution.matchedTriggers.get(s.skill_id) ?? {},
        })
      ),
      totalAvailable,
      retrievalLatencyMs: Date.now() - startTime,
    };
  }

  /** Journals a skill match that timed out or threw. The run then continues with no skills.
   *  A timeout and a failure have separate event names. */
  private logSkillRetrievalFailure(message: string, agentRole: string): void {
    this.journal.record(
      message.includes("timed out") ? SKILL_EVENT_RETRIEVAL_TIMEOUT : SKILL_EVENT_RETRIEVAL_FAILED,
      agentRole,
      { agent_role: agentRole, error: message },
    );
    console.warn("[IAgentRunner] Skill matching failed or timed out, continuing without skills:", message);
  }

  /** Journals the final skill set with the pinned, matched and default inputs.
   *  A pinned request skips the match event, so this row makes the merge auditable. */
  private logSkillResolution(
    agentRole: string,
    skillIds: string[],
    pinned: string[],
    matched: string[],
    defaults: string[],
    suppressed: string[],
  ): void {
    this.journal.record(SKILL_EVENT_RESOLVED, agentRole, {
      agent_role: agentRole,
      skill_ids: skillIds,
      skill_count: skillIds.length,
      pinned_skill_ids: pinned,
      matched_skill_ids: matched,
      default_skill_ids: defaults,
      suppressed_skill_ids: suppressed,
    });
  }

  /** The skill floors of the matched context, for effort resolution. */
  skillFloorsOf(
    skillsContext: ISkillsContext | null,
  ): ReadonlyArray<{ skillId: string; effort?: EffortTier; thinking?: boolean }> {
    return skillsContext?.matched?.map((match) => ({
      skillId: match.skillId,
      effort: match.effort,
      thinking: match.thinking,
    })) ?? [];
  }
}
