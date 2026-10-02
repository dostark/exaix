/**
 * @module ScenarioFrameworkJudgeBindings
 * @path tests/scenario_framework/runner/judge_bindings.ts
 * @description Phase 203 Step 3 — resolves one binding per scenario judge step. A judge is a
 *   step that owns at least one `llm-judge` criterion, not a step whose `type` is `judge`:
 *   nine shipped `type: judge` steps carry no judge criterion, and eleven others carry the
 *   criterion on a `json-assert` or `run-script` step.
 *
 *   The judge resolves against the same layer stack a flow step uses, because the runner
 *   already wrote the scenario, cell, step and operator overlays and the sandbox config holds
 *   the config layer and the daemon overlays. A judge therefore cannot silently inherit the
 *   system under test's binding: a `judge` ref matches judge selectors only.
 *
 *   Resolution runs in the runner's process, so it emits no daemon event. The evidence file is
 *   the record. A judge that resolves to the same service and model as the system under test is
 *   allowed, because the judge may be under test, and is flagged `judgeSharesSut`.
 * @architectural-layer Test
 * @dependencies [@exaix/ai, @exaix/schemas]
 * @related-files [tests/scenario_framework/runner/assertions.ts, tests/scenario_framework/runner/binding_layers.ts]
 */

import {
  BindingIncompatibleError,
  type IBindingEnvProbe,
  loadBindingLayers,
  resolveBinding,
  STEP_KIND_JUDGE,
} from "@exaix/ai";
import { validateBinding } from "@exaix/ai/bindings/binding_validation.ts";
import type { IBindingIssue, IBindingStepRef, IResolvedBinding, IRunBindingsFile } from "@exaix/schemas";
import type { Config } from "@exaix/schemas";
import { CriterionKind, type IScenarioStep } from "../schema/step_schema.ts";

/** One judge step's resolved binding, ready to construct a provider. */
export interface IResolvedJudgeBinding {
  stepId: string;
  ref: IBindingStepRef;
  binding: IResolvedBinding;
}

/** What the system under test ran on, for the judgeSharesSut flag. */
export interface IJudgeSutContext {
  /** The service and canonical model of every step the daemon bound, from the run's lockfiles. */
  boundSteps: ReadonlyArray<{ service?: string; model?: string }>;
  /** The config's `[ai].provider`: an adapter name, compared with the judge's adapter. */
  aiProvider?: string;
  /** The config's `[ai].model`: a wire model id, compared with the judge's service model id. */
  aiModel?: string;
}

/** A judge step whose binding did not resolve. That step keeps the environment path. */
export interface IJudgeBindingIssue {
  stepId: string;
  code: IBindingIssue["code"];
  detail: string;
}

/** The judge bindings one scenario run resolved. */
export interface IJudgeBindingPlan {
  bindings: Map<string, IResolvedJudgeBinding>;
  issues: IJudgeBindingIssue[];
}

/** Everything judge resolution needs. */
export interface IResolveJudgeBindingsInput {
  /** The scenario id, used as the ref's flowId. */
  scenarioId: string;
  /** The scenario's candidate steps, before matrix-cell scoping. */
  steps: readonly IScenarioStep[];
  /** The sandbox config: it carries the config layer, the daemon overlays and the built-ins. */
  config: Config;
  /** The run's binding file, as the runner wrote it for this run. */
  runFile: IRunBindingsFile;
  /** The run's effective environment, for the credential and opt-in probe. */
  env: Record<string, string | undefined>;
}

/** The judge role a ref carries when its step names no agent role. A judge ref never
 *  matches a `role:` selector, so this value is documentary. */
const DEFAULT_JUDGE_ROLE = "judge";

/** True when the step owns at least one `llm-judge` criterion, so a judge grades it.
 *  This is the only judge predicate: `type: "judge"` alone proves nothing. */
export function isJudgeBearingStep(step: IScenarioStep): boolean {
  return [...step.input_criteria, ...step.output_criteria].some(
    (criterion) => criterion.kind === CriterionKind.LLM_JUDGE,
  );
}

/** The binding ref for one judge step. The scenario id is the flowId. The judge step id
 *  is both the stepId and the judgeId, so `judge:<stepId>` names this judge exactly. */
export function buildJudgeStepRef(scenarioId: string, step: IScenarioStep): IBindingStepRef {
  return {
    flowId: scenarioId,
    stepId: step.id,
    agentRole: DEFAULT_JUDGE_ROLE,
    kind: STEP_KIND_JUDGE,
    judgeId: step.id,
    nativeTools: false,
  };
}

/** Build the environment probe over the catalog's credential and opt-in variables.
 *  The runner holds no credential store, so only the run's own environment answers. */
function buildJudgeEnvProbe(
  layers: Awaited<ReturnType<typeof loadBindingLayers>>,
  env: IResolveJudgeBindingsInput["env"],
): IBindingEnvProbe {
  const hasKey = new Map<string, boolean>();
  const hasOptIn = new Map<string, boolean>();
  for (const service of Object.values(layers.catalog.services)) {
    if (service.key_env && !hasKey.has(service.key_env)) {
      const value = env[service.key_env];
      hasKey.set(service.key_env, value !== undefined && value.length > 0);
    }
    if (service.requires_optin && !hasOptIn.has(service.requires_optin)) {
      hasOptIn.set(service.requires_optin, env[service.requires_optin] === "1");
    }
  }
  return {
    hasKey: (name: string): boolean => hasKey.get(name) === true,
    hasOptIn: (name: string): boolean => hasOptIn.get(name) === true,
  };
}

/**
 * Resolve one binding per judge-bearing step from this run's layer stack.
 *
 * A step whose binding does not resolve yields an issue instead of a binding.
 * That step keeps the documented environment path, so the run is not failed.
 */
export async function resolveJudgeBindings(
  input: IResolveJudgeBindingsInput,
): Promise<IJudgeBindingPlan> {
  const bindings = new Map<string, IResolvedJudgeBinding>();
  const issues: IJudgeBindingIssue[] = [];

  const judgeSteps = input.steps.filter(isJudgeBearingStep);
  if (judgeSteps.length === 0) return { bindings, issues };

  const layers = await loadBindingLayers(input.config, input.runFile);
  const probe = buildJudgeEnvProbe(layers, input.env);

  for (const step of judgeSteps) {
    const ref = buildJudgeStepRef(input.scenarioId, step);
    const outcome = resolveBinding(ref, {}, layers, probe);
    if (outcome.kind === "invalid") {
      for (const issue of outcome.issues) {
        issues.push({ stepId: step.id, code: issue.code, detail: issue.detail });
      }
      continue;
    }
    if (outcome.kind !== "bound") continue;
    const invalid = await validateBinding(ref, {
      binding: outcome.binding,
      service: layers.catalog.services[outcome.binding.service],
      catalogModel: layers.catalog.models[outcome.binding.model],
      probe,
      allowNet: input.config.system?.allow_net,
    });
    if (invalid.length > 0) {
      for (const issue of invalid) issues.push({ stepId: step.id, code: issue.code, detail: issue.detail });
      continue;
    }
    bindings.set(step.id, { stepId: step.id, ref, binding: outcome.binding });
  }

  return { bindings, issues };
}

/**
 * True when a judge grades with the same service and model as the system under test.
 * Bound steps are compared in catalog terms. With no bound step, the config's adapter and wire model are compared.
 */
export function judgeSharesSut(judge: IResolvedBinding, sut: IJudgeSutContext): boolean {
  if (sut.boundSteps.length > 0) {
    return sut.boundSteps.some((step) => step.service === judge.service && step.model === judge.model);
  }
  return sut.aiProvider === judge.adapter && sut.aiModel === judge.service_model_id;
}

/** Refuse the run when a judge binding exists but did not resolve or validate.
 *  A named judge must never be swapped silently for the environment's judge. */
export function assertJudgeBindingsResolved(plan: IJudgeBindingPlan): void {
  if (plan.issues.length === 0) return;
  throw new BindingIncompatibleError(plan.issues.map((issue) => ({
    code: issue.code,
    selector: `judge:${issue.stepId}`,
    stepId: issue.stepId,
    detail: issue.detail,
  })));
}
