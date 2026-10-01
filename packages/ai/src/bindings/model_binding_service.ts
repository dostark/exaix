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
import {
  BINDING_OVERLAYS_DIR,
  BINDING_PROVIDER_POOL_MAX_SIZE,
  BINDINGS_DIR,
  type ICostTracker,
  type IDatabaseService,
} from "@exaix/core";
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
import type { IModelRegistry, Opt, Reason } from "@exaix/core/types";
import type { IProviderMetadata } from "../provider_registry.ts";
import { buildBuiltInCatalog } from "@exaix/model-registry";
import { ProviderFactory } from "../provider_factory.ts";
import type { IModelProvider } from "../types.ts";
import { unwrapModelProvider } from "../providers/common.ts";
import { bindingStepRef, LAYER_CONFIG, loadBindingLayers } from "./binding_layers.ts";
import {
  type IInvalidBindingOutcome,
  ISSUE_LOCK_MISMATCH,
  resolveBinding,
  SELECTOR_DEFAULT,
} from "./binding_resolver.ts";
import { adapterKeyId, validateBinding } from "./binding_validation.ts";
import { compareLock, sha256Hex } from "./binding_replay.ts";
import { buildLock, LockConflictError, persistLockExclusive } from "./binding_lock.ts";
import { type IRunBindingsStore, OverlayClaimError } from "./run_bindings_store.ts";
import {
  ADAPTER_CLI_DELEGATE,
  BINDING_OUTCOME_BOUND,
  BINDING_OUTCOME_INVALID,
  BINDING_OUTCOME_UNBOUND,
  BindingIncompatibleError,
  BOUND_TARGET_KIND_PROVIDER,
  BOUND_TARGET_KIND_SESSION_TOOL,
  type IBoundStepProvider,
  type IBoundStepTarget,
} from "./binding_types.ts";

export interface IModelBindingServiceDeps {
  configSource: { get(): Config };
  logger: IEventLogger;
  probe: {
    hasKey(name: string): Promise<boolean> | boolean;
    hasOptIn(name: string): Promise<boolean> | boolean;
    /** Opaque in-memory version of the stored credential. A change makes the pool build a new wrapper. */
    keyVersion?(name: string): Promise<string> | string;
  };
  /** Pool capacity override. Defaults to BINDING_PROVIDER_POOL_MAX_SIZE. */
  poolMaxSize?: number;
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
  /** The start-time network grant covering every catalog host (Step 7). An endpoint host
   *  outside it when allow_net is unset yields needs_restart during validation. */
  startNetGrant?: readonly string[];
}

const CONSTRUCTION_CAUSE_MAX_CHARS = 200;

/** The failure message, bounded for the audit trail. Factories never put key values in errors. */
function constructionCause(error: Error): string {
  return error.message.slice(0, CONSTRUCTION_CAUSE_MAX_CHARS);
}

/** @visible Resolves all flow choices before one step can call a provider. */
export class ModelBindingService {
  private readonly providers = new Map<string, Promise<IModelProvider>>();
  /** Recency tick per pooled provider key (LRU eviction order). */
  private readonly lastUsed = new Map<string, number>();
  /** Pool keys held by each in-flight run, by trace. A held provider is never evicted. */
  private readonly runHolds = new Map<string, Set<string>>();
  /** Credential versions captured at each run's snapshot. They stay in memory only. */
  private readonly credentialVersions = new WeakMap<IBindingRunSnapshot, ReadonlyMap<string, string>>();
  private tick = 0;
  private readonly deps: IModelBindingServiceDeps;
  /** Expected key variable per adapter profile, taken from the built-in catalog. */
  private readonly builtInKeyVariables: Record<string, string> = Object.fromEntries(
    Object.values(buildBuiltInCatalog().services).flatMap((service) =>
      service.key_env ? [[adapterKeyId(service.adapter, service.profile), service.key_env]] : []
    ),
  );
  private readonly logger: IEventLogger;

  constructor(deps: IModelBindingServiceDeps) {
    this.deps = deps;
    this.logger = deps.logger;
    deps.eventRegistry?.registerPublisher("model_binding_service", [
      DomainEventType.BindingResolved,
      DomainEventType.BindingRejected,
      DomainEventType.BindingSnapshotCreated,
      DomainEventType.BindingRunReleased,
    ]);
  }

  /** Flow execution enables binding setup when an operator layer may exist.
   *  That is a config [bindings] block or a non-empty daemon overlay directory.
   *  The full layer scan happens in snapshotForRun, so this is the cheap gate. */
  async isActive(): Promise<boolean> {
    const config = this.deps.configSource.get();
    if (Object.keys(config.bindings ?? {}).length > 0) return true;
    const overlaysDir = join(config.system.root, config.paths.runtime, BINDING_OVERLAYS_DIR);
    try {
      return (await Deno.stat(overlaysDir)).isDirectory;
    } catch {
      return false;
    }
  }

  /** Whether an operator run file exists for the trace. Run-file presence alone activates
   *  binding setup, so per-run overlays, --bind and --locked work with no other layer. */
  async hasRunFile(traceId: Opt<string, Reason.TraceAbsent>): Promise<boolean> {
    if (!traceId || !this.deps.runStore) return false;
    return await this.deps.runStore.exists(traceId);
  }

  /** Capture current config once and construct every bound provider before execution. */
  async snapshotForRun(
    flow: IFlow,
    run: { traceId: string; requestId?: string; requestPath?: string; requestSha256?: string },
  ): Promise<IBindingRunSnapshot> {
    const config = structuredClone(this.deps.configSource.get());
    const runFile = await this.claimRunFile(flow, run);
    const layers = await loadBindingLayers(config, runFile);
    // A repeated trace (resume) starts over. Other runs keep their holds.
    await this.releaseRun(run.traceId);
    const { probe, versions } = await this.envProbe(layers);
    const envIgnored = layers.operatorLayersPresent &&
      (Deno.env.get("EXA_LLM_PROVIDER") !== undefined || Deno.env.get("EXA_LLM_MODEL") !== undefined);
    const nativeTools = config.execution?.native_tools_enabled === true;
    const bindings = new Map<string, BindingOutcome>();
    const issues: IBindingIssue[] = [];
    for (const step of flow.steps) {
      const ref = bindingStepRef(flow, step, nativeTools);
      if (!ref) continue;
      this.resolveStep(layers, probe, step, ref, bindings, issues);
    }
    if (issues.length === 0) {
      issues.push(
        ...await this.validateAndPrepare(flow, config, layers, probe, bindings, {
          nativeTools,
          versions,
          traceId: run.traceId,
        }),
      );
    }

    const replayIssue = await compareLock(flow, runFile, { bindings, catalog: layers.catalog });
    if (replayIssue) issues.push(replayIssue);

    if (issues.length > 0) {
      await this.releaseRun(run.traceId);
      await this.reject(run.traceId, flow.id, issues);
      throw new BindingIncompatibleError(issues);
    }
    const lock = await this.writeLock(flow, run.traceId, layers, bindings, {
      envIgnored,
      replayed: runFile?.locked !== undefined,
    }).catch(async (error) => {
      await this.releaseRun(run.traceId);
      if (!(error instanceof LockConflictError)) throw error;
      const conflict: IBindingIssue = { code: ISSUE_LOCK_MISMATCH, flowId: flow.id, detail: error.message };
      await this.reject(run.traceId, flow.id, [conflict]);
      throw new BindingIncompatibleError([conflict]);
    });
    const snapshot: IBindingRunSnapshot = {
      traceId: run.traceId,
      flowId: flow.id,
      layers,
      bindings,
      issues,
      envIgnored,
      lock,
      globalBudgetMode: layers.operatorLayersPresent,
    };
    this.credentialVersions.set(snapshot, versions);
    return snapshot;
  }

  /** Release the pool holds of a finished run. Unheld providers beyond capacity are then evicted and closed. */
  async releaseRun(traceId: string): Promise<void> {
    const held = this.runHolds.get(traceId);
    if (!held) return;
    this.runHolds.delete(traceId);
    const evicted = this.evictIfNeeded();
    await this.logger.info(DomainEventType.BindingRunReleased, traceId, {
      trace_id: traceId,
      held_providers: held.size,
      evicted_providers: evicted,
    }, traceId);
  }

  private hold(traceId: string, key: string): void {
    const held = this.runHolds.get(traceId) ?? new Set<string>();
    held.add(key);
    this.runHolds.set(traceId, held);
  }

  private isHeld(key: string): boolean {
    for (const held of this.runHolds.values()) if (held.has(key)) return true;
    return false;
  }

  /** Validate every bound step, then construct its provider. Returns all issues found. */
  private async validateAndPrepare(
    flow: IFlow,
    config: Config,
    layers: IBindingLayers,
    probe: { hasKey(name: string): boolean; hasOptIn(name: string): boolean },
    bindings: ReadonlyMap<string, BindingOutcome>,
    run: { nativeTools: boolean; versions: ReadonlyMap<string, string>; traceId: string },
  ): Promise<IBindingIssue[]> {
    const issues: IBindingIssue[] = [];
    for (const step of flow.steps) {
      const ref = bindingStepRef(flow, step, run.nativeTools);
      const outcome = ref ? bindings.get(step.id) : undefined;
      if (!ref || !outcome || outcome.kind !== BINDING_OUTCOME_BOUND) continue;
      const validationIssues = await this.validateOutcomeBinding(ref, outcome.binding, layers, probe);
      if (validationIssues.length > 0) {
        issues.push(...validationIssues);
        continue;
      }
      if (outcome.binding.adapter === ADAPTER_CLI_DELEGATE) continue;
      try {
        await this.prepareProvider(run.traceId, config, outcome.binding, layers, run.versions);
      } catch (error) {
        issues.push({
          code: "interface_unsupported",
          flowId: flow.id,
          stepId: step.id,
          detail: `Provider construction failed for service ${outcome.binding.service}: ${
            constructionCause(error instanceof Error ? error : new Error("non-error failure"))
          }`,
        });
      }
    }
    return issues;
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

  /** Snapshot the synchronous key/opt-in probe for this run's layer set. `versions` maps each key
   *  variable to its credential version. It keys the pool and never leaves memory. */
  private async envProbe(layers: IBindingLayers): Promise<{
    probe: { hasKey(name: string): boolean; hasOptIn(name: string): boolean };
    versions: ReadonlyMap<string, string>;
  }> {
    const keyState = new Map<string, boolean>();
    const optInState = new Map<string, boolean>();
    const versions = new Map<string, string>();
    for (const service of Object.values(layers.catalog.services)) {
      if (service.key_env && !keyState.has(service.key_env)) {
        keyState.set(service.key_env, await this.deps.probe.hasKey(service.key_env));
        versions.set(service.key_env, await this.deps.probe.keyVersion?.(service.key_env) ?? "");
      }
      if (service.requires_optin && !optInState.has(service.requires_optin)) {
        optInState.set(service.requires_optin, await this.deps.probe.hasOptIn(service.requires_optin));
      }
    }
    return {
      probe: {
        hasKey: (name: string): boolean => keyState.get(name) === true,
        hasOptIn: (name: string): boolean => optInState.get(name) === true,
      },
      versions,
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
    probe: { hasKey(name: string): boolean; hasOptIn(name: string): boolean },
  ): Promise<IBindingIssue[]> {
    return await validateBinding(ref, {
      binding: resolved,
      service: layers.catalog.services[resolved.service],
      catalogModel: layers.catalog.models[resolved.model],
      probe,
      getAdapterMetadata: this.deps.getAdapterMetadata,
      adapterKeyEnv: this.deps.adapterKeyEnv ?? this.builtInKeyVariables,
      modelRegistry: this.deps.modelRegistry,
      maxCostPerDay: this.deps.maxCostPerDay,
      allowNet: this.deps.configSource.get().system?.allow_net,
      startNetGrant: this.deps.startNetGrant,
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
        ...(entry.selector ? { selector: entry.selector } : {}),
        detail: entry.detail,
      })),
    }, traceId);
  }

  /** Write the per-run lockfile exclusively and emit binding.snapshot.created with its sha256. */
  private async writeLock(
    flow: IFlow,
    traceId: string,
    layers: IBindingLayers,
    bindings: Map<string, BindingOutcome>,
    audit: { envIgnored: boolean; replayed: boolean },
  ): Promise<{ path: string; sha256: string } | undefined> {
    const config = structuredClone(this.deps.configSource.get());
    // The production request creator always mints a UUID trace. A non-UUID trace (direct
    // flow-call fixture) lacks a stable lock identity and gets no lock.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(traceId)) return undefined;
    const lock = await buildLock({
      flow,
      traceId,
      layers,
      bindings,
      configChecksum: await sha256Hex(JSON.stringify(config)),
      envIgnored: audit.envIgnored,
    });
    const persisted = await persistLockExclusive(join(config.system.root, config.paths.runtime, BINDINGS_DIR), lock);
    await this.logger.info(DomainEventType.BindingSnapshotCreated, flow.id, {
      flow_id: flow.id,
      trace_id: traceId,
      lock_path: persisted.path,
      lock_sha256: persisted.sha256,
      entries: lock.entries.length,
      issues: 0,
      hosts: lock.hosts,
      config_checksum: lock.config_checksum,
      overlay_sha256: lock.overlay_sha256,
      run_overlays: lock.run_overlays,
      env_ignored: lock.env_ignored,
      replayed: audit.replayed,
    }, traceId);
    return persisted;
  }

  private async prepareProvider(
    traceId: string,
    config: Config,
    binding: Extract<BindingOutcome, { kind: "bound" }>["binding"],
    layers: IBindingLayers,
    versions: ReadonlyMap<string, string>,
  ): Promise<string> {
    const globalBudgetMode = layers.operatorLayersPresent;
    const key = this.providerKey(layers, binding, globalBudgetMode, versions);
    this.hold(traceId, key);
    let provider = this.providers.get(key);
    if (!provider) {
      provider = ProviderFactory.createFromBinding(
        config,
        binding,
        this.deps.db,
        this.deps.logger,
        this.deps.costTracker,
        {
          bindingIdentity: {
            service: binding.service,
            transport: binding.transport,
            ...(layers.catalog.services[binding.service]?.daily_cost_cap_usd !== undefined
              ? { dailyCostCapUsd: layers.catalog.services[binding.service].daily_cost_cap_usd }
              : {}),
          },
          ...(globalBudgetMode && this.deps.maxCostPerDay !== undefined
            ? { globalCapUsd: this.deps.maxCostPerDay }
            : {}),
        },
      );
      this.providers.set(key, provider);
      this.lastUsed.set(key, ++this.tick);
      this.evictIfNeeded();
    }
    try {
      this.lastUsed.set(key, ++this.tick);
      await provider;
      return key;
    } catch (error) {
      this.providers.delete(key);
      this.lastUsed.delete(key);
      this.runHolds.get(traceId)?.delete(key);
      throw error;
    }
  }

  /** Bounded LRU eviction: remove the least-recently-used pools once capacity is exceeded.
   *  A provider held by any run stays. An evicted provider is closed after it settles. */
  private evictIfNeeded(): number {
    const max = this.deps.poolMaxSize ?? BINDING_PROVIDER_POOL_MAX_SIZE;
    if (this.providers.size <= max) return 0;
    let evictedCount = 0;
    const candidates = [...this.lastUsed.entries()]
      .filter(([key]) => !this.isHeld(key))
      .sort((a, b) => a[1] - b[1]);
    for (const [key] of candidates) {
      if (this.providers.size <= max) break;
      const evicted = this.providers.get(key);
      this.providers.delete(key);
      this.lastUsed.delete(key);
      evictedCount++;
      void evicted?.then((provider) => unwrapModelProvider(provider).dispose?.()).catch(() => {});
    }
    return evictedCount;
  }

  /** The pool key carries the service cap and budget mode. A wrapper from an earlier mode
   *  is never reused. The key never includes secrets. */
  private providerKey(
    layers: IBindingLayers,
    binding: Extract<BindingOutcome, { kind: "bound" }>["binding"],
    globalBudgetMode: boolean,
    versions: ReadonlyMap<string, string>,
  ): string {
    const service = layers.catalog.services[binding.service];
    const version = service?.key_env ? versions.get(service.key_env) ?? "" : "";
    const mode = globalBudgetMode ? "global" : "per-provider";
    return `${binding.fingerprint}|cap=${service?.daily_cost_cap_usd ?? ""}|mode=${mode}|cred=${version}`;
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
    const key = this.providerKey(
      snapshot.layers,
      binding,
      snapshot.globalBudgetMode ?? false,
      this.credentialVersions.get(snapshot) ?? new Map(),
    );
    const provider = await this.providers.get(key);
    if (!provider) {
      throw new BindingIncompatibleError([{
        code: "unknown_service",
        flowId: ref.flowId,
        stepId: ref.stepId,
        detail: "Preflighted provider is unavailable",
      }]);
    }
    this.lastUsed.set(key, ++this.tick);
    this.hold(snapshot.traceId, key);
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
