/**
 * @module EffortResolver
 * @path packages/ai/src/effort_resolver.ts
 * @description Turns declaration-time effort/thinking values (including "auto") into a
 *   concrete, provider-facing resolution. Pure — no I/O, no event logger; the callers
 *   (AgentRunner.run, AgentComposer.executeStep) do the journaling. Two strategies:
 *   native-adaptive for thinking on Anthropic models that adapt natively, and a
 *   heuristic built on TaskComplexity for every other case. The literal "auto" never
 *   leaves this module.
 * @architectural-layer AI
 * @dependencies [@exaix/core, @exaix/schemas, @exaix/schemas/request_analysis.ts]
 * @related-files [packages/execution/src/agent_runner.ts, packages/execution/src/agent_composer.ts, packages/request/src/task_complexity_classifier.ts]
 */

import { ProviderType, TaskComplexity } from "@exaix/core";
import type { Opt, Reason } from "@exaix/core/types";
import { EFFORT_AUTO, EffortTierSchema } from "@exaix/schemas";
import type {
  EffortDeclaration,
  EffortResolutionBasis,
  EffortTier,
  ModelSize,
  ThinkingDeclaration,
} from "@exaix/schemas";
import type { RequestAnalysisComplexity } from "@exaix/schemas/request_analysis.ts";

/** Which signal decided TaskComplexity — journaled so an LLM-derived value is
 *  distinguishable from a content/agent-id fallback. */
export type TaskComplexitySource = "analysis" | "content_heuristic" | "agent_role" | "default";

/** The surface whose declaration governs a field — the precedence rule's source. */
export type EffortDeclarationSource = "request" | "flow_step" | "role" | "none";

export interface IEffortDeclarationPair {
  effort?: EffortDeclaration;
  thinking?: ThinkingDeclaration;
}

/** One pair per surface; the resolver applies the Constraints precedence rule. */
export interface IEffortDeclarations {
  request?: IEffortDeclarationPair;
  flowStep?: IEffortDeclarationPair;
  role?: IEffortDeclarationPair;
}

export interface IEffortResolutionSignals {
  taskComplexity: TaskComplexity;
  complexitySource: TaskComplexitySource;
  modelSize?: ModelSize;
  /** Normalized via resolveProviderType() — never a raw `${provider}-${model}` id. */
  providerType: ProviderType | undefined;
  /** Concrete model id of the provider making the call (native-adaptive is per model). */
  model: string | undefined;
  /** ProviderRegistry.getProviderMetadata(providerType)?.supportsThinking === true. */
  providerSupportsThinking: boolean;
  /** config.ai_anthropic.thinking_default — false turns an omitted field into "disabled". */
  anthropicThinkingDefault?: boolean;
  /** Floors from every skill in the final resolved skill set. */
  skillFloors: ReadonlyArray<{ skillId: string; effort?: EffortTier; thinking?: boolean }>;
  /** Agent-role id, used for the role-floor lookup. */
  agentRole?: string;
}

export interface IEffortResolution {
  effort: EffortTier | undefined; // undefined = omit the field
  thinking: boolean | undefined; // undefined = omit the field
  effortBasis: EffortResolutionBasis;
  thinkingBasis: EffortResolutionBasis;
  declarationSource: EffortDeclarationSource;
  /** True when the governing declaration was concrete — the only case where the
   *  execution path sets max_tokens from EFFORT_MAX_TOKENS. */
  concreteDeclaration: boolean;
  /** Present whenever an `auto` declaration was resolved by the heuristic. */
  heuristicInputs?: {
    taskComplexity: TaskComplexity;
    complexitySource: TaskComplexitySource;
    modelSize?: ModelSize;
  };
  /** Skill ids and `role:<id>` entries that raised a value, in application order. */
  floorsApplied: string[];
}

export interface IEffortResolver {
  resolve(declarations: IEffortDeclarations, signals: IEffortResolutionSignals): IEffortResolution;
}

/** Runtime labels for TaskComplexitySource at positions that assign (not type) them. */
export const COMPLEXITY_SOURCE_ANALYSIS: TaskComplexitySource = "analysis";
export const COMPLEXITY_SOURCE_DEFAULT: TaskComplexitySource = "default";

/** A declaration value from any surface: an effort tier, a thinking boolean, or "auto". */
type DeclarationValue = EffortDeclaration | boolean | undefined;

/** Internal resolved value before it is narrowed to the provider-facing fields. */
type FieldResolutionValue = EffortTier | boolean | undefined;

/** The field being resolved — effort or thinking. */
type ResolutionField = "effort" | "thinking";

/** Journaled basis labels (EffortResolutionBasis) used at runtime-comparison sites. */
const BASIS_DECLARED: EffortResolutionBasis = "declared";
const BASIS_UNSET: EffortResolutionBasis = "unset";
const BASIS_HEURISTIC: EffortResolutionBasis = "heuristic";
const BASIS_NATIVE_ADAPTIVE: EffortResolutionBasis = "native-adaptive";
const BASIS_SKILL_FLOOR: EffortResolutionBasis = "skill-floor";

/** Source labels (EffortDeclarationSource) used at runtime positions. */
const SOURCE_REQUEST: EffortDeclarationSource = "request";
const SOURCE_FLOW_STEP: EffortDeclarationSource = "flow_step";
const SOURCE_ROLE: EffortDeclarationSource = "role";
const SOURCE_NONE: EffortDeclarationSource = "none";

/** Resolution field discriminator used as a function argument. */
const FIELD_EFFORT: ResolutionField = "effort";
const FIELD_THINKING: ResolutionField = "thinking";

/** Effort tiers in ascending order — the floor merge rule takes the maximum. */
export const EFFORT_TIER_ORDER: readonly EffortTier[] = [
  EffortTierSchema.enum.low,
  EffortTierSchema.enum.medium,
  EffortTierSchema.enum.high,
];

/** Effort reached per TaskComplexity when a declaration resolves through the heuristic. */
export const EFFORT_AUTO_HEURISTIC: Record<TaskComplexity, EffortTier> = {
  [TaskComplexity.SIMPLE]: EffortTierSchema.enum.low,
  [TaskComplexity.MEDIUM]: EffortTierSchema.enum.medium,
  [TaskComplexity.COMPLEX]: EffortTierSchema.enum.high,
  [TaskComplexity.EPIC]: EffortTierSchema.enum.high,
};

/** Thinking reached per TaskComplexity when a declaration resolves through the heuristic.
 *  A `true` entry resolves to `true` only when the provider supports thinking; a `false`
 *  entry resolves to `undefined`, so `auto` never sends an explicit disable. */
export const THINKING_AUTO_HEURISTIC: Record<TaskComplexity, boolean> = {
  [TaskComplexity.SIMPLE]: false,
  [TaskComplexity.MEDIUM]: false,
  [TaskComplexity.COMPLEX]: true,
  [TaskComplexity.EPIC]: true,
};

/** Cap on heuristic effort for small models: modelSize "S" never resolves above "medium". */
export const EFFORT_AUTO_SMALL_MODEL_CAP: EffortTier = EffortTierSchema.enum.medium;

/** Model prefixes that run adaptive thinking when the `thinking` field is omitted.
 *  Verified against the Claude API reference: Fable 5/5.1 (and Mythos), Opus 5/5.5 and
 *  Sonnet 5. Unknown or newer models fall back to the heuristic (Risk R5). */
export const NATIVE_ADAPTIVE_THINKING_MODEL_PREFIXES: readonly string[] = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-sonnet-5",
];

/** Exact match on a ProviderType value, else the LONGEST ProviderType value `v` such that
 *  `providerId.startsWith(v + "-")` (so "claude-cli-sonnet" → CLAUDE_CLI, not a "claude"
 *  prefix; "anthropic-claude-sonnet-5" → ANTHROPIC). Unknown → undefined (heuristic). */
export function resolveProviderType(providerId: Opt<string, Reason.OptionalContext>): ProviderType | undefined {
  if (providerId === undefined) return undefined;
  const providerTypes = Object.values(ProviderType) as ProviderType[];
  if ((providerTypes as string[]).includes(providerId)) {
    return providerId as ProviderType;
  }
  let best: ProviderType | undefined;
  for (const providerType of providerTypes) {
    if (providerId.startsWith(`${providerType}-`) && (best === undefined || providerType.length > best.length)) {
      best = providerType;
    }
  }
  return best;
}

/** Shared analysis→complexity mapping (SIMPLE/MEDIUM/COMPLEX, EPIC→COMPLEX, absent→MEDIUM).
 *  TaskComplexityClassifier.mapAnalysisComplexity delegates here (no duplicate table). */
export function taskComplexityFromAnalysis(
  complexity: Opt<RequestAnalysisComplexity, Reason.OptionalInput>,
): TaskComplexity {
  switch (complexity) {
    case TaskComplexity.SIMPLE:
      return TaskComplexity.SIMPLE;
    case TaskComplexity.MEDIUM:
      return TaskComplexity.MEDIUM;
    case TaskComplexity.COMPLEX:
    case TaskComplexity.EPIC:
      return TaskComplexity.COMPLEX;
    default:
      return TaskComplexity.MEDIUM;
  }
}

/** Rank of an effort tier along EFFORT_TIER_ORDER; `undefined` ranks below "low". */
function effortRank(tier: Opt<EffortTier, Reason.OptionalContext>): number {
  return tier === undefined ? -1 : EFFORT_TIER_ORDER.indexOf(tier);
}

/** True only when all three hold: Anthropic provider, `thinking_default` not false, and
 *  the concrete model id matches a native-adaptive prefix. */
function isNativeAdaptiveThinking(signals: IEffortResolutionSignals): boolean {
  if (signals.providerType !== ProviderType.ANTHROPIC) return false;
  if (signals.anthropicThinkingDefault === false) return false;
  if (signals.model === undefined) return false;
  return NATIVE_ADAPTIVE_THINKING_MODEL_PREFIXES.some((prefix) => signals.model!.startsWith(prefix));
}

/** Picks the governing declaration and its source for one field, per the Constraints
 *  precedence rule: request ?? flowStep ?? role. */
function governingDeclaration(
  declarations: IEffortDeclarations,
  field: ResolutionField,
): { declaration: DeclarationValue; source: EffortDeclarationSource } {
  const pairs: Array<{ pair: IEffortDeclarationPair | undefined; source: EffortDeclarationSource }> = [
    { pair: declarations.request, source: SOURCE_REQUEST },
    { pair: declarations.flowStep, source: SOURCE_FLOW_STEP },
    { pair: declarations.role, source: SOURCE_ROLE },
  ];
  for (const { pair, source } of pairs) {
    const value = pair?.[field];
    if (value !== undefined) return { declaration: value, source };
  }
  return { declaration: undefined, source: SOURCE_NONE };
}

/** The precedence-highest surface that declared anything — journaled as declarationSource. */
function declaredSource(declarations: IEffortDeclarations): EffortDeclarationSource {
  if (declarations.request?.effort !== undefined || declarations.request?.thinking !== undefined) return SOURCE_REQUEST;
  if (declarations.flowStep?.effort !== undefined || declarations.flowStep?.thinking !== undefined) {
    return SOURCE_FLOW_STEP;
  }
  if (declarations.role?.effort !== undefined || declarations.role?.thinking !== undefined) return SOURCE_ROLE;
  return SOURCE_NONE;
}

/** Whether a floor skip applies to a field: the governing declaration was a concrete
 *  (non-auto) request-level value — Constraints rule 1. */
function floorSkipped(
  source: EffortDeclarationSource,
  declaration: DeclarationValue,
): boolean {
  return source === SOURCE_REQUEST && declaration !== undefined && declaration !== EFFORT_AUTO;
}

export class EffortResolver implements IEffortResolver {
  resolve(declarations: IEffortDeclarations, signals: IEffortResolutionSignals): IEffortResolution {
    const effortResult = this.resolveField(declarations, FIELD_EFFORT, signals);
    const thinkingResult = this.resolveField(declarations, FIELD_THINKING, signals);
    const floorsApplied = this.applyFloors(
      { effort: effortResult, thinking: thinkingResult },
      declarations,
      signals,
    );

    const heuristicUsed = effortResult.basis === BASIS_HEURISTIC || thinkingResult.basis === BASIS_HEURISTIC;

    return {
      effort: effortResult.value as EffortTier | undefined,
      thinking: thinkingResult.value as boolean | undefined,
      effortBasis: effortResult.basis,
      thinkingBasis: thinkingResult.basis,
      declarationSource: declaredSource(declarations),
      concreteDeclaration: effortResult.governingDeclaration.concrete,
      ...(heuristicUsed
        ? {
          heuristicInputs: {
            taskComplexity: signals.taskComplexity,
            complexitySource: signals.complexitySource,
            ...(signals.modelSize !== undefined ? { modelSize: signals.modelSize } : {}),
          },
        }
        : {}),
      floorsApplied,
    };
  }

  private resolveField(
    declarations: IEffortDeclarations,
    field: ResolutionField,
    signals: IEffortResolutionSignals,
  ): {
    value: FieldResolutionValue;
    basis: EffortResolutionBasis;
    governingDeclaration: { concrete: boolean };
  } {
    const { declaration } = governingDeclaration(declarations, field);

    if (field === FIELD_EFFORT) {
      if (declaration === undefined) {
        return { value: undefined, basis: BASIS_UNSET, governingDeclaration: { concrete: false } };
      }
      if (declaration !== EFFORT_AUTO) {
        return { value: declaration, basis: BASIS_DECLARED, governingDeclaration: { concrete: true } };
      }
      return {
        value: this.heuristicEffort(signals),
        basis: BASIS_HEURISTIC,
        governingDeclaration: { concrete: false },
      };
    }

    // thinking
    if (declaration === undefined) {
      return { value: undefined, basis: BASIS_UNSET, governingDeclaration: { concrete: false } };
    }
    if (typeof declaration === "boolean") {
      return { value: declaration, basis: BASIS_DECLARED, governingDeclaration: { concrete: true } };
    }
    // auto
    if (isNativeAdaptiveThinking(signals)) {
      return { value: undefined, basis: BASIS_NATIVE_ADAPTIVE, governingDeclaration: { concrete: false } };
    }
    const desired = THINKING_AUTO_HEURISTIC[signals.taskComplexity];
    const value = desired === true && signals.providerSupportsThinking ? true : undefined;
    return { value, basis: BASIS_HEURISTIC, governingDeclaration: { concrete: false } };
  }

  private heuristicEffort(signals: IEffortResolutionSignals): EffortTier {
    let value = EFFORT_AUTO_HEURISTIC[signals.taskComplexity];
    if (signals.modelSize === "S" && effortRank(value) > effortRank(EFFORT_AUTO_SMALL_MODEL_CAP)) {
      value = EFFORT_AUTO_SMALL_MODEL_CAP;
    }
    return value;
  }

  private applyFloors(
    resolved: {
      effort: { value: FieldResolutionValue; basis: EffortResolutionBasis };
      thinking: { value: FieldResolutionValue; basis: EffortResolutionBasis };
    },
    declarations: IEffortDeclarations,
    signals: IEffortResolutionSignals,
  ): string[] {
    const floorsApplied: string[] = [];
    for (const floor of signals.skillFloors) {
      const applyEffortFloor = !floorSkipped(
        govSource(declarations, FIELD_EFFORT),
        govValue(declarations, FIELD_EFFORT),
      );
      if (applyEffortFloor && floor.effort !== undefined) {
        const currentEffort = resolved.effort.value as EffortTier | undefined;
        if (effortRank(floor.effort) > effortRank(currentEffort)) {
          resolved.effort.value = floor.effort;
          resolved.effort.basis = BASIS_SKILL_FLOOR;
          floorsApplied.push(floor.skillId);
        }
      }
      const applyThinkingFloor = !floorSkipped(
        govSource(declarations, FIELD_THINKING),
        govValue(declarations, FIELD_THINKING),
      );
      if (applyThinkingFloor && floor.thinking === true && resolved.thinking.value !== true) {
        resolved.thinking.value = true;
        resolved.thinking.basis = BASIS_SKILL_FLOOR;
        if (!floorsApplied.includes(floor.skillId)) floorsApplied.push(floor.skillId);
      }
    }
    return floorsApplied;
  }
}

function govSource(
  declarations: IEffortDeclarations,
  field: ResolutionField,
): EffortDeclarationSource {
  return governingDeclaration(declarations, field).source;
}

function govValue(
  declarations: IEffortDeclarations,
  field: ResolutionField,
): DeclarationValue {
  return governingDeclaration(declarations, field).declaration;
}
