/**
 * @module BindingResolver
 * @path packages/ai/src/bindings/binding_resolver.ts
 * @description Pure resolver implementing the full binding selector grammar.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @std/crypto]
 * @related-files [packages/ai/src/bindings/model_binding_service.ts, packages/model-registry/src/binding_catalog.ts]
 */

import { crypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import {
  type BindingField,
  type BindingLayer,
  type BindingOutcome,
  EFFORT_AUTO,
  getDefaultModels,
  type IBindingFieldSource,
  type IBindingIssue,
  type IBindingLayers,
  type IBindingSpec,
  type IBindingStepRef,
  type ICatalogModel,
  type ICatalogService,
  type IResolvedBinding,
  type IStepPin,
  ModelCapabilitySchema,
} from "@exaix/schemas";
import { OPENAI_COMPATIBLE_SELF_HOSTED_PROFILE } from "@exaix/core";
import type { IBindingEnvProbe } from "./binding_types.ts";
import { BINDING_OUTCOME_INVALID, BINDING_OUTCOME_UNBOUND, STEP_KIND_GATE, STEP_KIND_JUDGE } from "./binding_types.ts";
import { LAYER_FLOW } from "./binding_layers.ts";

export interface IInvalidBindingOutcome {
  kind: typeof BINDING_OUTCOME_INVALID;
  issues: IBindingIssue[];
}

export const SELECTOR_DEFAULT = "default";
const FALLBACK_LAYER: BindingLayer = "config";
export const ISSUE_UNKNOWN_MODEL: IBindingIssue["code"] = "unknown_model";
export const ISSUE_INTERFACE_UNSUPPORTED: IBindingIssue["code"] = "interface_unsupported";
export const ISSUE_CAPABILITY_MISSING: IBindingIssue["code"] = "capability_missing";
export const ISSUE_KEY_MISSING: IBindingIssue["code"] = "key_missing";
export const ISSUE_OPTIN_MISSING: IBindingIssue["code"] = "optin_missing";
export const ISSUE_ENDPOINT_INVALID: IBindingIssue["code"] = "endpoint_invalid";
export const ISSUE_HOST_NOT_ALLOWED: IBindingIssue["code"] = "host_not_allowed";
export const ISSUE_NEEDS_RESTART: IBindingIssue["code"] = "needs_restart";
export const ISSUE_LOCAL_HOST_NOT_PRIVATE: IBindingIssue["code"] = "local_host_not_private";
export const ISSUE_PRICING_UNAVAILABLE: IBindingIssue["code"] = "pricing_unavailable";
export const ISSUE_LOCK_MISMATCH: IBindingIssue["code"] = "lock_mismatch";
const FLOW_PREFIX = "flow:";
const ROLE_PREFIX = "role:";
const STEP_SEPARATOR = "/step:";
/** The bare judge selector: any scenario judge. */
const SELECTOR_JUDGE = "judge";
/** The judge selector prefix: `judge:<id>` names one judge. */
const JUDGE_PREFIX = "judge:";

/** True when a selector names a judge. A judge ref matches judge selectors only, so it
 *  competes with no agent-step selector. */
export function isJudgeSelector(selector: string): boolean {
  return selector === SELECTOR_JUDGE || selector.startsWith(JUDGE_PREFIX);
}
/** Specificity of the bare `judge` selector. It outranks `default` and nothing else. */
const JUDGE_SPECIFICITY = 5;
/** Specificity of `judge:<id>`. It outranks `judge` and every flow-step selector.
 *  A judge selector only ever competes with another judge selector, so these two
 *  ranks need only their documented order. */
const JUDGE_ID_SPECIFICITY = 6;

const LAYER_RANK: Record<IBindingLayers["entries"][number]["layer"], number> = {
  flow: 0,
  config: 1,
  overlay: 2,
  run: 3,
  cli: 4,
};

function issue(code: IBindingIssue["code"], ref: IBindingStepRef, detail: string): IInvalidBindingOutcome {
  return { kind: BINDING_OUTCOME_INVALID, issues: [{ code, flowId: ref.flowId, stepId: ref.stepId, detail }] };
}

interface IMatchRank {
  layerRank: number;
  specificity: number;
  prefixLen: number;
}

interface IMatchingEntry {
  entry: IBindingLayers["entries"][number]["spec"];
  layer: IBindingLayers["entries"][number]["layer"];
  selector: string;
  rank: IMatchRank;
}

/** Wildcard glob, anchored to the full string. */
function globMatch(pattern: string, value: string): boolean {
  const parts = pattern.split("*");
  let cursor = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === "") continue;
    if (index === 0 && !value.startsWith(part)) return false;
    if (index === parts.length - 1 && !value.endsWith(part)) return false;
    const found = value.indexOf(part, cursor);
    if (found === -1) return false;
    cursor = found + part.length;
  }
  return true;
}

/** Specificity classes: default(0) < flow:(1) < role:(2) < step-glob(3) < step-exact(4)
 *  < judge(5) < judge:<id>(6). The last two are reachable only for a judge ref.
 *  Exported so the runner's pin rule and this resolver share one definition. */
export function selectorSpecificity(selector: string): number {
  if (selector === SELECTOR_DEFAULT) return 0;
  if (isJudgeSelector(selector)) return selector === SELECTOR_JUDGE ? JUDGE_SPECIFICITY : JUDGE_ID_SPECIFICITY;
  if (selector.startsWith(ROLE_PREFIX)) return 2;
  if (!selector.startsWith(FLOW_PREFIX)) return -1;
  const stepIndex = selector.indexOf(STEP_SEPARATOR);
  if (stepIndex === -1) return 1;
  return selector.includes("*", stepIndex + STEP_SEPARATOR.length) ? 3 : 4;
}

/** True when some string can match both globs. Two globs overlap unless their literal
 *  prefixes or suffixes conflict, so an uncertain case counts as overlapping. */
function globsCanOverlap(left: string, right: string): boolean {
  const leftGlob = left.includes("*");
  const rightGlob = right.includes("*");
  if (!leftGlob && !rightGlob) return left === right;
  if (!leftGlob) return globMatch(right, left);
  if (!rightGlob) return globMatch(left, right);
  const leftPrefix = left.slice(0, left.indexOf("*"));
  const rightPrefix = right.slice(0, right.indexOf("*"));
  const leftSuffix = left.slice(left.lastIndexOf("*") + 1);
  const rightSuffix = right.slice(right.lastIndexOf("*") + 1);
  const prefixesAgree = leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix);
  const suffixesAgree = leftSuffix.endsWith(rightSuffix) || rightSuffix.endsWith(leftSuffix);
  return prefixesAgree && suffixesAgree;
}

/** Splits a `flow:` selector into its flow glob and its optional step glob. */
function flowSelectorParts(selector: string): { flow: string; step?: string } {
  const body = selector.slice(FLOW_PREFIX.length);
  const stepIndex = body.indexOf(STEP_SEPARATOR);
  if (stepIndex === -1) return { flow: body };
  return { flow: body.slice(0, stepIndex), step: body.slice(stepIndex + STEP_SEPARATOR.length) };
}

/** True when two `flow:` selectors can name one step. Their flows must overlap, and their steps when both name one. */
function flowSelectorsCanOverlap(left: string, right: string): boolean {
  const leftParts = flowSelectorParts(left);
  const rightParts = flowSelectorParts(right);
  if (!globsCanOverlap(leftParts.flow, rightParts.flow)) return false;
  if (leftParts.step === undefined || rightParts.step === undefined) return true;
  return globsCanOverlap(leftParts.step, rightParts.step);
}

/** True when two agent selectors can name one step. A `role:` selector may meet any `flow:` selector. */
function agentSelectorsCanOverlap(left: string, right: string): boolean {
  if (left === SELECTOR_DEFAULT || right === SELECTOR_DEFAULT) return true;
  const leftRole = left.startsWith(ROLE_PREFIX);
  const rightRole = right.startsWith(ROLE_PREFIX);
  if (leftRole && rightRole) return left === right;
  if (leftRole || rightRole) return true;
  if (!left.startsWith(FLOW_PREFIX) || !right.startsWith(FLOW_PREFIX)) return true;
  return flowSelectorsCanOverlap(left, right);
}

/**
 * True when one step could be matched by both selectors, so a binding at one can defeat the other.
 * Exported so the runner's pin rule decides overlap with the resolver's own selector semantics.
 */
export function selectorsCanOverlap(left: string, right: string): boolean {
  const leftJudge = isJudgeSelector(left);
  if (leftJudge !== isJudgeSelector(right)) return false;
  if (leftJudge) return left === SELECTOR_JUDGE || right === SELECTOR_JUDGE || left === right;
  return agentSelectorsCanOverlap(left, right);
}

/** Characters before the first glob, used as the ambiguity and ordering tie-break. */
function literalPrefixLen(selector: string): number {
  const star = selector.indexOf("*");
  return star === -1 ? selector.length : star;
}

function rankFor(layer: IBindingLayers["entries"][number]["layer"], selector: string): IMatchRank {
  return {
    layerRank: LAYER_RANK[layer],
    specificity: selectorSpecificity(selector),
    prefixLen: literalPrefixLen(selector),
  };
}

/** True when a selector binds this step. The branch follows the ref kind.
 *  A scenario judge matches judge selectors only, so it never inherits `default`,
 *  `role:` or `flow:`. Judge selectors never match a flow step, gate included. */
function selectorMatches(ref: IBindingStepRef, selector: string): boolean {
  if (ref.kind === STEP_KIND_JUDGE) return judgeSelectorMatches(ref, selector);
  if (selector === SELECTOR_DEFAULT) return true;
  if (isJudgeSelector(selector)) return false;
  if (selector.startsWith(ROLE_PREFIX)) return ref.agentRole === selector.slice(ROLE_PREFIX.length);
  if (selector.startsWith(FLOW_PREFIX)) {
    const body = selector.slice(FLOW_PREFIX.length);
    const stepIndex = body.indexOf(STEP_SEPARATOR);
    if (stepIndex === -1) return globMatch(body, ref.flowId);
    const flowGlob = body.slice(0, stepIndex);
    const stepGlob = body.slice(stepIndex + STEP_SEPARATOR.length);
    return globMatch(flowGlob, ref.flowId) && globMatch(stepGlob, ref.stepId);
  }
  return false;
}

/** True when a judge selector names this judge: the bare `judge`, or its own `judge:<id>`. */
function judgeSelectorMatches(ref: IBindingStepRef, selector: string): boolean {
  if (selector === SELECTOR_JUDGE) return true;
  if (!selector.startsWith(JUDGE_PREFIX)) return false;
  return ref.judgeId !== undefined && selector.slice(JUDGE_PREFIX.length) === ref.judgeId;
}

function compareRanks(a: IMatchRank, b: IMatchRank): number {
  return a.layerRank - b.layerRank || a.specificity - b.specificity || a.prefixLen - b.prefixLen;
}

function sameRank(a: IMatchRank, b: IMatchRank): boolean {
  return compareRanks(a, b) === 0;
}

/** Exact selector for a step, used as the flow-layer entry's selector and to test pin
 *  exactness. A flow step uses `flow:<flowId>/step:<stepId>`. A scenario judge uses
 *  `judge:<judgeId>`, or the bare `judge` when it carries no id. */
function exactStepSelector(ref: IBindingStepRef): string {
  if (ref.kind === STEP_KIND_JUDGE) {
    return ref.judgeId !== undefined ? `${JUDGE_PREFIX}${ref.judgeId}` : SELECTOR_JUDGE;
  }
  return `flow:${ref.flowId}/step:${ref.stepId}`;
}

/** Collect matching entries and merge per field. A later entry wins a field. Equal-specificity globs are ambiguous when literal prefixes tie. */
function mergeEntries(
  ref: IBindingStepRef,
  layers: IBindingLayers,
  step: { binding?: IBindingSpec; pin?: IStepPin } = {},
): { spec: IBindingSpec; sources: IResolvedBinding["sources"] } | IInvalidBindingOutcome {
  const matched: IMatchingEntry[] = [];
  // The step's own `binding:` enters at the flow layer with the step's exact selector.
  // It is the lowest layer, so operator layers above it may override its fields.
  // Pins then guard the flow author's chosen fields.
  if (step.binding) {
    matched.push({
      entry: step.binding,
      layer: LAYER_FLOW,
      selector: exactStepSelector(ref),
      rank: rankFor(LAYER_FLOW, exactStepSelector(ref)),
    });
  }
  for (const entry of layers.entries) {
    if (!selectorMatches(ref, entry.selector)) continue;
    matched.push({
      entry: entry.spec,
      layer: entry.layer,
      selector: entry.selector,
      rank: rankFor(entry.layer, entry.selector),
    });
  }
  if (matched.length === 0) return { spec: {}, sources: {} };
  matched.sort((a, b) => compareRanks(a.rank, b.rank));

  const spec: IBindingSpec = {};
  const sources: IResolvedBinding["sources"] = {};
  const winners = new Map<
    BindingField,
    { rank: IMatchRank; value: IBindingSpec[BindingField]; layer: string; selector: string }
  >();

  for (const match of matched) {
    for (const [rawField, value] of Object.entries(match.entry) as Array<[BindingField, IBindingSpec[BindingField]]>) {
      if (value === undefined) continue;
      const winner = winners.get(rawField);
      if (!winner) {
        winners.set(rawField, { rank: match.rank, value, layer: match.layer, selector: match.selector });
        Object.assign(spec, { [rawField]: value });
        sources[rawField] = { layer: match.layer, selector: match.selector };
        continue;
      }
      if (sameRank(winner.rank, match.rank)) {
        if (winner.value !== value) {
          return issue(
            "ambiguous_selector",
            ref,
            `${winner.selector} and ${match.selector} both match ${ref.flowId}/${ref.stepId} and set ${rawField} differently`,
          );
        }
        continue;
      }
      if (compareRanks(match.rank, winner.rank) > 0) {
        winners.set(rawField, { rank: match.rank, value, layer: match.layer, selector: match.selector });
        Object.assign(spec, { [rawField]: value });
        sources[rawField] = { layer: match.layer, selector: match.selector };
      }
    }
  }

  // Pin rule (Resolution algorithm step 4).
  // A field the flow author pinned may only be changed by an exact higher-layer entry.
  // A broader entry is skipped, the flow value wins, and sources record pin_kept.
  // Equal values pass silently.
  const pinIssue = applyPins(ref, step, winners, spec, sources);
  if (pinIssue) return pinIssue;

  return { spec, sources };
}

/** Apply the pin rule to the merged winners. Returns a pinned issue when an exact
 *  higher-layer entry changes a pinned field, else mutates the flow value back. */
function applyPins(
  ref: IBindingStepRef,
  step: { binding?: IBindingSpec; pin?: IStepPin },
  winners: Map<
    BindingField,
    { rank: IMatchRank; value: IBindingSpec[BindingField]; layer: string; selector: string }
  >,
  spec: IBindingSpec,
  sources: IResolvedBinding["sources"],
): IInvalidBindingOutcome | undefined {
  if (!step.pin || !step.binding) return undefined;
  for (const field of step.pin.fields) {
    const winner = winners.get(field);
    if (!winner) continue;
    const flowValue = step.binding[field];
    if (winner.layer === LAYER_FLOW || winner.value === flowValue) continue;
    const exact = winner.layer !== LAYER_FLOW && isExactStepEntryRef(winner.selector, ref);
    if (exact) {
      return {
        kind: BINDING_OUTCOME_INVALID,
        issues: [{
          code: "pinned",
          flowId: ref.flowId,
          stepId: ref.stepId,
          selector: winner.selector,
          detail: `field "${field}" of ${ref.flowId}/${ref.stepId} is pinned (${step.pin.reason}); ` +
            `${winner.selector} from the ${winner.layer} layer attempted to change it`,
        }],
      };
    }
    // Broader override: keep the flow value and record pin_kept.
    winners.set(field, {
      rank: rankFor(LAYER_FLOW, exactStepSelector(ref)),
      value: flowValue,
      layer: LAYER_FLOW,
      selector: exactStepSelector(ref),
    });
    Object.assign(spec, { [field]: flowValue });
    sources[field] = {
      layer: LAYER_FLOW,
      selector: exactStepSelector(ref),
      pin_kept: { skipped_selector: winner.selector, skipped_layer: winner.layer as BindingLayer },
    };
  }
  return undefined;
}

/** True when a non-flow-layer entry uses this step's exact selector. */
function isExactStepEntryRef(selector: string, ref: IBindingStepRef): boolean {
  return selector === exactStepSelector(ref);
}

interface IModelState {
  canonical: string;
  provider: string;
  catalogModel?: ICatalogModel;
}

/** Resolve the canonical model and its provider from the merged spec. */
function resolveModel(
  ref: IBindingStepRef,
  spec: IBindingSpec,
  layers: IBindingLayers,
): IModelState | IInvalidBindingOutcome | { kind: typeof BINDING_OUTCOME_UNBOUND } {
  if (spec.model) {
    const catalogModel = layers.catalog.models[spec.model];
    if (!catalogModel) return issue(ISSUE_UNKNOWN_MODEL, ref, `Unknown canonical model: ${spec.model}`);
    if (spec.model_provider && catalogModel.model_provider !== spec.model_provider) {
      return issue(ISSUE_UNKNOWN_MODEL, ref, `Model provider mismatch: ${spec.model_provider}`);
    }
    return { canonical: spec.model, provider: catalogModel.model_provider, catalogModel };
  }
  if (spec.model_provider) {
    const canonical = `${spec.model_provider}/${getDefaultModels()[spec.model_provider] ?? ""}`;
    const catalogModel = layers.catalog.models[canonical];
    if (!catalogModel) {
      return issue(ISSUE_UNKNOWN_MODEL, ref, `No registered default canonical model for ${spec.model_provider}`);
    }
    return { canonical, provider: spec.model_provider, catalogModel };
  }
  if (spec.transport || spec.interface) {
    const canonical = layers.configDefaultModel;
    const catalogModel = canonical ? layers.catalog.models[canonical] : undefined;
    if (!canonical || !catalogModel) {
      return issue(ISSUE_UNKNOWN_MODEL, ref, "No config.ai default canonical model in catalog");
    }
    return { canonical, provider: catalogModel.model_provider, catalogModel };
  }
  if (spec.service_model_id) {
    if (!spec.service) {
      return issue("unknown_service", ref, "service_model_id without model requires an explicit service");
    }
    return { canonical: `${spec.service}/${spec.service_model_id}`, provider: spec.model_provider ?? spec.service };
  }
  if (spec.service) return issue(ISSUE_UNKNOWN_MODEL, ref, "A service binding requires model or service_model_id");
  return { kind: BINDING_OUTCOME_UNBOUND };
}

/** Substitutes the {model}/{name} placeholders of a wildcard serves route. */
function substituteTemplate(template: string, canonical: string): string {
  return template.replaceAll("{model}", canonical).replaceAll("{name}", canonical.slice(canonical.indexOf("/") + 1));
}

/** The service model id a service maps a canonical model to, or none. */
function serviceModelRoute(service: ICatalogService, canonical: string): string | undefined {
  const explicit = service.serves[canonical];
  if (explicit) return explicit;
  const template = service.serves["*"];
  return template ? substituteTemplate(template, canonical) : undefined;
}

interface IServiceState {
  service: ICatalogService;
  serviceId: string;
  serviceModelId: string;
}

/** Choose the explicit service, or the first preferred service satisfying every constraint. */
/** Why a candidate preference service fails, as a human-readable fragment, or none. */
function candidateDropReason(
  service: ICatalogService,
  spec: IBindingSpec,
  modelState: IModelState,
  probe: IBindingEnvProbe,
): string | undefined {
  if (spec.transport && service.transport !== spec.transport) return `transport ${service.transport}`;
  if (spec.interface && service.interface !== spec.interface) return `interface ${service.interface}`;
  if (service.key_env && !probe.hasKey(service.key_env)) return `key ${service.key_env} missing`;
  if (service.requires_optin && !probe.hasOptIn(service.requires_optin)) {
    return `opt-in ${service.requires_optin} missing`;
  }
  const route = serviceModelRoute(service, modelState.canonical);
  if (!route) return `does not serve ${modelState.canonical}`;
  if (spec.service_model_id && route !== spec.service_model_id) return `serves ${route} not ${spec.service_model_id}`;
  return undefined;
}

function resolveService(
  ref: IBindingStepRef,
  spec: IBindingSpec,
  modelState: IModelState,
  layers: IBindingLayers,
  probe: IBindingEnvProbe,
): IServiceState | IInvalidBindingOutcome {
  if (spec.service) return explicitServiceState(ref, spec, modelState, layers, probe);
  const dropped: string[] = [];
  for (const candidate of layers.catalog.preferences[modelState.provider] ?? []) {
    const service = layers.catalog.services[candidate];
    if (!service) {
      dropped.push(`${candidate}: unknown`);
      continue;
    }
    if (spec.service_model_id && !modelState.catalogModel) {
      return { service, serviceId: candidate, serviceModelId: spec.service_model_id };
    }
    const reason = candidateDropReason(service, spec, modelState, probe);
    if (reason) {
      dropped.push(`${candidate}: ${reason}`);
      continue;
    }
    const route = serviceModelRoute(service, modelState.canonical);
    return { service, serviceId: candidate, serviceModelId: spec.service_model_id ?? route! };
  }
  return issue("no_service_for_constraints", ref, dropped.join("; ") || "no preferred service");
}

/** Capability checks for requested features. Absent metadata proves nothing. */
function capabilityIssues(ref: IBindingStepRef, spec: IBindingSpec, modelState: IModelState): IBindingIssue[] {
  const issues: IBindingIssue[] = [];
  const capabilities = modelState.catalogModel?.capabilities;
  if (spec.thinking === true && !capabilities?.includes(ModelCapabilitySchema.enum.thinking)) {
    issues.push({
      code: ISSUE_CAPABILITY_MISSING,
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `Model capability is not verified for ${modelState.canonical}`,
    });
  }
  if (spec.effort && spec.effort !== EFFORT_AUTO && !capabilities?.includes(ModelCapabilitySchema.enum.effort)) {
    issues.push({
      code: ISSUE_CAPABILITY_MISSING,
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `Model capability is not verified for ${modelState.canonical}`,
    });
  }
  return issues;
}

/** Check an explicitly named service: existence, constraints, routes and key/opt-in. */
/** Missing key or opt-in for a service, as an outcome, or none. */
function credentialIssue(
  ref: IBindingStepRef,
  service: ICatalogService,
  probe: IBindingEnvProbe,
): IInvalidBindingOutcome | undefined {
  if (service.key_env && !probe.hasKey(service.key_env)) {
    return issue(ISSUE_KEY_MISSING, ref, `Missing credential: ${service.key_env}`);
  }
  if (service.requires_optin && !probe.hasOptIn(service.requires_optin)) {
    return issue(ISSUE_OPTIN_MISSING, ref, `Missing opt-in: ${service.requires_optin}`);
  }
  return undefined;
}

function explicitServiceState(
  ref: IBindingStepRef,
  spec: IBindingSpec,
  modelState: IModelState,
  layers: IBindingLayers,
  probe: IBindingEnvProbe,
): IServiceState | IInvalidBindingOutcome {
  const service = layers.catalog.services[spec.service!];
  if (!service) return issue("unknown_service", ref, `Unknown binding service: ${spec.service}`);
  if (spec.transport && service.transport !== spec.transport) {
    return issue("no_service_for_constraints", ref, `Transport mismatch for ${spec.service}`);
  }
  if (spec.interface && service.interface !== spec.interface) {
    return issue(ISSUE_INTERFACE_UNSUPPORTED, ref, `Interface mismatch for ${spec.service}`);
  }
  const credentials = credentialIssue(ref, service, probe);
  if (credentials) return credentials;
  if (spec.service_model_id && !modelState.catalogModel) {
    return { service, serviceId: spec.service!, serviceModelId: spec.service_model_id };
  }
  const route = serviceModelRoute(service, modelState.canonical);
  if (!route) {
    return issue(
      "service_does_not_serve_model",
      ref,
      `${spec.service} does not serve ${modelState.canonical}`,
    );
  }
  if (spec.service_model_id && route !== spec.service_model_id) {
    return issue(
      "service_does_not_serve_model",
      ref,
      `${spec.service} serves ${modelState.canonical} as ${route} not ${spec.service_model_id}`,
    );
  }
  return { service, serviceId: spec.service!, serviceModelId: spec.service_model_id ?? route };
}

/** The selector that drove the binding, inherited by derived fields. */
function driverSource(sources: IResolvedBinding["sources"]): IBindingFieldSource {
  return sources.model ?? sources.model_provider ?? sources.service_model_id ?? sources.service ??
    sources.transport ?? sources.interface ?? { layer: FALLBACK_LAYER, selector: SELECTOR_DEFAULT };
}

/** Route compatibility between the step ref and the chosen service.
 *  A cli-delegate service is a session-tool target, never a provider.
 *  A generate-backed cli service stays a provider with a cli interface.
 *  A gate judge and a scenario judge both call provider.generate, so both accept cli.
 *  Returns a reason when incompatible, else undefined. */
function interfaceCompatibilityIssue(ref: IBindingStepRef, service: ICatalogService): string | undefined {
  const isDelegateService = service.adapter === "cli-delegate";
  if (ref.kind === STEP_KIND_GATE || ref.kind === STEP_KIND_JUDGE) {
    return isDelegateService ? "a judge uses provider.generate, not a session-tool delegate" : undefined;
  }
  if (ref.strategy === "cli_delegate") {
    return isDelegateService ? undefined : "strategy cli_delegate requires a cli-delegate service";
  }
  if (service.interface === "cli") {
    return "CLI interface requires strategy cli_delegate or a gate judge";
  }
  return undefined;
}

/** Resolve a flow step's provider binding across all layers. */
export function resolveBinding(
  ref: IBindingStepRef,
  step: { binding?: IBindingSpec; pin?: IStepPin } = {},
  layers: IBindingLayers,
  probe: IBindingEnvProbe,
): BindingOutcome | IInvalidBindingOutcome {
  const merged = mergeEntries(ref, layers, step);
  if ("issues" in merged) return { kind: BINDING_OUTCOME_INVALID, issues: merged.issues };
  const { spec, sources } = merged;

  const modelState = resolveModel(ref, spec, layers);
  if ("issues" in modelState) return { kind: BINDING_OUTCOME_INVALID, issues: modelState.issues };
  if ("kind" in modelState && modelState.kind === BINDING_OUTCOME_UNBOUND) return { kind: BINDING_OUTCOME_UNBOUND };

  const capability = capabilityIssues(ref, spec, modelState);
  if (capability.length > 0) return { kind: BINDING_OUTCOME_INVALID, issues: capability };

  const serviceState = resolveService(ref, spec, modelState, layers, probe);
  if ("issues" in serviceState) return { kind: BINDING_OUTCOME_INVALID, issues: serviceState.issues };

  const { service, serviceId, serviceModelId } = serviceState;
  const routeIssue = interfaceCompatibilityIssue(ref, service);
  if (routeIssue) return issue(ISSUE_INTERFACE_UNSUPPORTED, ref, routeIssue);
  const driver = driverSource(sources);
  const resolvedSources: IResolvedBinding["sources"] = {
    service: sources.service ?? driver,
    model: sources.model ?? driver,
    model_provider: sources.model_provider ?? sources.model ?? driver,
    service_model_id: sources.service_model_id ?? sources.service ?? driver,
    transport: sources.transport ?? sources.service ?? driver,
    interface: sources.interface ?? sources.service ?? driver,
  };

  const construction = {
    service: serviceId,
    model_provider: modelState.provider,
    model: modelState.canonical,
    service_model_id: serviceModelId,
    transport: service.transport,
    interface: service.interface,
    adapter: service.adapter,
    profile: service.profile,
    endpoint: service.endpoint,
    allow_insecure_loopback: service.allow_insecure_loopback,
    supports_tool_choice: service.supports_tool_choice,
    // Only a self-hosted service reads its own key variable. Others stay unset, so their fingerprints are unchanged.
    key_env: service.profile === OPENAI_COMPATIBLE_SELF_HOSTED_PROFILE ? service.key_env : undefined,
    tool: service.tool,
    effort: spec.effort,
    thinking: spec.thinking,
  };
  const fingerprint = encodeHex(
    crypto.subtle.digestSync("SHA-256", new TextEncoder().encode(JSON.stringify(construction))),
  );
  return { kind: "bound", binding: { ...construction, sources: resolvedSources, fingerprint } };
}
