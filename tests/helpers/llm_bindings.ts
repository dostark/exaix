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
  STEP_KIND_JUDGE,
} from "@exaix/ai";
import type { IModelProvider } from "@exaix/ai/types.ts";
import { buildBuiltInCatalog, mergeCatalogs } from "@exaix/model-registry";
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
import { liveCatalogOverlay, liveSkipReason, liveSpecOf } from "./live_presets.ts";

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

/** The providers with wire-conformance fixtures, with the replay facts that no catalog row carries. Each spec comes from its `live-<service>` row of configs/eval-cells.toml. */
const PRESET_FACTS: ReadonlyArray<Pick<ILlmTestPreset, "id" | "groupedReplay" | "acceptsToolAliases">> = [
  { id: "google", groupedReplay: true },
  { id: "anthropic", groupedReplay: true },
  { id: "openai", groupedReplay: true },
  { id: "openrouter", groupedReplay: true },
  { id: "deepseek", groupedReplay: true, acceptsToolAliases: false },
];

export const LLM_TEST_PRESETS: readonly ILlmTestPreset[] = PRESET_FACTS.map((facts) => ({
  ...facts,
  spec: liveSpecOf(facts.id),
}));

/** The live tests' default service: the DeepSeek API, an openai-chat provider whose boot registration declares grouped replay. */
const LIVE_DEFAULT_SERVICE = "deepseek";

/** The built-in catalog plus the models and services that the `live-*` rows of configs/eval-cells.toml declare.
 *  Each call returns a fresh copy. */
export function llmTestCatalog(): IBindingCatalog {
  return mergeCatalogs(buildBuiltInCatalog(), liveCatalogOverlay());
}

const TEST_STEP_REF: IBindingStepRef = {
  flowId: "llm-test",
  stepId: "llm-test-step",
  agentRole: "llm-test-agent",
  kind: STEP_KIND_AGENT,
  nativeTools: false,
};

/** A CLI provider binds as a judge, because the resolver admits a CLI interface for judges and gates only. */
const CLI_TEST_JUDGE_ID = "llm-test-judge";
const CLI_TEST_SELECTOR = `judge:${CLI_TEST_JUDGE_ID}`;
const CLI_TEST_STEP_REF: IBindingStepRef = { ...TEST_STEP_REF, kind: STEP_KIND_JUDGE, judgeId: CLI_TEST_JUDGE_ID };

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

/** The binding a live-provider test uses: EXA_TEST_BIND, else the preset row of the named service, which is DeepSeek by default. */
export function liveLlmSpec(service: string = LIVE_DEFAULT_SERVICE): IBindingSpec {
  const override = Deno.env.get(EXA_TEST_BIND_ENV);
  return override ? parseBindOverride(override) : liveSpecOf(service);
}

/** The binding the grouped-replay live harness uses: EXA_TEST_BIND, else the DeepSeek preset. */
export function liveReplayLlmSpec(): IBindingSpec {
  const override = Deno.env.get(EXA_TEST_BIND_ENV);
  return override ? parseBindOverride(override) : liveSpecOf(LIVE_DEFAULT_SERVICE);
}

/** Resolves a spec through the phase-204 resolver. A spec that does not bind fails with its issue codes. */
export function resolveLlmBinding(spec: IBindingSpec): IResolvedBinding {
  const catalog = llmTestCatalog();
  const isCli = catalog.services[spec.service ?? ""]?.interface === "cli";
  const layers: IBindingLayers = {
    entries: [{ layer: LAYER_RUN, selector: isCli ? CLI_TEST_SELECTOR : SELECTOR_DEFAULT, spec }],
    catalog,
    overlaySha256: [],
    operatorLayersPresent: false,
  };
  const outcome = resolveBinding(isCli ? CLI_TEST_STEP_REF : TEST_STEP_REF, {}, layers, envProbe());
  if (outcome.kind === "bound") return outcome.binding;
  const reason = outcome.kind === "invalid"
    ? outcome.issues.map((issue) => `${issue.code}: ${issue.detail}`).join("; ")
    : "no service binds this model";
  throw new Error(`LLM test binding ${JSON.stringify(spec)} did not bind: ${reason}`);
}

/** The request budget of a live provider. A subscription CLI starts a process for each call, so it needs 300000 ms. */
const LIVE_PROVIDER_TIMEOUT_MS = 300_000;

function testConfig(): Config {
  return ConfigSchema.parse({
    system: {},
    paths: {},
    ai: { provider: "mock", model: "boot-model", timeout_ms: LIVE_PROVIDER_TIMEOUT_MS },
  });
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

/** The first missing predicate of the preset row of the bound service, or null when the live test can run. */
export function liveLlmSkipReason(spec: IBindingSpec): string | null {
  if (spec.service === undefined) throw new Error(`a live binding must name its service: ${JSON.stringify(spec)}`);
  return liveSkipReason(spec.service);
}

/** True when the live test of the bound service can run. It prints the named reason when it cannot. */
export function liveLlmEnabled(spec: IBindingSpec): boolean {
  const reason = liveLlmSkipReason(spec);
  if (reason !== null) console.warn(`[live] ${spec.service}: skipped, ${reason}`);
  return reason === null;
}
