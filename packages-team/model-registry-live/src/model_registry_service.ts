/**
 * @module ModelRegistryService
 * @path packages-team/model-registry-live/src/model_registry_service.ts
 * @description Phase 135 Step 1 — Team live model registry over the §5.2 SQLite
 *   tables. Implements the 13-method IModelRegistry contract with a floor fallback:
 *   when a catalog/pricing row is absent, every read delegates to the injected
 *   DefaultModelRegistry so a Team daemon with an empty catalog behaves like Solo.
 *   getProviderHealth delegates to the injected checker (F3 — no health state).
 * @architectural-layer Team-ModelRegistry
 * @dependencies [@exaix/core/types, @exaix/core/events, @exaix/model-registry]
 * @related-files [packages/core/src/types/i_model_registry.ts, apps/daemon/src/bootstrap_team.ts]
 */
import {
  HealthStatus,
  type ICapabilityProfile,
  type IDatabaseService,
  type ILatencyStats,
  type IModelEntry,
  type IModelPricing,
  type IModelRegistry,
  type IRateLimitStatus,
  type LogMetadata,
  type PricingProvenance,
} from "@exaix/core/types";
import type { IEventLogger } from "@exaix/core/logger";
import {
  DomainEventType,
  type IModelAdmittedPayload,
  type IModelBenchmarkRefreshedPayload,
  type IModelPricingStalePayload,
  type IModelRetiredPayload,
  type RegistryRefreshKind,
  type RegistryRefreshOutcome,
} from "@exaix/core/events";
import type { ICatalogEntry, IPricingEntry } from "@exaix/model-registry";
import type { Config } from "@exaix/schemas";
import { admit, type IAdmissionInputs } from "./adapters/admission.ts";

/** Per-provider catalog diff returned by applyRefresh (feeds the refresh audit + event). */
export interface IRefreshDiff {
  added: number;
  removed: number;
}

export type BenchmarkProvenance = "static" | "remote_static";

/** `score` MUST be normalised to [0,1]. */
export interface IBenchmarkEntry {
  provider: string;
  model: string;
  benchmark: string;
  score: number;
  provenance: BenchmarkProvenance;
  measuredAt: number;
  harnessVersion?: string;
  sourceUrl?: string;
}

/** `detail` MUST be credential-scrubbed by the caller. */
export interface IRefreshAuditRow {
  provider: string;
  kind: RegistryRefreshKind;
  outcome: RegistryRefreshOutcome;
  modelsAdded: number;
  modelsRemoved: number;
  startedAt: number;
  durationMs: number;
  detail?: string;
}

const DEFAULT_PRICE_STALENESS_MAX_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BENCHMARK_SCORE_MIN = 0;
const BENCHMARK_SCORE_MAX = 1;

interface IHealthCheckerLike {
  checkProvider(providerName: string): Promise<boolean>;
}

interface ICatalogRow {
  provider: string;
  model: string;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_thinking: number;
  supports_effort: number;
}

interface IPricingRow {
  provider: string;
  model: string;
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  provenance: string;
  verified_at: number | null;
  source_url: string | null;
}

interface ILatencyRow {
  latency_ms: number;
  recorded_at: number;
}

interface IRateLimitRow {
  remaining: number;
  max_rpm: number;
  reset_at: number;
}

const DEFAULT_RATE_LIMIT_MAX_RPM = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

export class ModelRegistryService implements IModelRegistry {
  constructor(
    private readonly db: IDatabaseService,
    private readonly eventLogger: IEventLogger,
    private readonly config: Config,
    private readonly floor: IModelRegistry,
    private readonly healthChecker: IHealthCheckerLike,
  ) {}

  private get stalenessMaxDays(): number {
    return this.config.model_registry?.price_staleness_max_days ?? DEFAULT_PRICE_STALENESS_MAX_DAYS;
  }

  async getModelsByCapability(profile: ICapabilityProfile): Promise<IModelEntry[]> {
    const rows = await this.db.preparedAll<ICatalogRow>("SELECT * FROM model_catalog");
    if (rows.length === 0) return this.floor.getModelsByCapability(profile);
    const entries = await Promise.all(rows.map((r) => this.rowToEntry(r)));
    return entries.filter((e) => this.matchesProfile(e, profile));
  }

  /** Unlike its siblings, no floor fallback: routes are a live-catalog-only concept. */
  async getModelRoutes(model: string): Promise<Array<{ provider: string; model: string }>> {
    const rows = await this.db.preparedAll<{ provider: string }>(
      "SELECT provider FROM model_catalog WHERE model = ? ORDER BY provider ASC",
      [model],
    );
    return rows.map((r) => ({ provider: r.provider, model }));
  }

  async getModelCapability(provider: string, model: string): Promise<ICapabilityProfile> {
    const row = await this.catalogRow(provider, model);
    if (!row) return this.floor.getModelCapability(provider, model);
    return {
      minContextWindow: row.context_window ?? undefined,
      supportsThinking: row.supports_thinking === 1,
      supportsEffort: row.supports_effort === 1,
    };
  }

  async getProviderModels(provider: string): Promise<IModelEntry[]> {
    const rows = await this.db.preparedAll<ICatalogRow>(
      "SELECT * FROM model_catalog WHERE provider = ?",
      [provider],
    );
    if (rows.length === 0) return this.floor.getProviderModels(provider);
    return Promise.all(rows.map((r) => this.rowToEntry(r)));
  }

  async getAllProviders(): Promise<string[]> {
    const rows = await this.db.preparedAll<{ provider: string }>(
      "SELECT DISTINCT provider FROM model_catalog",
    );
    if (rows.length === 0) return this.floor.getAllProviders();
    return rows.map((r) => r.provider);
  }

  async getModelCost(provider: string, model: string): Promise<number> {
    const pricing = await this.pricingRow(provider, model);
    if (pricing?.input_per_mtok != null) return pricing.input_per_mtok;
    return this.floor.getModelCost(provider, model);
  }

  async getContextWindow(provider: string, model: string): Promise<number> {
    const row = await this.catalogRow(provider, model);
    if (row?.context_window != null) return row.context_window;
    return this.floor.getContextWindow(provider, model);
  }

  async getModelPricing(provider: string, model: string): Promise<IModelPricing> {
    const row = await this.pricingRow(provider, model);
    if (!row) return this.floor.getModelPricing(provider, model);
    await this.emitIfStale(row);
    return {
      provider,
      model,
      inputPerMtok: row.input_per_mtok ?? undefined,
      outputPerMtok: row.output_per_mtok ?? undefined,
      provenance: row.provenance as PricingProvenance,
      verifiedAt: row.verified_at ?? undefined,
      sourceUrl: row.source_url ?? undefined,
    };
  }

  async recordLatency(provider: string, model: string, latencyMs: number): Promise<void> {
    await this.db.preparedRun(
      "INSERT INTO model_latency (provider, model, latency_ms, recorded_at) VALUES (?, ?, ?, ?)",
      [provider, model, latencyMs, Date.now()],
    );
  }

  async getLatencyStats(provider: string, model: string): Promise<ILatencyStats> {
    const rows = await this.db.preparedAll<ILatencyRow>(
      "SELECT latency_ms, recorded_at FROM model_latency WHERE provider = ? AND model = ? ORDER BY latency_ms ASC",
      [provider, model],
    );
    if (rows.length === 0) return this.floor.getLatencyStats(provider, model);
    const values = rows.map((r) => r.latency_ms);
    return {
      p50Ms: this.percentile(values, 0.5),
      p95Ms: this.percentile(values, 0.95),
      p99Ms: this.percentile(values, 0.99),
      sampleCount: values.length,
      lastUpdated: Math.max(...rows.map((r) => r.recorded_at)),
    };
  }

  async rankByLatency(candidates: Array<{ provider: string; model: string }>): Promise<string[]> {
    const scored = await Promise.all(
      candidates.map(async (c) => {
        const stats = await this.getLatencyStats(c.provider, c.model).catch(() => null);
        return { key: `${c.provider}:${c.model}`, p95: stats?.p95Ms ?? Number.POSITIVE_INFINITY };
      }),
    );
    return scored.sort((a, b) => a.p95 - b.p95).map((s) => s.key);
  }

  async recordCall(provider: string): Promise<void> {
    const existing = await this.db.preparedGet<IRateLimitRow>(
      "SELECT remaining, max_rpm, reset_at FROM provider_rate_limit WHERE provider = ?",
      [provider],
    );
    const now = Date.now();
    if (!existing || existing.reset_at <= now) {
      await this.db.preparedRun(
        `INSERT INTO provider_rate_limit (provider, remaining, max_rpm, reset_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET remaining = excluded.remaining, reset_at = excluded.reset_at`,
        [provider, DEFAULT_RATE_LIMIT_MAX_RPM - 1, DEFAULT_RATE_LIMIT_MAX_RPM, now + RATE_LIMIT_WINDOW_MS],
      );
      return;
    }
    await this.db.preparedRun(
      "UPDATE provider_rate_limit SET remaining = MAX(0, remaining - 1) WHERE provider = ?",
      [provider],
    );
  }

  async getRateLimit(provider: string): Promise<IRateLimitStatus> {
    const row = await this.db.preparedGet<IRateLimitRow>(
      "SELECT remaining, max_rpm, reset_at FROM provider_rate_limit WHERE provider = ?",
      [provider],
    );
    if (!row) return this.floor.getRateLimit(provider);
    return { remaining: row.remaining, maxRpm: row.max_rpm, resetAt: row.reset_at };
  }

  getProviderHealth(provider: string): Promise<HealthStatus> {
    return this.healthChecker.checkProvider(provider).then((healthy) =>
      healthy ? HealthStatus.HEALTHY : HealthStatus.DEGRADED
    );
  }

  private catalogRow(provider: string, model: string): Promise<ICatalogRow | null> {
    return this.db.preparedGet<ICatalogRow>(
      "SELECT * FROM model_catalog WHERE provider = ? AND model = ?",
      [provider, model],
    );
  }

  private pricingRow(provider: string, model: string): Promise<IPricingRow | null> {
    return this.db.preparedGet<IPricingRow>(
      "SELECT * FROM model_pricing WHERE provider = ? AND model = ?",
      [provider, model],
    );
  }

  private async emitIfStale(row: IPricingRow): Promise<void> {
    if (row.provenance !== "static" || row.verified_at == null) return;
    const ageDays = (Date.now() - row.verified_at) / MS_PER_DAY;
    if (ageDays <= this.stalenessMaxDays) return;
    const payload: IModelPricingStalePayload = {
      provider: row.provider,
      model: row.model,
      provenance: row.provenance,
      verified_at: row.verified_at,
      age_days: Math.round(ageDays),
      staleness_max_days: this.stalenessMaxDays,
    };
    // IModelPricingStalePayload is all string/number → a valid LogMetadata (JSONObject).
    const metadata: LogMetadata = { ...payload };
    await this.eventLogger.info(
      DomainEventType.ModelPricingStale,
      `${row.provider}:${row.model}`,
      metadata,
    );
  }

  private async rowToEntry(row: ICatalogRow): Promise<IModelEntry> {
    const contextWindow = row.context_window ?? 0;
    const cost = await this.getModelCost(row.provider, row.model);
    return {
      provider: row.provider,
      model: row.model,
      capabilities: {
        minContextWindow: contextWindow,
        supportsThinking: row.supports_thinking === 1,
        supportsEffort: row.supports_effort === 1,
        maxCostPerMillionTokens: cost,
      },
      contextWindow,
      costPer1kTokens: cost / 1000,
    };
  }

  private matchesProfile(entry: IModelEntry, profile: ICapabilityProfile): boolean {
    if (profile.minContextWindow !== undefined && entry.contextWindow < profile.minContextWindow) {
      return false;
    }
    if (profile.supportsThinking === true && entry.capabilities.supportsThinking !== true) {
      return false;
    }
    if (profile.supportsEffort === true && entry.capabilities.supportsEffort !== true) {
      return false;
    }
    return true;
  }

  private percentile(sortedAsc: number[], q: number): number {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.floor(q * sortedAsc.length));
    return sortedAsc[idx];
  }

  /** The adapter returns the FULL catalog; admission keeps only curated ∪ native ∪ previously-used. Persistence is
   *  all-or-nothing per provider via BEGIN IMMEDIATE / COMMIT. */
  async applyRefresh(
    provider: string,
    entries: ICatalogEntry[],
    inputs: IAdmissionInputs,
  ): Promise<IRefreshDiff> {
    const admitted = admit(entries, inputs);
    const previous = await this.db.preparedAll<{ model: string; refreshed_at: number }>(
      "SELECT model, refreshed_at FROM model_catalog WHERE provider = ?",
      [provider],
    );
    const previousModels = new Set(previous.map((p) => p.model));
    const now = Date.now();

    await this.db.preparedRun("BEGIN IMMEDIATE");
    try {
      await this.db.preparedRun("DELETE FROM model_catalog WHERE provider = ?", [provider]);
      for (const { entry } of admitted) {
        await this.db.preparedRun(
          `INSERT INTO model_catalog
             (provider, model, display_name, context_window, max_output_tokens,
              supports_thinking, supports_effort, capabilities_json, source, refreshed_at, released_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            provider,
            requireModel(entry.model),
            entry.displayName ?? null,
            entry.contextWindow ?? null,
            entry.maxOutputTokens ?? null,
            entry.supportsThinking ? 1 : 0,
            entry.supportsEffort ? 1 : 0,
            entry.rawCapabilities !== undefined ? JSON.stringify(entry.rawCapabilities) : null,
            "endpoint",
            now,
            entry.releasedAt ?? null,
          ],
        );
      }
      await this.db.preparedRun("COMMIT");
    } catch (e) {
      await this.db.preparedRun("ROLLBACK").catch(() => {});
      throw e;
    }

    const admittedModels = new Set(admitted.map((a) => a.entry.model));
    let removed = 0;
    for (const { entry, reason } of admitted) {
      await this.emitAdmitted(provider, entry.model, reason);
    }
    for (const prev of previous) {
      if (!admittedModels.has(prev.model)) {
        await this.emitRetired(provider, prev.model, prev.refreshed_at);
        removed++;
      }
    }
    // "added" = admitted models not present before this refresh.
    const added = [...admittedModels].filter((m) => !previousModels.has(m)).length;
    return { added, removed };
  }

  /** Atomic per-provider swap, same all-or-nothing discipline as applyRefresh. */
  async applyPricing(provider: string, entries: IPricingEntry[]): Promise<number> {
    const now = Date.now();
    await this.db.preparedRun("BEGIN IMMEDIATE");
    try {
      await this.db.preparedRun("DELETE FROM model_pricing WHERE provider = ?", [provider]);
      for (const entry of entries) {
        await this.db.preparedRun(
          `INSERT INTO model_pricing
             (provider, model, input_per_mtok, output_per_mtok, provenance, verified_at, source_url)
           VALUES (?, ?, ?, ?, 'endpoint', ?, ?)`,
          [provider, requireModel(entry.model), entry.inputPerMtok, entry.outputPerMtok, now, entry.sourceUrl],
        );
      }
      await this.db.preparedRun("COMMIT");
    } catch (e) {
      await this.db.preparedRun("ROLLBACK").catch(() => {});
      throw e;
    }
    return entries.length;
  }

  /** `detail` is caller-scrubbed and MUST NOT contain credentials (the column comment is binding). */
  async recordRefreshAudit(row: IRefreshAuditRow): Promise<void> {
    await this.db.preparedRun(
      `INSERT INTO registry_refresh_audit
         (provider, kind, outcome, models_added, models_removed, started_at, duration_ms, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.provider,
        row.kind,
        row.outcome,
        row.modelsAdded,
        row.modelsRemoved,
        row.startedAt,
        row.durationMs,
        row.detail ?? null,
      ],
    );
  }

  /** Every score is validated BEFORE any write — an out-of-range score is rejected, not
   *  clamped, leaving existing rows untouched. */
  async applyBenchmarks(entries: IBenchmarkEntry[]): Promise<number> {
    for (const e of entries) {
      if (!(e.score >= BENCHMARK_SCORE_MIN && e.score <= BENCHMARK_SCORE_MAX)) {
        throw new Error(`benchmark score out of range [0,1]: ${e.model}/${e.benchmark}=${e.score}`);
      }
    }
    for (const e of entries) {
      await this.db.preparedRun(
        `INSERT INTO model_benchmark
           (provider, model, benchmark, score, harness_version, provenance, measured_at, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, model, benchmark) DO UPDATE SET
           score = excluded.score, harness_version = excluded.harness_version,
           provenance = excluded.provenance, measured_at = excluded.measured_at,
           source_url = excluded.source_url`,
        [
          e.provider,
          requireModel(e.model),
          e.benchmark,
          e.score,
          e.harnessVersion ?? null,
          e.provenance,
          e.measuredAt,
          e.sourceUrl ?? null,
        ],
      );
    }
    return entries.length;
  }

  /** Read one benchmark score, or undefined when unscored. */
  async getBenchmark(provider: string, model: string, benchmark: string): Promise<number | undefined> {
    const row = await this.db.preparedGet<{ score: number }>(
      "SELECT score FROM model_benchmark WHERE provider = ? AND model = ? AND benchmark = ?",
      [provider, model, benchmark],
    );
    return row?.score;
  }

  /** Feeds the admission filter's benchmark_topn path: top-`topN` of ANY tracked benchmark. */
  async getBenchmarkTopN(trackedBenchmarks: string[], topN: number): Promise<Set<string>> {
    const top = new Set<string>();
    for (const benchmark of trackedBenchmarks) {
      const rows = await this.db.preparedAll<{ model: string }>(
        "SELECT model FROM model_benchmark WHERE benchmark = ? ORDER BY score DESC LIMIT ?",
        [benchmark, topN],
      );
      for (const r of rows) top.add(r.model);
    }
    return top;
  }

  /** MFU (most-frequently-used) then MRU (most-recently-used) usage rank — a read-model
   *  over provider_costs, no new persistence. */
  async getUsageRank(): Promise<Array<{ provider: string; model: string }>> {
    const rows = await this.db.preparedAll<{ provider: string; model: string }>(
      `SELECT provider, model FROM provider_costs
       GROUP BY provider, model
       ORDER BY SUM(requests) DESC, MAX(timestamp) DESC`,
    );
    return rows;
  }

  async emitBenchmarkRefreshed(
    benchmark: string,
    scoresWritten: number,
    outcome: RegistryRefreshOutcome,
  ): Promise<void> {
    const payload: IModelBenchmarkRefreshedPayload = { benchmark, scores_written: scoresWritten, outcome };
    await this.eventLogger.info(DomainEventType.ModelBenchmarkRefreshed, benchmark, { ...payload });
  }

  private async emitAdmitted(
    provider: string,
    model: string,
    reason: IModelAdmittedPayload["reason"],
  ): Promise<void> {
    const payload: IModelAdmittedPayload = { provider, model, reason };
    await this.eventLogger.info(DomainEventType.ModelAdmitted, `${provider}:${model}`, { ...payload });
  }

  private async emitRetired(provider: string, model: string, lastSeenAt: number): Promise<void> {
    const payload: IModelRetiredPayload = { provider, model, last_seen_at: lastSeenAt };
    await this.eventLogger.info(DomainEventType.ModelRetired, `${provider}:${model}`, { ...payload });
  }
}

/** Guard against a null/empty model slipping into a catalog write (all-or-nothing). */
function requireModel(model: string): string {
  if (typeof model !== "string" || model.length === 0) {
    throw new Error("catalog entry has an invalid (null/empty) model id");
  }
  return model;
}
