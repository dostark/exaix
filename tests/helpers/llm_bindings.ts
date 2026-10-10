/**
 * @module LlmBindings
 * @path tests/helpers/llm_bindings.ts
 * @description Binds the LLM provider and model of a test through the phase-204 binding layers, the
 *   same resolver and factory the daemon and the scenario runner use. A preset names a catalog
 *   service and a model. EXA_TEST_BIND overrides the live binding, in the --bind syntax
 *   `selector=field=value,field=value`. The helper never reads EXA_LLM_* routing variables.
 * @architectural-layer Test
 * @dependencies [@exaix/ai, @exaix/model-registry, @exaix/schemas]
 * @related-files [
 *   "packages/ai/src/bindings/binding_resolver.ts",
 *   "packages/model-registry/src/binding_catalog.ts",
 *   "apps/common/registry_bootstrap.ts"
 * ]
 */

import {
  type IBindingEnvProbe,
  LAYER_RUN,
  ProviderFactory,
  resolveBinding,
  SELECTOR_DEFAULT,
  STEP_KIND_AGENT,
} from "@exaix/ai";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { buildBuiltInCatalog } from "@exaix/model-registry";
import {
  BindOneOffSchema,
  type Config,
  ConfigSchema,
  type IBindingCatalog,
  type IBindingLayers,
  type IBindingSpec,
  type IBindingStepRef,
  type IResolvedBinding,
} from "@exaix/schemas";
import { bootstrapProviderRegistry } from "../../apps/common/registry_bootstrap.ts";

/** One provider and model a test can bind. */
export interface ILlmTestPreset {
  id: string;
  spec: IBindingSpec;
  /** Whether the provider's boot registration declares grouped round replay. */
  groupedReplay: boolean;
  /** False when the provider refuses a tool name it did not advertise, so an alias call is refused. Defaults to true. */
  acceptsToolAliases?: boolean;
}

/** The operator override for every live-provider test, in the phase-204 --bind syntax. */
export const EXA_TEST_BIND_ENV = "EXA_TEST_BIND";

export const LLM_TEST_PRESETS: readonly ILlmTestPreset[] = [
  { id: "google", spec: { service: "google", service_model_id: "gemini-3-flash" }, groupedReplay: true },
  {
    id: "anthropic",
    spec: { service: "anthropic", service_model_id: "claude-haiku-4-5-20251001" },
    groupedReplay: true,
  },
  { id: "openai", spec: { service: "openai", service_model_id: "gpt-5-mini" }, groupedReplay: true },
  {
    id: "openrouter",
    spec: { service: "openrouter", service_model_id: "openai/gpt-4o-mini" },
    groupedReplay: true,
  },
  {
    id: "deepseek",
    spec: { service: "deepseek", service_model_id: "deepseek-v4-pro" },
    groupedReplay: true,
    acceptsToolAliases: false,
  },
];

/** The live tests' default: the DeepSeek API. Grouped replay is not yet available there. */
const LIVE_PRESET_ID = "deepseek";
/** The grouped-replay harness's default: the cheapest provider whose replay the boot registration declares. */
const GROUPED_REPLAY_PRESET_ID = "google";

/** Catalog models the built-in catalog does not list but the tests need. They join the catalog
 *  the way an operator catalog entry does, so the resolver validates them like any other model. */
const TEST_CATALOG_MODELS = [
  // Pinned, not a latest alias: the phase-202 live replay leg names this exact model.
  { service: "google", canonical: "google/gemini-3-flash", serviceModelId: "gemini-3-flash" },
  {
    service: "anthropic",
    canonical: "anthropic/claude-haiku-4-5-20251001",
    serviceModelId: "claude-haiku-4-5-20251001",
  },
  { service: "openai", canonical: "openai/gpt-5-mini", serviceModelId: "gpt-5-mini" },
] as const;

/** The built-in catalog plus the test models. Each call returns a fresh copy. */
export function llmTestCatalog(): IBindingCatalog {
  const catalog = buildBuiltInCatalog();
  for (const model of TEST_CATALOG_MODELS) {
    catalog.models[model.canonical] = { model_provider: model.service };
    catalog.services[model.service]!.serves[model.canonical] = model.serviceModelId;
  }
  return catalog;
}

const TEST_STEP_REF: IBindingStepRef = {
  flowId: "llm-test",
  stepId: "llm-test-step",
  agentRole: "llm-test-agent",
  kind: STEP_KIND_AGENT,
  nativeTools: false,
};

function envProbe(): IBindingEnvProbe {
  return {
    hasKey: (name) => (Deno.env.get(name) ?? "").length > 0,
    hasOptIn: (name) => Deno.env.get(name) === "1",
  };
}

/** Parses one --bind entry, `selector=field=value,field=value`, through the operator's schema. */
export function parseBindOverride(text: string): IBindingSpec {
  const separator = text.indexOf("=");
  if (separator <= 0) throw new Error(`${EXA_TEST_BIND_ENV} must be selector=field=value: ${text}`);
  const fields: Record<string, string> = {};
  for (const assignment of text.slice(separator + 1).split(",")) {
    const equals = assignment.indexOf("=");
    if (equals <= 0) throw new Error(`${EXA_TEST_BIND_ENV} field must be field=value: ${assignment}`);
    fields[assignment.slice(0, equals)] = assignment.slice(equals + 1);
  }
  const [entry] = BindOneOffSchema.parse([{ selector: text.slice(0, separator), spec: fields }]);
  return entry!.spec;
}

function presetSpec(id: string): IBindingSpec {
  const preset = LLM_TEST_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`no LLM test preset named ${id}`);
  return preset.spec;
}

/** The binding every live-provider test uses: EXA_TEST_BIND, else the DeepSeek preset. */
export function liveLlmSpec(): IBindingSpec {
  const override = Deno.env.get(EXA_TEST_BIND_ENV);
  return override ? parseBindOverride(override) : presetSpec(LIVE_PRESET_ID);
}

/** The binding the grouped-replay live harness uses: EXA_TEST_BIND, else the Google preset. */
export function liveReplayLlmSpec(): IBindingSpec {
  const override = Deno.env.get(EXA_TEST_BIND_ENV);
  return override ? parseBindOverride(override) : presetSpec(GROUPED_REPLAY_PRESET_ID);
}

/** Resolves a spec through the phase-204 resolver. A spec that does not bind fails with its issue codes. */
export function resolveLlmBinding(spec: IBindingSpec): IResolvedBinding {
  const layers: IBindingLayers = {
    entries: [{ layer: LAYER_RUN, selector: SELECTOR_DEFAULT, spec }],
    catalog: llmTestCatalog(),
    overlaySha256: [],
    operatorLayersPresent: false,
  };
  const outcome = resolveBinding(TEST_STEP_REF, {}, layers, envProbe());
  if (outcome.kind === "bound") return outcome.binding;
  const reason = outcome.kind === "invalid"
    ? outcome.issues.map((issue) => `${issue.code}: ${issue.detail}`).join("; ")
    : "no service binds this model";
  throw new Error(`LLM test binding ${JSON.stringify(spec)} did not bind: ${reason}`);
}

function testConfig(): Config {
  return ConfigSchema.parse({ system: {}, paths: {}, ai: { provider: "mock", model: "boot-model" } });
}

/** Resolves a spec and builds its provider with ProviderFactory.createFromBinding, as the daemon does. */
export async function createLlmProvider(
  spec: IBindingSpec,
): Promise<{ binding: IResolvedBinding; provider: IModelProvider }> {
  bootstrapProviderRegistry();
  const binding = resolveLlmBinding(spec);
  const provider = await ProviderFactory.createFromBinding(testConfig(), binding);
  return { binding, provider };
}

/** The key variable the spec's service reads, or undefined for a service that needs no key. */
export function llmKeyEnv(spec: IBindingSpec): string | undefined {
  return llmTestCatalog().services[spec.service ?? ""]?.key_env;
}

/** True when the spec needs no key, or its key variable is set. Used to gate live tests. */
export function llmKeyPresent(spec: IBindingSpec): boolean {
  const keyEnv = llmKeyEnv(spec);
  return keyEnv === undefined || (Deno.env.get(keyEnv) ?? "").length > 0;
}
