/**
 * @module BindingValidation
 * @path packages/ai/src/bindings/binding_validation.ts
 * @description Validates a resolved flow-step binding against the binding validation
 *   table (every code except the Step-7 host and lock checks): capability_missing for
 *   native tools/effort/thinking, interface_unsupported, key_missing (absent and wrong
 *   variable name), optin_missing, endpoint_invalid, local_host_not_private and
 *   pricing_unavailable. Reuses adapter metadata the registry already holds and pricing
 *   provenance from the injected model registry; it adds no network probe.
 * @architectural-layer AI
 * @dependencies [@exaix/core, @exaix/schemas]
 * @related-files [packages/ai/src/bindings/model_binding_service.ts, packages/ai/src/provider_registry.ts]
 */

import { OPENAI_COMPATIBLE_LOCAL_PROFILE, OPENAI_COMPATIBLE_PROFILE_DEFAULTS, ProviderType } from "@exaix/core";
import { EFFORT_AUTO } from "@exaix/schemas";
import type { IBindingIssue, IBindingStepRef, IResolvedBinding } from "@exaix/schemas";
import type { ICatalogModel, ICatalogService } from "@exaix/schemas";
import type { IModelPricing, IModelRegistry, PricingProvenance } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";
import type { IProviderMetadata } from "../provider_registry.ts";
import type { IBindingEnvProbe } from "./binding_types.ts";
import {
  ISSUE_CAPABILITY_MISSING,
  ISSUE_ENDPOINT_INVALID,
  ISSUE_HOST_NOT_ALLOWED,
  ISSUE_INTERFACE_UNSUPPORTED,
  ISSUE_KEY_MISSING,
  ISSUE_LOCAL_HOST_NOT_PRIVATE,
  ISSUE_NEEDS_RESTART,
  ISSUE_OPTIN_MISSING,
  ISSUE_PRICING_UNAVAILABLE,
} from "./binding_resolver.ts";

export interface IBindingValidationDeps {
  binding: IResolvedBinding;
  /** The catalog service the binding resolved to, with key_env and endpoint. */
  service?: ICatalogService;
  /** The catalog model entry for the resolved canonical model, when present. */
  catalogModel?: ICatalogModel;
  probe: IBindingEnvProbe;
  /** Adapter metadata lookup (ProviderRegistry), for supportsNativeTools. */
  getAdapterMetadata?: (adapter: string) => IProviderMetadata | undefined;
  /** Canonical key variable per adapter id, for the "key_env differs from the adapter's
   *  fixed key variable" check. Built-in adapters supply their variable here. */
  adapterKeyEnv?: Record<string, string>;
  /** Model registry for pricing provenance. Absent means no pricing guard applies. */
  modelRegistry?: Pick<IModelRegistry, "getModelPricing">;
  /** A finite daily cost cap, enabling the cloud unknown-pricing guard only when set. */
  maxCostPerDay?: number;
  /** Explicit `[system].allow_net` grant. A resolved endpoint host outside it is
   *  host_not_allowed. Absent means no explicit-allow check applies. */
  allowNet?: readonly string[];
  /** The start-time network grant (all catalog hosts) when allow_net is unset. An endpoint
   *  host outside it is needs_restart. */
  startNetGrant?: readonly string[];
}

/** True when the host is a loopback address: localhost, 127.0.0.0/8, or IPv6 ::1. */
function isLoopbackHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower);
}

/** True when the host is a private/loopback/link-local or single-label name. */
function isPrivateHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackHost(lower)) return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(lower)) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (!lower.includes(".")) return true;
  return /\.(local|lan|internal)$/.test(lower);
}

interface IEndpointView {
  scheme: string;
  host: string;
  hasUserInfo: boolean;
  hasQuery: boolean;
  hasFragment: boolean;
}

/** Basic URL parser tolerant of host-only entries. Never throws. */
function parseEndpoint(endpoint: Opt<string, Reason.OptionalContext>): IEndpointView | undefined {
  if (!endpoint) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { scheme: "", host: "", hasUserInfo: false, hasQuery: false, hasFragment: false };
  }
  return {
    scheme: parsed.protocol.replace(":", ""),
    host: parsed.hostname,
    hasUserInfo: parsed.username !== "" || parsed.password !== "",
    hasQuery: parsed.search !== "",
    hasFragment: parsed.hash !== "",
  };
}

function issue(code: IBindingIssue["code"], ref: IBindingStepRef, detail: string): IBindingIssue {
  return { code, flowId: ref.flowId, stepId: ref.stepId, detail };
}

/** Validate one resolved binding against the binding validation table. */
export async function validateBinding(ref: IBindingStepRef, deps: IBindingValidationDeps): Promise<IBindingIssue[]> {
  const issues: IBindingIssue[] = [];
  validateCapabilities(ref, deps, issues);
  validateInterface(ref, deps, issues);
  validateCredentials(ref, deps, issues);
  validateEndpoint(ref, deps, issues);
  await validatePricing(ref, deps, issues);
  return issues;
}

/** capability_missing for native tools, effort and thinking. */
function validateCapabilities(
  ref: IBindingStepRef,
  deps: IBindingValidationDeps,
  issues: IBindingIssue[],
): void {
  const { binding, catalogModel, getAdapterMetadata } = deps;
  const capabilities = catalogModel?.capabilities;
  const adapterMeta = getAdapterMetadata?.(binding.adapter);
  if (ref.nativeTools) {
    // Native tools are an opt-in with a text fallback, so an unknown model capability passes.
    // The adapter fact is verified, and a declared capability set is known.
    const modelRefuses = capabilities !== undefined && !capabilities.includes("native_tools");
    const adapterSupports = adapterMeta?.supportsNativeTools === true;
    if (modelRefuses || !adapterSupports) {
      issues.push(issue(ISSUE_CAPABILITY_MISSING, ref, `${binding.model} lacks native tool support`));
    }
  }
  if (binding.effort !== undefined && binding.effort !== EFFORT_AUTO) {
    if (capabilities?.includes("effort") !== true) {
      issues.push(issue(ISSUE_CAPABILITY_MISSING, ref, `${binding.model} lacks effort support`));
    }
  }
  if (binding.thinking === true && capabilities?.includes("thinking") !== true) {
    issues.push(issue(ISSUE_CAPABILITY_MISSING, ref, `${binding.model} lacks thinking support`));
  }
}

/** interface_unsupported for cli/CLI-delegate mismatches and compatible profile failures. */
function validateInterface(ref: IBindingStepRef, deps: IBindingValidationDeps, issues: IBindingIssue[]): void {
  const { binding, service } = deps;
  if (binding.interface === "cli" && ref.kind !== "gate" && ref.strategy !== "cli_delegate") {
    issues.push(issue(ISSUE_INTERFACE_UNSUPPORTED, ref, `${binding.service} is a cli service not usable by this step`));
  }
  if (binding.adapter === "cli-delegate" && ref.kind === "gate") {
    issues.push(issue(ISSUE_INTERFACE_UNSUPPORTED, ref, "a cli-delegate service cannot grade a gate"));
  }
  if (binding.adapter === ProviderType.OPENAI_CHAT && binding.profile) {
    const supported = Object.keys(OPENAI_COMPATIBLE_PROFILE_DEFAULTS);
    if (!supported.includes(binding.profile)) {
      issues.push(issue(ISSUE_INTERFACE_UNSUPPORTED, ref, `unsupported openai-chat profile: ${binding.profile}`));
    } else if (binding.profile === OPENAI_COMPATIBLE_LOCAL_PROFILE && !service?.allow_insecure_loopback) {
      issues.push(issue(ISSUE_INTERFACE_UNSUPPORTED, ref, "local-test profile requires allow_insecure_loopback"));
    }
  }
}

/** key_missing and optin_missing. */
function validateCredentials(ref: IBindingStepRef, deps: IBindingValidationDeps, issues: IBindingIssue[]): void {
  const { binding, service, probe, adapterKeyEnv } = deps;
  if (service?.key_env) {
    if (!probe.hasKey(service.key_env)) {
      issues.push(issue(ISSUE_KEY_MISSING, ref, `Missing credential: ${service.key_env}`));
    } else if (adapterKeyEnv?.[binding.adapter] && service.key_env !== adapterKeyEnv[binding.adapter]) {
      issues.push(issue(ISSUE_KEY_MISSING, ref, `${service.key_env} differs from the adapter's fixed key variable`));
    }
  }
  if (service?.requires_optin && !probe.hasOptIn(service.requires_optin)) {
    issues.push(issue(ISSUE_OPTIN_MISSING, ref, `Missing opt-in: ${service.requires_optin}`));
  }
}

/** endpoint_invalid, local_host_not_private, host_not_allowed and needs_restart. */
function validateEndpoint(ref: IBindingStepRef, deps: IBindingValidationDeps, issues: IBindingIssue[]): void {
  const { binding, service, allowNet, startNetGrant } = deps;
  const endpoint = service?.endpoint ?? binding.endpoint;
  const parsed = parseEndpoint(endpoint);
  if (!endpoint || !parsed) return;
  const allowedHttp = parsed.scheme === "http" && isLoopbackHost(parsed.host);
  if (parsed.scheme !== "https" && !allowedHttp) {
    issues.push(issue(ISSUE_ENDPOINT_INVALID, ref, "endpoint must be https, or http to a loopback host"));
  }
  if (parsed.hasUserInfo || parsed.hasQuery || parsed.hasFragment) {
    issues.push(issue(ISSUE_ENDPOINT_INVALID, ref, "endpoint must not carry userinfo, query or fragment"));
  }
  if (binding.transport === "local" && parsed.host && !isPrivateHost(parsed.host)) {
    issues.push(issue(ISSUE_LOCAL_HOST_NOT_PRIVATE, ref, `${parsed.host} is not a private or local host`));
  }
  validateHostGrant(ref, parsed.host, allowNet, startNetGrant, issues);
}

/** An endpoint host outside the explicit allow_net is host_not_allowed. Outside the
 *  start-time grant it is needs_restart. Deno semantics: a host-only entry permits any
 *  port, a host:port entry only that port. */
function validateHostGrant(
  ref: IBindingStepRef,
  host: string,
  allowNet: Opt<readonly string[], Reason.OptionalContext>,
  startNetGrant: Opt<readonly string[], Reason.OptionalContext>,
  issues: IBindingIssue[],
): void {
  if (!host) return;
  if (allowNet !== undefined) {
    if (!grantAllowsHost(allowNet, host)) {
      issues.push(issue(ISSUE_HOST_NOT_ALLOWED, ref, `${host} is not in the allow_net grant`));
    }
  } else if (startNetGrant !== undefined) {
    if (!grantAllowsHost(startNetGrant, host)) {
      issues.push(issue(ISSUE_NEEDS_RESTART, ref, `${host} is outside the start-time network grant`));
    }
  }
}

/** Deno `--allow-net` semantics: a host-only entry permits that host on any port.
 *  A `host:port` entry permits only that port. */
function grantAllowsHost(grant: readonly string[], host: string): boolean {
  for (const entry of grant) {
    const separator = entry.lastIndexOf(":");
    if (separator === -1) {
      if (host === entry) return true;
      continue;
    }
    const entryHost = entry.slice(0, separator);
    if (host === entryHost) return true; // explicit host:port covers that host
  }
  return false;
}

/** pricing_unavailable for cloud bindings under a finite cap with unknown provenance. */
async function validatePricing(
  ref: IBindingStepRef,
  deps: IBindingValidationDeps,
  issues: IBindingIssue[],
): Promise<void> {
  const { binding, modelRegistry, maxCostPerDay } = deps;
  if (binding.transport !== "cloud" || maxCostPerDay === undefined || !modelRegistry) return;
  let provenance: PricingProvenance | undefined;
  try {
    const pricing: IModelPricing = await modelRegistry.getModelPricing(binding.service, binding.service_model_id);
    provenance = pricing.provenance;
  } catch {
    provenance = "unknown";
  }
  if (provenance === "unknown") {
    issues.push(
      issue(ISSUE_PRICING_UNAVAILABLE, ref, `${binding.service}:${binding.service_model_id} has unknown pricing`),
    );
  }
}
