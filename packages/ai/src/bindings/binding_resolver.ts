/**
 * @module BindingResolver
 * @path packages/ai/src/bindings/binding_resolver.ts
 * @description Pure first-slice resolver for config default and exact flow step bindings.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @std/crypto]
 * @related-files [packages/ai/src/bindings/model_binding_service.ts, packages/model-registry/src/binding_catalog.ts]
 */

import { crypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import {
  type BindingField,
  type BindingOutcome,
  EFFORT_AUTO,
  type IBindingIssue,
  type IBindingLayers,
  type IBindingSpec,
  type IBindingStepRef,
  type IResolvedBinding,
  type IStepPin,
  ModelCapabilitySchema,
} from "@exaix/schemas";
import type { IBindingEnvProbe } from "./binding_types.ts";
import { BINDING_OUTCOME_INVALID } from "./binding_types.ts";

export interface IInvalidBindingOutcome {
  kind: typeof BINDING_OUTCOME_INVALID;
  issues: IBindingIssue[];
}

const SELECTOR_DEFAULT = "default";
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

/** Merge every matching entry in layer order and return the merged spec and per-field sources. */
function collectSpec(
  layers: IBindingLayers,
  exact: string,
): { spec: IBindingSpec; sources: IResolvedBinding["sources"] } | undefined {
  const matching = layers.entries.filter(
    (entry) => entry.selector === SELECTOR_DEFAULT || entry.selector === exact,
  );
  if (matching.length === 0) return undefined;
  const ordered = matching.toSorted((a, b) => {
    const layerDiff = LAYER_RANK[a.layer] - LAYER_RANK[b.layer];
    return layerDiff || Number(a.selector === exact) - Number(b.selector === exact);
  });
  const spec: IBindingSpec = {};
  const sources: IResolvedBinding["sources"] = {};
  for (const entry of ordered) {
    for (const [rawField, value] of Object.entries(entry.spec)) {
      if (value === undefined) continue;
      const field = rawField as BindingField;
      Object.assign(spec, { [field]: value });
      sources[field] = { layer: entry.layer, selector: entry.selector };
    }
  }
  return { spec, sources };
}

/** Verify the serve mapping consistency for an explicit canonical model. */
function collectServeIssues(
  ref: IBindingStepRef,
  spec: IBindingSpec,
  service: { serves: Record<string, string> },
): IBindingIssue[] {
  if (!spec.model) return [];
  if (spec.service_model_id && service.serves[spec.model] !== spec.service_model_id) {
    return [{
      code: "service_does_not_serve_model",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `${spec.service} does not serve ${spec.model} as ${spec.service_model_id}`,
    }];
  }
  if (!spec.service_model_id && !service.serves[spec.model]) {
    return [{
      code: "service_does_not_serve_model",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `${spec.service} does not serve ${spec.model}`,
    }];
  }
  return [];
}

/** Verify the model half of a merged spec and return issues, or none when valid. */
function collectModelIssues(
  ref: IBindingStepRef,
  spec: IBindingSpec,
  layers: IBindingLayers,
  service: { serves: Record<string, string> },
): IBindingIssue[] {
  if (!spec.model && !spec.service_model_id) {
    return [{
      code: "unknown_model",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: "A service binding requires model or service_model_id",
    }];
  }
  const model = spec.model ? layers.catalog.models[spec.model] : undefined;
  if (spec.model && !model) {
    return [{
      code: "unknown_model",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `Unknown canonical model: ${spec.model}`,
    }];
  }
  if (model && spec.model_provider && model.model_provider !== spec.model_provider) {
    return [{
      code: "unknown_model",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `Model provider mismatch: ${spec.model_provider}`,
    }];
  }
  const issues: IBindingIssue[] = [];
  if (
    spec.model && ((spec.thinking === true && !model?.capabilities?.includes(ModelCapabilitySchema.enum.thinking)) ||
      (spec.effort && spec.effort !== EFFORT_AUTO &&
        !model?.capabilities?.includes(ModelCapabilitySchema.enum.effort)))
  ) {
    issues.push({
      code: "capability_missing",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `Model capability is not verified for ${spec.model}`,
    });
  }
  return [...issues, ...collectServeIssues(ref, spec, service)];
}

/** Verify the service half of a merged spec and return issues, or none when valid. */
function collectServiceIssues(
  ref: IBindingStepRef,
  spec: IBindingSpec,
  service: { key_env?: string; requires_optin?: string; transport: string; interface: string },
  probe: IBindingEnvProbe,
): IBindingIssue[] {
  const issues: IBindingIssue[] = [];
  if (service.key_env && !probe.hasKey(service.key_env)) {
    issues.push({
      code: "key_missing",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `Missing credential: ${service.key_env}`,
    });
  }
  if (service.requires_optin && !probe.hasOptIn(service.requires_optin)) {
    issues.push({
      code: "optin_missing",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `Missing opt-in: ${service.requires_optin}`,
    });
  }
  if (spec.transport && spec.transport !== service.transport) {
    issues.push({
      code: "no_service_for_constraints",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `Transport mismatch for ${spec.service}`,
    });
  }
  if (spec.interface && spec.interface !== service.interface) {
    issues.push({
      code: "interface_unsupported",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `Interface mismatch for ${spec.service}`,
    });
  }
  return issues;
}

/** Verify the merged spec against the catalog service and model and return issues, or none when valid. */
function collectIssues(
  ref: IBindingStepRef,
  spec: IBindingSpec,
  layers: IBindingLayers,
  probe: IBindingEnvProbe,
): IBindingIssue[] {
  if (!spec.service) {
    return [{
      code: "no_service_for_constraints",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: "Step 1 requires an explicit service",
    }];
  }
  const service = layers.catalog.services[spec.service];
  if (!service) {
    return [{
      code: "unknown_service",
      flowId: ref.flowId,
      stepId: ref.stepId,
      detail: `Unknown binding service: ${spec.service}`,
    }];
  }
  return [
    ...collectModelIssues(ref, spec, layers, service),
    ...collectServiceIssues(ref, spec, service, probe),
  ];
}

/** Resolve only the Step 1 selectors. Step 2 adds the other selector classes. */
export function resolveBinding(
  ref: IBindingStepRef,
  _step: { binding?: IBindingSpec; pin?: IStepPin },
  layers: IBindingLayers,
  probe: IBindingEnvProbe,
): BindingOutcome | IInvalidBindingOutcome {
  const exact = `flow:${ref.flowId}/step:${ref.stepId}`;
  const collected = collectSpec(layers, exact);
  if (!collected) return { kind: "unbound" };
  const { spec, sources } = collected;
  const issues = collectIssues(ref, spec, layers, probe);
  if (issues.length > 0) return { kind: BINDING_OUTCOME_INVALID, issues };
  const service = layers.catalog.services[spec.service!];
  const model = spec.model ? layers.catalog.models[spec.model] : undefined;
  const resolvedModel = spec.model ?? `${spec.service}/${spec.service_model_id}`;
  const serviceModelId = spec.service_model_id ?? service.serves[resolvedModel];
  if (!serviceModelId) return issue("service_does_not_serve_model", ref, `${spec.service} has no model route`);
  const construction = {
    service: spec.service!,
    model_provider: model?.model_provider ?? spec.model_provider ?? spec.service!,
    model: resolvedModel,
    service_model_id: serviceModelId,
    transport: service.transport,
    interface: service.interface,
    adapter: service.adapter,
    profile: service.profile,
    endpoint: service.endpoint,
    allow_insecure_loopback: service.allow_insecure_loopback,
    tool: service.tool,
    effort: spec.effort,
    thinking: spec.thinking,
  };
  const fingerprint = encodeHex(
    crypto.subtle.digestSync("SHA-256", new TextEncoder().encode(JSON.stringify(construction))),
  );
  return { kind: "bound", binding: { ...construction, sources, fingerprint } };
}
