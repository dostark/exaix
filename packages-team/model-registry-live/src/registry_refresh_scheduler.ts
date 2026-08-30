/**
 * @module RegistryRefreshScheduler
 * @path packages-team/model-registry-live/src/registry_refresh_scheduler.ts
 * @description Phase 135 Step 5 — the opt-in in-daemon catalog/pricing refresh
 *   scheduler. A single timer drives per-provider refresh passes: fetchCatalog → Zod
 *   (in the adapter) → admission + atomic swap (service.applyRefresh) → fetchPricing →
 *   applyPricing → one credential-scrubbed audit row + catalog/pricing/failed events.
 *   A failed provider degrades to the persisted catalog (§7.2) and never rolls back
 *   another provider. Consecutive failures back off exponentially, capped at the cron
 *   interval. Real timers are skipped under DENO_TEST=1; stop() clears the single handle.
 *   Constructed only when model_registry.enabled === true (see maybeCreateRefreshScheduler).
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/model-registry, @exaix/triggers, @exaix/core/events]
 * @related-files [packages-team/model-registry-live/src/model_registry_service.ts, apps/daemon/src/bootstrap_team.ts]
 */
import { validateCronExpression } from "@exaix/triggers";
import type { IAdapterContext, IProviderCatalogAdapter } from "@exaix/model-registry";
import { CatalogAuthError, CatalogHttpError, CatalogParseError } from "@exaix/model-registry";
import {
  DomainEventType,
  type IModelCatalogRefreshedPayload,
  type IModelPricingRefreshedPayload,
  type IModelRegistryRefreshFailedPayload,
  type RegistryRefreshKind,
  type RegistryRefreshOutcome,
} from "@exaix/core/events";
import type { IEventLogger } from "@exaix/core/logger";
import type { Config } from "@exaix/schemas";
import type { AdapterRegistry } from "./adapters/adapter_registry.ts";
import type { IAdmissionInputs } from "./adapters/admission.ts";
import type { ModelRegistryService } from "./model_registry_service.ts";

/** Per-refresh dependency seam: how to build an adapter context / admission inputs. */
export interface IRefreshDeps {
  buildContext(provider: string): IAdapterContext;
  admissionInputsFor(provider: string): IAdmissionInputs | Promise<IAdmissionInputs>;
}

const DEFAULT_CATALOG_CRON = "0 */6 * * *";
const DEFAULT_PRICING_CRON = "0 3 * * *";
const BACKOFF_BASE_MS = 60_000; // 1 minute; doubles per consecutive failure
const DEFAULT_CRON_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h fallback when the cron is non-standard
const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_WEEK = 7 * HOURS_PER_DAY * MS_PER_HOUR;
const CRON_FIELDS = 5;

/** Map a thrown catalog error to its audit outcome (§7 exact values). */
function outcomeFor(err: Error): RegistryRefreshOutcome {
  if (err instanceof CatalogAuthError) return "auth_error";
  if (err instanceof CatalogParseError) return "parse_error";
  if (err instanceof CatalogHttpError) return "http_error";
  return "http_error";
}

/**
 * Coarse cron→interval for the back-off cap and timer cadence; not a full cron engine,
 * it recognises only the standard catalog/pricing/benchmark crons and falls back to 6h.
 */
export function cronIntervalMs(expr: string): number {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== CRON_FIELDS) return DEFAULT_CRON_INTERVAL_MS;
  const [, hour, , , dow] = parts;
  if (dow !== "*") return MS_PER_WEEK; // weekly (e.g. benchmark 0 5 * * 0)
  const stepMatch = hour.match(/^\*\/([0-9]+)$/);
  if (stepMatch) return Number(stepMatch[1]) * MS_PER_HOUR; // every N hours
  if (/^[0-9]+$/.test(hour)) return HOURS_PER_DAY * MS_PER_HOUR; // daily at a fixed hour
  return DEFAULT_CRON_INTERVAL_MS;
}

export class RegistryRefreshScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly failureCounts = new Map<string, number>();
  private readonly nextEligibleAt = new Map<string, number>();

  constructor(
    private readonly service: ModelRegistryService,
    private readonly adapters: AdapterRegistry,
    private readonly config: Config,
    private readonly logger: IEventLogger,
    private readonly deps: IRefreshDeps,
  ) {}

  private get catalogCron(): string {
    return this.config.model_registry?.catalog_refresh_cron ?? DEFAULT_CATALOG_CRON;
  }

  private get pricingCron(): string {
    return this.config.model_registry?.pricing_refresh_cron ?? DEFAULT_PRICING_CRON;
  }

  isRunning(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Validate the configured crons, honour refresh_on_start (one immediate pass), and
   * schedule the repeating timer; under DENO_TEST=1 the real timer is skipped.
   */
  start(): void {
    // Reuse the canonical 5-field validator — throws on an invalid/injecting cron.
    validateCronExpression(this.catalogCron);
    validateCronExpression(this.pricingCron);

    if (this.config.model_registry?.refresh_on_start === true) {
      // Fire-and-forget one immediate pass; failures are audited, never thrown to boot.
      void this.refreshOnce();
    }

    if (Deno.env.get("DENO_TEST") === "1") return; // no real timers under test

    const intervalMs = cronIntervalMs(this.catalogCron);
    this.timer = setInterval(() => void this.refreshOnce(), intervalMs);
  }

  /** Clear the single timer handle on daemon shutdown — no dangling handle. */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Exponential back-off for `consecutiveFailures`, capped at the cron interval. */
  nextBackoffMs(_provider: string, consecutiveFailures: number, cronIntervalMsValue: number): number {
    const raw = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, consecutiveFailures - 1));
    return Math.min(raw, cronIntervalMsValue);
  }

  /**
   * One full refresh pass over every registered adapter. Each provider is independent:
   * a failure audits + emits refresh.failed + arms back-off, never rolling back a sibling.
   */
  async refreshOnce(): Promise<void> {
    const now = Date.now();
    const cronMs = cronIntervalMs(this.catalogCron);
    for (const adapter of this.adapters.getAll()) {
      const provider = adapter.provider;
      const eligibleAt = this.nextEligibleAt.get(provider) ?? 0;
      if (eligibleAt > now) continue; // in back-off — skip this tick
      await this.refreshProvider(adapter, cronMs);
    }
  }

  private async refreshProvider(adapter: IProviderCatalogAdapter, cronMs: number): Promise<void> {
    const provider = adapter.provider;
    const ctx = this.deps.buildContext(provider);
    const startedAt = Date.now();
    try {
      const catalog = await adapter.fetchCatalog(ctx);
      const inputs = await this.deps.admissionInputsFor(provider);
      const diff = await this.service.applyRefresh(provider, catalog, inputs);
      const durationMs = Date.now() - startedAt;
      await this.service.recordRefreshAudit({
        provider,
        kind: "catalog",
        outcome: "success",
        modelsAdded: diff.added,
        modelsRemoved: diff.removed,
        startedAt,
        durationMs,
      });
      await this.emitCatalogRefreshed(provider, diff.added, diff.removed, durationMs);
      await this.refreshPricing(adapter, ctx);
      this.failureCounts.delete(provider);
      this.nextEligibleAt.delete(provider);
    } catch (err) {
      await this.handleFailure(
        provider,
        "catalog",
        err instanceof Error ? err : new Error("unknown refresh error"),
        startedAt,
        cronMs,
      );
    }
  }

  private async refreshPricing(adapter: IProviderCatalogAdapter, ctx: IAdapterContext): Promise<void> {
    if (!adapter.fetchPricing) return;
    const provider = adapter.provider;
    const startedAt = Date.now();
    try {
      const pricing = await adapter.fetchPricing(ctx);
      if (pricing.length === 0) return;
      const updated = await this.service.applyPricing(provider, pricing);
      const durationMs = Date.now() - startedAt;
      await this.service.recordRefreshAudit({
        provider,
        kind: "pricing",
        outcome: "success",
        modelsAdded: updated,
        modelsRemoved: 0,
        startedAt,
        durationMs,
      });
      await this.emitPricingRefreshed(provider, updated, durationMs);
    } catch (err) {
      await this.handleFailure(
        provider,
        "pricing",
        err instanceof Error ? err : new Error("unknown refresh error"),
        startedAt,
        cronIntervalMs(this.catalogCron),
      );
    }
  }

  private async handleFailure(
    provider: string,
    kind: RegistryRefreshKind,
    err: Error,
    startedAt: number,
    cronMs: number,
  ): Promise<void> {
    const outcome = outcomeFor(err);
    // The detail is the error message only — adapters never embed the API key (§8.2).
    const detail = err.message;
    const failures = (this.failureCounts.get(provider) ?? 0) + 1;
    this.failureCounts.set(provider, failures);
    this.nextEligibleAt.set(provider, Date.now() + this.nextBackoffMs(provider, failures, cronMs));
    await this.service.recordRefreshAudit({
      provider,
      kind,
      outcome,
      modelsAdded: 0,
      modelsRemoved: 0,
      startedAt,
      durationMs: Date.now() - startedAt,
      detail,
    });
    await this.emitRefreshFailed(provider, kind, outcome, detail);
  }

  private async emitCatalogRefreshed(
    provider: string,
    added: number,
    removed: number,
    durationMs: number,
  ): Promise<void> {
    const payload: IModelCatalogRefreshedPayload = {
      provider,
      models_added: added,
      models_removed: removed,
      duration_ms: durationMs,
    };
    await this.logger.info(DomainEventType.ModelCatalogRefreshed, provider, { ...payload });
  }

  private async emitPricingRefreshed(provider: string, updated: number, durationMs: number): Promise<void> {
    const payload: IModelPricingRefreshedPayload = {
      provider,
      prices_updated: updated,
      duration_ms: durationMs,
    };
    await this.logger.info(DomainEventType.ModelPricingRefreshed, provider, { ...payload });
  }

  private async emitRefreshFailed(
    provider: string,
    kind: RegistryRefreshKind,
    outcome: RegistryRefreshOutcome,
    detail: string,
  ): Promise<void> {
    const payload: IModelRegistryRefreshFailedPayload = { provider, kind, outcome, detail };
    await this.logger.warn(DomainEventType.ModelRegistryRefreshFailed, provider, { ...payload });
  }
}

/**
 * Construct the scheduler ONLY when model_registry.enabled === true — the opt-in gate.
 * Returns undefined otherwise, so a disabled/Solo daemon makes zero outbound calls.
 */
export function maybeCreateRefreshScheduler(
  service: ModelRegistryService,
  adapters: AdapterRegistry,
  config: Config,
  logger: IEventLogger,
  deps: IRefreshDeps,
): RegistryRefreshScheduler | undefined {
  if (config.model_registry?.enabled !== true) return undefined;
  return new RegistryRefreshScheduler(service, adapters, config, logger, deps);
}
