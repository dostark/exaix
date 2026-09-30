/**
 * @module ModelBindingService
 * @path packages/ai/src/bindings/model_binding_service.ts
 * @description Resolves and preflights one immutable provider choice per flow step.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @exaix/model-registry, @exaix/core]
 * @related-files [packages/ai/src/bindings/binding_resolver.ts, packages/flow/src/flow_runner.ts]
 */

import { DomainEventType, type IEventRegistry } from "@exaix/core/events";
import type { ICostTracker, IDatabaseService } from "@exaix/core";
import type { IEventLogger } from "@exaix/core/logger";
import type {
  BindingOutcome,
  Config,
  IBindingIssue,
  IBindingRunSnapshot,
  IBindingStepRef,
  IFlow,
} from "@exaix/schemas";
import { ProviderFactory } from "../provider_factory.ts";
import type { IModelProvider } from "../types.ts";
import { loadBindingLayers } from "./binding_layers.ts";
import { resolveBinding } from "./binding_resolver.ts";
import { BINDING_OUTCOME_INVALID, BindingIncompatibleError, type IBoundStepProvider } from "./binding_types.ts";

export interface IModelBindingServiceDeps {
  configSource: { get(): Config };
  logger: IEventLogger;
  probe: { hasKey(name: string): Promise<boolean> | boolean; hasOptIn(name: string): Promise<boolean> | boolean };
  db?: IDatabaseService;
  costTracker?: ICostTracker;
  eventRegistry?: IEventRegistry;
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

  /** Legacy flow execution bypasses binding setup when no binding layer exists. */
  isActive(): boolean {
    return Object.keys(this.deps.configSource.get().bindings ?? {}).length > 0;
  }

  /** Capture current config once and construct every bound provider before execution. */
  async snapshotForRun(flow: IFlow, run: { traceId: string; requestId?: string }): Promise<IBindingRunSnapshot> {
    const config = structuredClone(this.deps.configSource.get());
    const layers = loadBindingLayers(config);
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
    const probe = {
      hasKey: (name: string): boolean => keyState.get(name) === true,
      hasOptIn: (name: string): boolean => optInState.get(name) === true,
    };
    const bindings = new Map<string, BindingOutcome>();
    const issues: IBindingIssue[] = [];
    for (const step of flow.steps) {
      if (step.type !== "agent") continue;
      const ref: IBindingStepRef = {
        flowId: flow.id,
        stepId: step.id,
        agentRole: step.agent_role,
        kind: "agent",
        strategy: step.strategy,
        nativeTools: false,
      };
      const outcome = resolveBinding(ref, {}, layers, probe);
      if (outcome.kind === BINDING_OUTCOME_INVALID) issues.push(...outcome.issues);
      else bindings.set(step.id, outcome);
    }
    if (issues.length === 0) {
      for (const [stepId, outcome] of bindings) {
        if (outcome.kind !== "bound") continue;
        try {
          await this.prepareProvider(config, outcome.binding);
        } catch {
          issues.push({
            code: "interface_unsupported",
            flowId: flow.id,
            stepId,
            detail: `Provider construction failed for service ${outcome.binding.service}`,
          });
        }
      }
    }
    if (issues.length > 0) {
      await this.logger.info(DomainEventType.BindingRejected, flow.id, {
        flow_id: flow.id,
        trace_id: run.traceId,
        issues: issues.map((entry) => ({
          code: entry.code,
          step_id: entry.stepId,
          detail: entry.detail,
        })),
      }, run.traceId);
      throw new BindingIncompatibleError(issues);
    }
    return { traceId: run.traceId, flowId: flow.id, layers, bindings, issues };
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

  /** Acquire the already-preflighted target and record this step attempt. */
  async providerFor(snapshot: IBindingRunSnapshot, ref: IBindingStepRef): Promise<IBoundStepProvider | undefined> {
    const outcome = snapshot.bindings.get(ref.stepId);
    if (!outcome || outcome.kind === "unbound") return undefined;
    const provider = await this.providers.get(outcome.binding.fingerprint);
    if (!provider) {
      throw new BindingIncompatibleError([{
        code: "unknown_service",
        flowId: ref.flowId,
        stepId: ref.stepId,
        detail: "Preflighted provider is unavailable",
      }]);
    }
    const binding = outcome.binding;
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
    return { kind: "provider", binding, provider };
  }
}
