/**
 * @module ModelBindingService
 * @path packages/ai/src/bindings/model_binding_service.ts
 * @description Resolves and preflights one immutable provider choice per flow step. The
 *   run snapshot reads the current config, daemon overlay files and the request's operator
 *   run-binding file, and resolves every LLM step before its first call. Under an operator
 *   layer, unmatched steps get the config.ai implicit default (EXA_LLM_* is ignored).
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @exaix/model-registry, @exaix/core]
 * @related-files [packages/ai/src/bindings/binding_resolver.ts, packages/ai/src/bindings/binding_layers.ts, packages/ai/src/bindings/run_bindings_store.ts, packages/flow/src/flow_runner.ts]
 */

import { DomainEventType, type IEventRegistry } from "@exaix/core/events";
import { BINDING_OVERLAYS_DIR, FlowStepType, type ICostTracker, type IDatabaseService } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import { join } from "@std/path";
import type {
  BindingOutcome,
  Config,
  IBindingIssue,
  IBindingLayers,
  IBindingRunSnapshot,
  IBindingStepRef,
  IFlow,
  IResolvedBinding,
  IRunBindingsFile,
} from "@exaix/schemas";
import type { IModelRegistry } from "@exaix/core/types";
import type { IProviderMetadata } from "../provider_registry.ts";
import { ProviderFactory } from "../provider_factory.ts";
import type { IModelProvider } from "../types.ts";
import { LAYER_CONFIG, loadBindingLayers } from "./binding_layers.ts";
import { type IInvalidBindingOutcome, resolveBinding, SELECTOR_DEFAULT } from "./binding_resolver.ts";
import { validateBinding } from "./binding_validation.ts";
import { type IRunBindingsStore, OverlayClaimError } from "./run_bindings_store.ts";
import {
  ADAPTER_CLI_DELEGATE,
  BINDING_OUTCOME_INVALID,
  BINDING_OUTCOME_UNBOUND,
  BindingIncompatibleError,
  BOUND_TARGET_KIND_PROVIDER,
  BOUND_TARGET_KIND_SESSION_TOOL,
  type IBoundStepProvider,
  type IBoundStepTarget,
  STEP_KIND_AGENT,
  STEP_KIND_GATE,
} from "./binding_types.ts";

export interface IModelBindingServiceDeps {
  configSource: { get(): Config };
  logger: IEventLogger;
  probe: { hasKey(name: string): Promise<boolean> | boolean; hasOptIn(name: string): Promise<boolean> | boolean };
  db?: IDatabaseService;
  costTracker?: ICostTracker;
  eventRegistry?: IEventRegistry;
  /** Per-run binding file store, required for CLI runs to claim their overlays. */
  runStore?: IRunBindingsStore;
  /** Adapter metadata lookup (ProviderRegistry) for validation. */
  getAdapterMetadata?: (adapter: string) => IProviderMetadata | undefined;
  /** Canonical key variable per adapter id, for the key-variable name check. */
  adapterKeyEnv?: Record<string, string>;
  /** Model registry for pricing provenance used by validation. */
  modelRegistry?: Pick<IModelRegistry, "getModelPricing">;
  /** Finite daily cost cap enabling the unknown-pricing guard. */
  maxCostPerDay?: number;
}

/** @visible Resolves all flow choices before one step can call a provider. */
export class ModelBindingService {
  private readonly providers = new Map<string, Promise<IModelProvider>>();
  private readonly deps: IModelBindingServiceDeps;
  private readonly logger: IEventLogger;

  constructor(deps: IModelBindingServiceDeps) {
    this.deps = deps;
    this.logger = deps.logger;
    deps.eventRegistry?.registerPublisher("model_binding_service", [
      DomainEventType.BindingResolved,
      DomainEventType.BindingRejected,
    ]);
  }

  /** Flow execution enables binding setup when an operator layer may exist.
   *  That is a config [bindings] block or a non-empty daemon overlay directory.
   *  The full layer scan happens in snapshotForRun, so this is the cheap gate. */
  isActive(): boolean {
    const config = this.deps.configSource.get();
    if (Object.keys(config.bindings ?? {}).length > 0) return true;
    const overlaysDir = join(config.system.root, config.paths.runtime, BINDING_OVERLAYS_DIR);
    try {
      const info = Deno.statSync(overlaysDir);
      if (info.isDirectory) return true;
    } catch {
      // No overlay directory — no operator layer.
    }
    return false;
  }

  /** The binding ref for an LLM-calling step, or undefined for other step types. */
  private stepRefFor(flow: IFlow, step: IFlow["steps"][number]): IBindingStepRef | undefined {
    if (
      step.type !== FlowStepType.AGENT && step.type !== FlowStepType.GATE &&
      step.type !== FlowStepType.SESSION_DELEGATE_CYCLE
    ) {
      return undefined;
    }
    if (step.type === FlowStepType.AGENT) {
      return {
        flowId: flow.id,
        stepId: step.id,
        agentRole: step.agent_role,
        kind: STEP_KIND_AGENT,
        strategy: step.strategy,
        nativeTools: false,
      };
    }
    return {
      flowId: flow.id,
      stepId: step.id,
      agentRole: step.type === FlowStepType.GATE
        ? step.evaluate?.agent_role ?? step.agent_role
        : step.delegateCycle?.review.agent_role ?? step.agent_role,
      kind: STEP_KIND_GATE,
      nativeTools: false,
    };
  }

  /** Capture current config once and construct every bound provider before execution. */
  async snapshotForRun(
    flow: IFlow,
    run: { traceId: string; requestId?: string; requestPath?: string; requestSha256?: string },
  ): Promise<IBindingRunSnapshot> {
    const config = structuredClone(this.deps.configSource.get());
    const runFile = await this.claimRunFile(flow, run);
    const layers = await loadBindingLayers(config, runFile);
    const probe = await this.envProbe(layers);
    const envIgnored = layers.operatorLayersPresent &&
      (Deno.env.get("EXA_LLM_PROVIDER") !== undefined || Deno.env.get("EXA_LLM_MODEL") !== undefined);
    const bindings = new Map<string, BindingOutcome>();
    const issues: IBindingIssue[] = [];
    for (const step of flow.steps) {
      const ref = this.stepRefFor(flow, step);
      if (!ref) continue;
      this.resolveStep(layers, probe, step, ref, bindings, issues);
    }
    if (issues.length === 0) {
      for (const step of flow.steps) {
        const ref = this.stepRefFor(flow, step);
        const outcome = ref ? bindings.get(step.id) : undefined;
        if (!outcome || outcome.kind !== "bound") continue;
        const validationIssues = await this.validateOutcomeBinding(ref!, outcome.binding, layers);
        if (validationIssues.length > 0) {
          issues.push(...validationIssues);
          continue;
        }
        if (outcome.binding.adapter !== ADAPTER_CLI_DELEGATE) {
          try {
            await this.prepareProvider(config, outcome.binding);
          } catch {
            issues.push({
              code: "interface_unsupported",
              flowId: flow.id,
              stepId: step.id,
              detail: `Provider construction failed for service ${outcome.binding.service}`,
            });
          }
        }
      }
    }
    if (issues.length > 0) {
      await this.reject(run.traceId, flow.id, issues);
      throw new BindingIncompatibleError(issues);
    }
    return { traceId: run.traceId, flowId: flow.id, layers, bindings, issues, envIgnored };
  }

  /** Claim the operator run-binding file for this request when one exists. */
  private async claimRunFile(
    flow: IFlow,
    run: { traceId: string; requestPath?: string; requestSha256?: string },
  ): Promise<IRunBindingsFile | undefined> {
    if (!this.deps.runStore || !run.requestPath || !run.requestSha256) return undefined;
    try {
      return await this.deps.runStore.claim(run.traceId, run.requestPath, run.requestSha256);
    } catch (error) {
      if (error instanceof OverlayClaimError) {
        const issue: IBindingIssue = { code: "overlay_invalid", flowId: flow.id, detail: error.message };
        await this.reject(run.traceId, flow.id, [issue]);
        throw new BindingIncompatibleError([issue]);
      }
      throw error;
    }
  }

  /** Snapshot the synchronous key/opt-in probe for this run's layer set. */
  private async envProbe(
    layers: IBindingLayers,
  ): Promise<{ hasKey(name: string): boolean; hasOptIn(name: string): boolean }> {
    const keyState = new Map<string, boolean>();
    const optInState = new Map<string, boolean>();
    for (const service of Object.values(layers.catalog.services)) {
      if (service.key_env && !keyState.has(service.key_env)) {
        keyState.set(service.key_env, await this.deps.probe.hasKey(service.key_env));
      }
      if (service.requires_optin && !optInState.has(service.requires_optin)) {
        optInState.set(service.requires_optin, await this.deps.probe.hasOptIn(service.requires_optin));
      }
    }
    return {
      hasKey: (name: string): boolean => keyState.get(name) === true,
      hasOptIn: (name: string): boolean => optInState.get(name) === true,
    };
  }

  /** Resolve one step's binding outcome, applying the environment rule for unmatched steps. */
  private resolveStep(
    layers: IBindingLayers,
    probe: { hasKey(name: string): boolean; hasOptIn(name: string): boolean },
    step: IFlow["steps"][number],
    ref: IBindingStepRef,
    bindings: Map<string, BindingOutcome>,
    issues: IBindingIssue[],
  ): void {
    const stepBinding = step.binding ?? {};
    const stepPin = step.pin;
    let outcome = resolveBinding(ref, { binding: stepBinding, pin: stepPin }, layers, probe);
    if (outcome.kind === BINDING_OUTCOME_UNBOUND && layers.operatorLayersPresent) {
      outcome = this.implicitConfigDefault(ref, layers, probe);
    }
    if (outcome.kind === BINDING_OUTCOME_INVALID) issues.push(...outcome.issues);
    else bindings.set(step.id, outcome);
  }

  /** Run the binding validation table over one resolved outcome (Step 6). */
  private async validateOutcomeBinding(
    ref: IBindingStepRef,
    resolved: IResolvedBinding,
    layers: IBindingLayers,
  ): Promise<IBindingIssue[]> {
    return await validateBinding(ref, {
      binding: resolved,
      service: layers.catalog.services[resolved.service],
      catalogModel: layers.catalog.models[resolved.model],
      probe: { hasKey: () => true, hasOptIn: () => true },
      getAdapterMetadata: this.deps.getAdapterMetadata,
      adapterKeyEnv: this.deps.adapterKeyEnv,
      modelRegistry: this.deps.modelRegistry,
      maxCostPerDay: this.deps.maxCostPerDay,
    });
  }

  /** Resolve an unmatched step under an operator layer through the config.ai implicit default. */
  private implicitConfigDefault(
    ref: IBindingStepRef,
    layers: IBindingLayers,
    probe: { hasKey(name: string): boolean; hasOptIn(name: string): boolean },
  ): BindingOutcome | IInvalidBindingOutcome {
    if (!layers.configDefaultModel) {
      return {
        kind: BINDING_OUTCOME_INVALID,
        issues: [{
          code: "unknown_model",
          flowId: ref.flowId,
          stepId: ref.stepId,
          detail: "No config.ai default canonical model in the catalog",
        }],
      };
    }
    const implicitLayers: IBindingLayers = {
      ...layers,
      entries: [
        ...layers.entries,
        { layer: LAYER_CONFIG, selector: SELECTOR_DEFAULT, spec: { model: layers.configDefaultModel } },
      ],
    };
    return resolveBinding(ref, { binding: {} }, implicitLayers, probe);
  }

  private async reject(traceId: string, flowId: string, issues: readonly IBindingIssue[]): Promise<void> {
    await this.logger.info(DomainEventType.BindingRejected, flowId, {
      flow_id: flowId,
      trace_id: traceId,
      issues: issues.map((entry) => ({
        code: entry.code,
        step_id: entry.stepId,
        detail: entry.detail,
      })),
    }, traceId);
  }

  private async prepareProvider(
    config: Config,
    binding: Extract<BindingOutcome, { kind: "bound" }>["binding"],
  ): Promise<IModelProvider> {
    const key = binding.fingerprint;
    let provider = this.providers.get(key);
    if (!provider) {
      provider = ProviderFactory.createFromBinding(
        config,
        binding,
        this.deps.db,
        this.deps.logger,
        this.deps.costTracker,
      );
      this.providers.set(key, provider);
    }
    try {
      return await provider;
    } catch (error) {
      this.providers.delete(key);
      throw error;
    }
  }

  /** Acquire the already-preflighted target and record this step attempt.
   *  A cli-delegate service yields a session-tool target, never an IModelProvider.
   *  Everything else returns its pooled provider. */
  async providerFor(snapshot: IBindingRunSnapshot, ref: IBindingStepRef): Promise<IBoundStepTarget> {
    const outcome = snapshot.bindings.get(ref.stepId);
    if (!outcome || outcome.kind === BINDING_OUTCOME_UNBOUND) return undefined;
    const binding = outcome.binding;
    if (binding.adapter === ADAPTER_CLI_DELEGATE) {
      if (!binding.tool) {
        throw new BindingIncompatibleError([{
          code: "unknown_service",
          flowId: ref.flowId,
          stepId: ref.stepId,
          detail: `cli-delegate service ${binding.service} has no tool`,
        }]);
      }
      await this.logResolved(ref, snapshot, binding);
      return { kind: BOUND_TARGET_KIND_SESSION_TOOL, binding, tool: binding.tool };
    }
    const provider = await this.providers.get(binding.fingerprint);
    if (!provider) {
      throw new BindingIncompatibleError([{
        code: "unknown_service",
        flowId: ref.flowId,
        stepId: ref.stepId,
        detail: "Preflighted provider is unavailable",
      }]);
    }
    await this.logResolved(ref, snapshot, binding);
    return { kind: BOUND_TARGET_KIND_PROVIDER, binding, provider };
  }

  private async logResolved(
    ref: IBindingStepRef,
    snapshot: IBindingRunSnapshot,
    binding: IBoundStepProvider["binding"],
  ): Promise<void> {
    await this.logger.info(DomainEventType.BindingResolved, ref.stepId, {
      flow_id: ref.flowId,
      step_id: ref.stepId,
      agent_role: ref.agentRole,
      trace_id: snapshot.traceId,
      service: binding.service,
      model_provider: binding.model_provider,
      model: binding.model,
      service_model_id: binding.service_model_id,
      transport: binding.transport,
      interface: binding.interface,
      adapter: binding.adapter,
      sources: binding.sources,
      fingerprint: binding.fingerprint,
    }, snapshot.traceId);
  }
}
