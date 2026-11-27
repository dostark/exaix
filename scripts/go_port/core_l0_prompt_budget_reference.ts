#!/usr/bin/env -S deno run -A
/**
 * @module GoPortCoreL0PromptBudgetReference
 * @path scripts/go_port/core_l0_prompt_budget_reference.ts
 * @description Builds differential prompt budget cases from the real PromptBudgetAllocator for the Go reference fixtures.
 * A deterministic registry supplies the context windows. Fallback windows are recorded as the resolved window of the case.
 * Usage: imported by scripts/go_port/core_l0_reference.ts.
 */
import { PromptBudgetAllocator } from "@exaix/core";
import { ContextBudgetExceededError } from "@exaix/core/errors";
import type { IAllocationHints } from "@exaix/core";
import {
  DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED,
  DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED,
  type IModelRegistry,
  LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK,
  TaskComplexity,
  TaskType,
} from "@exaix/core/types";
import { AnalysisMode } from "@exaix/core/request";
import { type IRequestAnalysis, RequestAnalysisSchema } from "@exaix/schemas/request_analysis.ts";

type TWindowSource = "registry" | "local_fallback" | "cloud_fallback";

type TWindowResolution = { tokens: number; source: TWindowSource };

/** What one case authors before the allocator runs. */
interface IBudgetSpec {
  readonly name: string;
  readonly model: string;
  readonly local: boolean;
  /** The window the deterministic registry returns. Zero means the registry knows no window. */
  readonly registryWindow: number;
  readonly policy: {
    readonly cloud?: boolean;
    readonly local?: boolean;
    readonly enabled?: boolean;
    readonly costTargetTokens?: number;
  };
  readonly hints?: IAllocationHints;
  readonly analysis?: { readonly taskType: TaskType; readonly referencedFiles: number };
}

interface IBudgetSections {
  readonly system: number;
  readonly plan: number;
  readonly portalKnowledge: number;
  readonly memory: number;
  readonly skills: number;
  readonly loopHistory: number;
}

const CLOUD_FALLBACK_WINDOW = 128_000;
const ANALYSIS_SCORE = 50;
const ANALYSIS_TIME = "2026-01-01T00:00:00.000Z";
const CLOUD_MODEL = "anthropic:model-a";
const LOCAL_MODEL = "ollama:model-b";
const WINDOWS_FOR_GRID: readonly number[] = [32_768, 100_001, 128_000, 1_000_000];
const GRID_TASKS: readonly (TaskType | null)[] = [
  null,
  TaskType.FEATURE,
  TaskType.REFACTOR,
  TaskType.ANALYSIS,
  TaskType.DOCS,
  TaskType.BUGFIX,
];
const GRID_FILE_COUNTS: readonly number[] = [0, 11];
const FULL_HINTS: IAllocationHints = {
  systemUsedTokens: 1200,
  planUsedTokens: 2500,
  portalKnowledgeUsedTokens: 800,
  memoryUsedTokens: 600,
  skillsUsedTokens: 400,
  loopHistoryUsedTokens: 300,
};
const EXACT_HINTS: IAllocationHints = {
  systemUsedTokens: 20_000,
  planUsedTokens: 35_000,
  portalKnowledgeUsedTokens: 20_000,
  memoryUsedTokens: 10_000,
  skillsUsedTokens: 10_000,
  loopHistoryUsedTokens: 5_000,
};

function unused(): Promise<never> {
  return Promise.reject(new Error("unused by the allocator"));
}

/** A registry with fixed windows. It implements the whole interface and fails any other call. */
class FixedRegistry implements IModelRegistry {
  constructor(private readonly windows: ReadonlyMap<string, number>) {}
  getContextWindow(provider: string, model: string): Promise<number> {
    return Promise.resolve(this.windows.get(`${provider}:${model}`) ?? 0);
  }
  getModelsByCapability(): Promise<never> {
    return unused();
  }
  getModelCapability(): Promise<never> {
    return unused();
  }
  getProviderModels(): Promise<never> {
    return unused();
  }
  getAllProviders(): Promise<never> {
    return unused();
  }
  getModelCost(): Promise<never> {
    return unused();
  }
  recordLatency(): Promise<never> {
    return unused();
  }
  getLatencyStats(): Promise<never> {
    return unused();
  }
  rankByLatency(): Promise<never> {
    return unused();
  }
  recordCall(): Promise<never> {
    return unused();
  }
  getRateLimit(): Promise<never> {
    return unused();
  }
  getProviderHealth(): Promise<never> {
    return unused();
  }
  getModelPricing(): Promise<never> {
    return unused();
  }
}

function handCases(): IBudgetSpec[] {
  const cloud = (name: string, rest: Partial<IBudgetSpec>): IBudgetSpec => ({
    name,
    model: CLOUD_MODEL,
    local: false,
    registryWindow: 200_000,
    policy: {},
    ...rest,
  });
  const local = (name: string, rest: Partial<IBudgetSpec>): IBudgetSpec => ({
    name,
    model: LOCAL_MODEL,
    local: true,
    registryWindow: 65_536,
    policy: {},
    ...rest,
  });
  return [
    cloud("cloud-default-no-hints", {}),
    cloud("cloud-all-hints", { hints: FULL_HINTS }),
    cloud("cloud-memory-hint-only", { hints: { memoryUsedTokens: 5000 } }),
    cloud("cloud-explicit-zero-hint", { hints: { memoryUsedTokens: 0, skillsUsedTokens: 300 } }),
    local("local-default", {}),
    local("local-fallback-window", { registryWindow: 0 }),
    cloud("cloud-fallback-window", { registryWindow: 0 }),
    cloud("cost-target-below-window", { policy: { costTargetTokens: 50_000 } }),
    cloud("cost-target-above-window", { policy: { costTargetTokens: 500_000 } }),
    cloud("cost-target-equals-window", { policy: { costTargetTokens: 200_000 } }),
    cloud("cloud-enforcement-off", { policy: { cloud: false } }),
    local("local-enforcement-off", { policy: { local: false } }),
    cloud("explicit-disabled", { policy: { enabled: false } }),
    cloud("explicit-disabled-with-cost-target", { policy: { enabled: false, costTargetTokens: 40_000 } }),
    local("explicit-enabled-over-local-off", { policy: { local: false, enabled: true } }),
    cloud("explicit-enabled-over-cloud-off", { policy: { cloud: false, enabled: true } }),
    cloud("feature-task", { analysis: { taskType: TaskType.FEATURE, referencedFiles: 2 } }),
    cloud("refactor-task", { analysis: { taskType: TaskType.REFACTOR, referencedFiles: 0 } }),
    cloud("analysis-task", { analysis: { taskType: TaskType.ANALYSIS, referencedFiles: 0 } }),
    cloud("docs-task", { analysis: { taskType: TaskType.DOCS, referencedFiles: 0 } }),
    cloud("bugfix-task-unchanged", { analysis: { taskType: TaskType.BUGFIX, referencedFiles: 3 } }),
    cloud("files-at-threshold", { analysis: { taskType: TaskType.BUGFIX, referencedFiles: 10 } }),
    cloud("files-above-threshold", { analysis: { taskType: TaskType.BUGFIX, referencedFiles: 11 } }),
    cloud("feature-with-many-files", { analysis: { taskType: TaskType.FEATURE, referencedFiles: 25 } }),
    cloud("docs-with-many-files-and-hints", {
      hints: FULL_HINTS,
      analysis: { taskType: TaskType.DOCS, referencedFiles: 12 },
    }),
    cloud("hints-equal-the-window", { registryWindow: 100_000, hints: EXACT_HINTS }),
    cloud("hints-one-over-the-window", {
      registryWindow: 100_000,
      hints: { ...EXACT_HINTS, loopHistoryUsedTokens: 5001 },
    }),
    cloud("window-too-small-for-the-floors", { registryWindow: 3000 }),
    cloud("tiny-window-with-hints", { registryWindow: 500, hints: { memoryUsedTokens: 10 } }),
    local("local-fallback-with-feature-task", {
      registryWindow: 0,
      analysis: { taskType: TaskType.FEATURE, referencedFiles: 0 },
    }),
  ];
}

function gridCases(): IBudgetSpec[] {
  const specs: IBudgetSpec[] = [];
  for (const window of WINDOWS_FOR_GRID) {
    for (const task of GRID_TASKS) {
      for (const files of GRID_FILE_COUNTS) {
        for (const hinted of [false, true]) {
          const hintName = hinted ? "hints" : "no-hints";
          specs.push({
            name: `grid-${window}-${task ?? "none"}-${files}-files-${hintName}`,
            model: CLOUD_MODEL,
            local: false,
            registryWindow: window,
            policy: {},
            ...(hinted ? { hints: FULL_HINTS } : {}),
            ...(task === null ? {} : { analysis: { taskType: task, referencedFiles: files } }),
          });
        }
      }
    }
  }
  return specs;
}

function sectionsOf(sections: IBudgetSections): IBudgetSections {
  return {
    system: sections.system,
    plan: sections.plan,
    portalKnowledge: sections.portalKnowledge,
    memory: sections.memory,
    skills: sections.skills,
    loopHistory: sections.loopHistory,
  };
}

/** Builds a valid analysis through the pinned schema. The allocator reads only the task type and the file list. */
function analysisOf(authored: { readonly taskType: TaskType; readonly referencedFiles: number }): IRequestAnalysis {
  return RequestAnalysisSchema.parse({
    goals: [],
    requirements: [],
    constraints: [],
    acceptanceCriteria: [],
    ambiguities: [],
    actionabilityScore: ANALYSIS_SCORE,
    complexity: TaskComplexity.MEDIUM,
    taskType: authored.taskType,
    tags: [],
    referencedFiles: Array.from({ length: authored.referencedFiles }, (_, index) => `file-${index}.ts`),
    metadata: { analyzedAt: ANALYSIS_TIME, durationMs: 0, mode: AnalysisMode.HEURISTIC },
  });
}

function resolvedWindow(spec: IBudgetSpec): TWindowResolution {
  if (spec.registryWindow > 0) return { tokens: spec.registryWindow, source: "registry" };
  return spec.local
    ? { tokens: LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK, source: "local_fallback" }
    : { tokens: CLOUD_FALLBACK_WINDOW, source: "cloud_fallback" };
}

async function recordCase(spec: IBudgetSpec): Promise<object> {
  const registry = new FixedRegistry(new Map([[spec.model, spec.registryWindow]]));
  const allocator = new PromptBudgetAllocator(spec.policy, undefined, undefined, registry);
  const analysis = spec.analysis === undefined ? undefined : analysisOf(spec.analysis);
  const window = resolvedWindow(spec);
  let expected: object;
  try {
    const budget = await allocator.allocate(spec.model, spec.hints, analysis);
    expected = {
      ok: true,
      budget: {
        model: budget.model,
        totalBudgetTokens: budget.totalBudgetTokens,
        safetyBufferTokens: budget.safetyBufferTokens,
        sections: sectionsOf(budget.sections),
      },
    };
  } catch (error) {
    if (!(error instanceof ContextBudgetExceededError)) throw error;
    expected = {
      ok: false,
      error: {
        message: error.message,
        model: error.model,
        contextWindow: error.contextWindow,
        estimatedTokens: error.estimatedTokens,
        sectionBreakdown: sectionsOf({
          system: error.sectionBreakdown.system,
          plan: error.sectionBreakdown.plan,
          portalKnowledge: error.sectionBreakdown.portalKnowledge,
          memory: error.sectionBreakdown.memory,
          skills: error.sectionBreakdown.skills,
          loopHistory: error.sectionBreakdown.loopHistory,
        }),
      },
    };
  }
  return {
    name: spec.name,
    model: spec.model,
    input: {
      context_window_tokens: window.tokens,
      window_source: window.source,
      local: spec.local,
      policy: {
        cloud: spec.policy.cloud ?? DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED,
        local: spec.policy.local ?? DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED,
        enabled: spec.policy.enabled ?? null,
        cost_target_tokens: spec.policy.costTargetTokens ?? null,
      },
      hints: {
        system_used_tokens: spec.hints?.systemUsedTokens ?? 0,
        plan_used_tokens: spec.hints?.planUsedTokens ?? 0,
        portal_knowledge_used_tokens: spec.hints?.portalKnowledgeUsedTokens ?? 0,
        memory_used_tokens: spec.hints?.memoryUsedTokens ?? 0,
        skills_used_tokens: spec.hints?.skillsUsedTokens ?? 0,
        loop_history_used_tokens: spec.hints?.loopHistoryUsedTokens ?? 0,
      },
      task_type: spec.analysis?.taskType ?? "",
      referenced_files: spec.analysis?.referencedFiles ?? 0,
    },
    expected,
  };
}

/** Values near a rounding tie or a binary boundary, plus the quotients that the weight normalization produces. */
const TO_FIXED_INPUTS: readonly number[] = [
  0.03125,
  0.00015,
  0.00035,
  0.00045,
  0.00065,
  0.00085,
  0.00105,
  0.00005,
  1.00005,
  0.99995,
  0.12345,
  0.15625,
  0.5,
  1 / 3,
  2 / 3,
  0.2 / 0.95,
  0.35 / 0.95,
  0.1 / 0.95,
  0.05 / 0.95,
  0.25 / 0.95,
  0.15 / 0.95,
];
const WEIGHT_PRECISION = 4;

/** Records every authored case against the real allocator, and the weight rounding of the runtime. */
export async function buildPromptBudgetFixture(): Promise<object> {
  const specs = [...handCases(), ...gridCases()];
  const cases: object[] = [];
  for (const spec of specs) cases.push(await recordCase(spec));
  const toFixed = TO_FIXED_INPUTS.map((input) => ({ input, output: +input.toFixed(WEIGHT_PRECISION) }));
  return { cases, to_fixed: toFixed };
}
