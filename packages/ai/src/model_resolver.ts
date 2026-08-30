/**
 * @module ModelResolver
 * @path packages/ai/src/model_resolver.ts
 * @description Phase 132 — policy-driven model routing service. Accepts IModelIntent and
 *   returns IResolvedModel with provider, model, and per-call options. Delegates provider
 *   selection to IProviderRoutingStrategy, resolves model within provider via ProviderRegistry
 *   metadata, and handles fallback iteration, thinking constraint re-resolution, and trace events.
 * @architectural-layer AI
 * @dependencies [@exaix/schemas, @exaix/core, @exaix/ai/provider_registry]
 * @related-files [packages/ai/src/provider_selector.ts, packages/ai/src/routing/provider_routing_strategy.ts]
 */

import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type {
  Config,
  EffortTier,
  IModelCallOptions,
  IModelIntent,
  IResolvedModel,
  ModelPreset,
  ModelResolutionReason,
  ModelSize,
} from "@exaix/schemas";
import { DEFAULT_MODEL_PRESETS, getDefaultModels } from "@exaix/schemas";
import { isRetryable } from "./providers/common.ts";
import type { IProviderHealthChecker, ISelectionCriteria } from "./provider_selector.ts";
import type { IProviderMetadata } from "./provider_registry.ts";
import { ProviderRegistry } from "./provider_registry.ts";
import type { IProviderRoutingStrategy } from "./routing/provider_routing_strategy.ts";
import type { IConsideredRouteInput, IResolutionStrategy } from "./i_resolution_strategy.ts";
import type { ICapabilityProfile, IModelEntry, IModelRegistry, Opt, Reason } from "@exaix/core/types";
import { DEFAULT_MOCK_MODEL, ProviderType, TaskType } from "@exaix/core/types";
import type { IRouteReason } from "@exaix/schemas";

/** The route-decision fields the route sub-step adds to the trace payload. */
interface IRouteTraceInfo {
  route_reason?: IRouteReason;
  considered_routes?: IConsideredRouteInput[];
}

/** Trailing trace metadata for emitTrace (keeps the parameter count within bounds). */
interface ITraceMeta {
  durationMs: number;
  routeInfo?: IRouteTraceInfo;
}

/** The intent fields scoreCandidates reads: characteristics and best's task_type. */
interface IScoreCandidatesIntent {
  model?: IModelIntent["model"];
  characteristics?: IModelIntent["characteristics"];
  task_type?: IModelIntent["task_type"];
}

const CHARACTERISTIC_WEIGHT = 1;
const CHARACTERISTIC_BEST = "best";
const REASON_PRESET_DEFAULT: ModelResolutionReason = "preset_default";
const REASON_CHARACTERISTICS_SCORED: ModelResolutionReason = "characteristics_scored";

/** Coerces YAML-failsafe-parsed boolean fields: `thinking: false` arrives as the string
 *  "false" (truthy in JS), which would wrongly demand a thinking-capable provider. */
function normalizeIntentBooleans(intent: IModelIntent): IModelIntent {
  const rawThinking: string | boolean | undefined = intent.thinking as string | boolean | undefined;
  if (typeof rawThinking === "string") {
    return { ...intent, thinking: rawThinking.toLowerCase() === "true" };
  }
  return intent;
}

/** @internal Map of preset override name → { model_size → resolved model } */
const OVERRIDE_MODEL_MAP: Record<string, Record<ModelSize, { provider: string; model: string }>> = {
  test: {
    S: { provider: ProviderType.MOCK, model: DEFAULT_MOCK_MODEL },
    M: { provider: ProviderType.MOCK, model: DEFAULT_MOCK_MODEL },
    L: { provider: ProviderType.MOCK, model: DEFAULT_MOCK_MODEL },
    XL: { provider: ProviderType.MOCK, model: DEFAULT_MOCK_MODEL },
  },
};

const EFFORT_MAX_TOKENS: Record<EffortTier, number> = {
  low: 1024,
  medium: 4096,
  high: 8192,
};

/** Policy-driven model resolver. Stateless — state lives in the injected dependencies.
 * @visible
 */
export class ModelResolver {
  constructor(
    private selector: IProviderRoutingStrategy,
    private config: Config,
    private healthChecker: IProviderHealthChecker,
    private eventLogger: IEventLogger,
    private modelRegistry?: Opt<IModelRegistry, Reason.OptionalDependency>,
    private strategy?: Opt<IResolutionStrategy, Reason.OptionalDependency>,
  ) {}

  /** Resolves an IModelIntent to a concrete provider:model. Precedence: explicit model
   *  override > characteristics scoring > preset default. */
  async resolve(intent: IModelIntent): Promise<IResolvedModel> {
    const startTime = Date.now();
    intent = normalizeIntentBooleans(intent);

    const overrideResult = this.tryResolveOverride(intent);
    if (overrideResult) return overrideResult;

    const explicitResult = await this.tryResolveExplicit(intent, startTime);
    if (explicitResult) return explicitResult;

    const bareNameResult = await this.tryResolveBareName(intent, startTime);
    if (bareNameResult) return bareNameResult;

    const curatedResult = await this.tryResolveCurated(intent, startTime);
    if (curatedResult) {
      return (await this.tryResolveOverflow(intent, intent, curatedResult, 1, startTime)) ?? curatedResult;
    }

    const presetResult = await this.tryResolveFromPreset(intent, startTime);
    if (presetResult) {
      return (await this.tryResolveOverflow(intent, intent, presetResult, 1, startTime)) ?? presetResult;
    }

    const fallbacks = intent.fallbacks ?? [];
    const maxAttempts = fallbacks.length + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const currentIntent = attempt === 1 ? intent : this.mergeFallback(intent, fallbacks[attempt - 2]);
      try {
        const resolved = await this.resolveOnce(
          currentIntent,
          attempt,
          startTime,
          attempt > 1 ? "fallback" : undefined,
        );
        if (resolved) {
          const overflowResult = await this.tryResolveOverflow(intent, currentIntent, resolved, attempt, startTime);
          if (overflowResult) return overflowResult;
          return resolved;
        }
      } catch (error) {
        if (error instanceof Error && isRetryable(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `Model resolution failed: no suitable model found after ${maxAttempts} attempt(s). ` +
        `Intent: ${JSON.stringify(intent)}`,
    );
  }

  private tryResolveOverride(intent: IModelIntent): IResolvedModel | null {
    const overridePreset = Deno.env.get("EXA_MODEL_PRESET_OVERRIDE");
    if (!overridePreset || !intent.model_size) return null;
    const overrideMap = OVERRIDE_MODEL_MAP[overridePreset];
    if (!overrideMap) return null;
    const resolved = overrideMap[intent.model_size];
    if (!resolved) return null;
    return { ...resolved, options: this.buildCallOptions(intent), attempt: 1 };
  }

  private async tryResolveExplicit(intent: IModelIntent, startTime: number): Promise<IResolvedModel | null> {
    if (!intent.model || !intent.model.includes(":")) return null;
    const [rawProvider, ...rest] = intent.model.split(":");
    const rawModel = rest.join(":");
    // Team seam validates/auto-admits the explicit choice against the live catalog;
    // absent (Solo) it passes the explicit choice through unchanged.
    const route = this.strategy?.validateExplicit
      ? await this.strategy.validateExplicit(rawProvider, rawModel)
      : { provider: rawProvider, model: rawModel };
    const resolved: IResolvedModel = {
      provider: route.provider,
      model: route.model,
      options: this.buildCallOptions(intent),
      attempt: 1,
    };
    await this.emitTrace(intent, resolved, [route.provider], {}, "explicit_override", {
      durationMs: Date.now() - startTime,
    });
    return resolved;
  }

  private async tryResolveBareName(intent: IModelIntent, startTime: number): Promise<IResolvedModel | null> {
    if (!intent.model || intent.model.includes(":")) return null;

    const bareName = intent.model;
    const matches: Array<{ provider: string; model: string }> = [];

    const providerMetadata = ProviderRegistry.getProviderMetadata(bareName);
    if (providerMetadata) {
      const defaults = getDefaultModels();
      matches.push({ provider: bareName, model: defaults[bareName] ?? bareName });
    }

    const presets = this.config.model_presets ?? DEFAULT_MODEL_PRESETS;
    for (const preset of Object.values(presets)) {
      if (preset.candidates?.includes(bareName)) {
        const defaults = getDefaultModels();
        matches.push({ provider: bareName, model: defaults[bareName] ?? bareName });
        break;
      }
    }

    const unique = matches.filter(
      (m, i, arr) => arr.findIndex((x) => x.provider === m.provider && x.model === m.model) === i,
    );

    if (unique.length === 0) {
      throw new Error(
        `Unknown model "${bareName}". No registered provider or curated entry matches this name.`,
      );
    }
    if (unique.length > 1) {
      const candidates = unique.map((m) => `${m.provider}:${m.model}`).join(", ");
      throw new Error(
        `Ambiguous model name "${bareName}". Did you mean one of: ${candidates}?`,
      );
    }

    const match = unique[0];
    const resolved: IResolvedModel = {
      provider: match.provider,
      model: match.model,
      options: this.buildCallOptions(intent),
      attempt: 1,
    };
    await this.emitTrace(intent, resolved, [match.provider], {}, "explicit_override", {
      durationMs: Date.now() - startTime,
    });
    return resolved;
  }

  private async tryResolveCurated(intent: IModelIntent, startTime: number): Promise<IResolvedModel | null> {
    if (!intent.model_size) return null;
    const presets = this.config.model_presets ?? DEFAULT_MODEL_PRESETS;
    const preset = presets[intent.model_size];
    if (!preset?.candidates?.length) return null;

    let ordered = [...preset.candidates];

    if (intent.characteristics?.length && preset.characteristics) {
      for (const char of intent.characteristics) {
        const subList = preset.characteristics[char];
        if (subList?.length) {
          const promoted = subList.filter((p) => ordered.includes(p));
          const remaining = ordered.filter((p) => !subList.includes(p));
          ordered = [...promoted, ...remaining];
        }
      }
    }

    const allProviders = ProviderRegistry.getAllProviders();
    for (const providerName of ordered) {
      const metadata = ProviderRegistry.getProviderMetadata(providerName);
      if (!metadata) continue;
      const healthy = await this.healthChecker.checkProvider(providerName);
      if (!healthy) continue;

      const model = this.selectModelForProvider(providerName, intent);
      if (!model) continue;

      const resolved: IResolvedModel = {
        provider: providerName,
        model,
        options: this.buildCallOptions(intent),
        attempt: 1,
      };
      const routeInfo = await this.applyRouteSubStep(resolved);
      await this.emitTrace(
        intent,
        resolved,
        allProviders.map((p) => p.metadata.name),
        {},
        "preferred_list",
        { durationMs: Date.now() - startTime, routeInfo },
      );
      return resolved;
    }

    return null;
  }

  private async tryResolveFromPreset(intent: IModelIntent, startTime: number): Promise<IResolvedModel | null> {
    if (!intent.model_size) return null;

    if (this.modelRegistry) {
      const registry = this.modelRegistry;
      // Resilience: a throwing registry must not crash resolution — return null so the
      // caller falls through to the scoring path (graceful degrade).
      let models: IModelEntry[];
      try {
        models = await registry.getModelsByCapability(this.profileFor(intent.model_size));
      } catch (_error) {
        return null;
      }
      if (models.length === 0) return null;

      // F1: for a `cheapest` intent, exclude unknown-priced models from the ranking —
      // only a genuinely known price may win cheapest. If every candidate is unknown-priced,
      // keep the full list (fall back to floor order rather than resolving nothing).
      let ordered = models;
      if (intent.characteristics?.includes("cheapest")) {
        const priced = await Promise.all(
          models.map(async (m) => ({
            entry: m,
            provenance: (await registry.getModelPricing(m.provider, m.model)).provenance,
          })),
        );
        const known = priced.filter((p) => p.provenance !== "unknown").map((p) => p.entry);
        if (known.length > 0) ordered = known;
      }
      const first = ordered[0];
      const resolved: IResolvedModel = {
        provider: first.provider,
        model: first.model,
        options: this.buildCallOptions(intent),
        attempt: 1,
      };
      const providers = ProviderRegistry.getAllProviders();
      const routeInfo = await this.applyRouteSubStep(resolved);
      await this.emitTrace(
        intent,
        resolved,
        providers.map((p) => p.metadata.name),
        {},
        REASON_PRESET_DEFAULT,
        { durationMs: Date.now() - startTime, routeInfo },
      );
      return resolved;
    }

    const presets = this.config.model_presets ?? DEFAULT_MODEL_PRESETS;
    const resolved = resolvePresetFromSize(intent.model_size, presets);
    resolved.options = this.buildCallOptions(intent);
    resolved.attempt = 1;
    const providers = ProviderRegistry.getAllProviders();
    const routeInfo = await this.applyRouteSubStep(resolved);
    await this.emitTrace(
      intent,
      resolved,
      providers.map((p) => p.metadata.name),
      {},
      REASON_PRESET_DEFAULT,
      { durationMs: Date.now() - startTime, routeInfo },
    );
    return resolved;
  }

  private async tryResolveOverflow(
    intent: IModelIntent,
    currentIntent: IModelIntent,
    resolved: IResolvedModel,
    attempt: number,
    startTime: number,
  ): Promise<IResolvedModel | null> {
    if (
      !intent.context_window_fallback ||
      !intent.estimated_input_tokens ||
      !currentIntent.model_size
    ) {
      return null;
    }

    let contextWindow: number | undefined;
    if (this.modelRegistry) {
      contextWindow = await this.modelRegistry.getContextWindow(resolved.provider, resolved.model);
    }
    if (!contextWindow || intent.estimated_input_tokens <= contextWindow) return null;

    const bumped = this.bumpModelSize(currentIntent.model_size);
    if (!bumped) return null;

    const overflowIntent = { ...currentIntent, model_size: bumped };
    const reResolved = await this.resolveOnce(overflowIntent, attempt, startTime);
    if (!reResolved) return null;

    const providers = ProviderRegistry.getAllProviders();
    await this.emitTrace(
      overflowIntent,
      reResolved,
      providers.map((p) => p.metadata.name),
      {},
      "context_window_overflow",
      { durationMs: Date.now() - startTime },
    );
    return reResolved;
  }

  private async resolveOnce(
    intent: IModelIntent,
    attempt: number,
    startTime: number,
    fallbackReason?: Opt<ModelResolutionReason, Reason.OptionalInput>,
  ): Promise<IResolvedModel | null> {
    const criteria = this.buildSelectionCriteria(intent);
    const allProviders = ProviderRegistry.getAllProviders();

    const candidates = this.applyCapabilityFilter(allProviders, intent);
    if (candidates.length === 0) return null;

    // Preferred-provider soft hint: select it directly when eligible (registered,
    // capability-filtered, healthy), skipping cross-provider scoring. Falls through
    // to the strategy when the hint cannot satisfy the intent.
    const preferredChosen = await this.tryPreferProvider(intent, candidates);
    const providerName = preferredChosen ?? await this.selector.selectProvider(criteria);
    const providerMetadata = ProviderRegistry.getProviderMetadata(providerName);
    if (!providerMetadata) return null;

    const model = this.selectModelForProvider(providerName, intent);
    if (!model) return null;

    if (intent.thinking && !providerMetadata.supportsThinking) {
      return this.resolveWithThinkingConstraint(
        intent,
        providerName,
        model,
        attempt,
        startTime,
        allProviders,
      );
    }

    // Decide the concrete winner/model/reason: the preferred hint wins directly,
    // otherwise the characteristic blend (incl. rate-limit headroom) decides over the
    // selector pick, and fallback attempts report reason "fallback".
    const { winner, model: winnerModel, reason: pickedReason, scores } = await this.decideResolvedPick(
      intent,
      candidates,
      providerName,
      preferredChosen !== null,
    );
    const reason = fallbackReason ?? pickedReason;

    const resolved: IResolvedModel = {
      provider: winner,
      model: winnerModel,
      options: this.buildCallOptions(intent),
      attempt,
    };

    // Non-pinned scored choice → apply the route policy (Team seam).
    const routeInfo = await this.applyRouteSubStep(resolved);

    await this.emitTrace(
      intent,
      resolved,
      candidates.map((p) => p.metadata.name),
      scores,
      reason,
      { durationMs: Date.now() - startTime, routeInfo },
    );

    return resolved;
  }

  /** Decides the concrete provider + model + trace reason for a non-thinking resolveOnce
   *  attempt: a preferred-provider hint wins directly, otherwise the characteristic
   *  blend decides over the selector pick. */
  private async decideResolvedPick(
    intent: IModelIntent,
    candidates: Array<{ metadata: IProviderMetadata }>,
    providerName: string,
    preferredChosen: boolean,
  ): Promise<{ winner: string; model: string; reason: ModelResolutionReason; scores: Record<string, number> }> {
    let model = this.selectModelForProvider(providerName, intent) ?? providerName;
    if (this.modelRegistry && intent.model_size) {
      // Resilience: a throwing registry must not crash resolution — keep the
      // metadata-selected model and continue via the scoring path.
      try {
        const entries = await this.modelRegistry.getModelsByCapability(this.profileFor(intent.model_size));
        if (entries.length > 0) {
          const match = entries.find((e) => e.provider === providerName);
          if (match) model = match.model;
        }
      } catch (_error) {
        // Registry unavailable — degrade to the metadata-selected model.
      }
    }

    if (preferredChosen) {
      return {
        winner: providerName,
        model,
        reason: intent.characteristics?.length ? REASON_CHARACTERISTICS_SCORED : REASON_PRESET_DEFAULT,
        scores: {},
      };
    }

    const scores = await this.scoreCandidates(candidates, intent);
    let { winner, reason } = await this.decideWinner(intent, candidates, providerName, scores);
    if (winner !== providerName) {
      const winnerModel = this.selectModelForProvider(winner, intent);
      if (winnerModel) model = winnerModel;
      else winner = providerName;
    }
    return { winner, model, reason, scores };
  }

  /** Preferred-provider soft hint — the provider name when eligible, else null. */
  private async tryPreferProvider(
    intent: IModelIntent,
    candidates: Array<{ metadata: IProviderMetadata }>,
  ): Promise<string | null> {
    const preferred = intent.preferred_provider;
    if (!preferred) return null;
    if (!candidates.some((c) => c.metadata.name === preferred)) return null;
    if (!(await this.healthChecker.checkProvider(preferred))) return null;
    return preferred;
  }

  /** The score blend decides the outcome, not just the trace: the highest-scored candidate
   *  overrides the selector's pick when it differs, gated on a health check. With no
   *  characteristics, falls to the strategy's last-resort usage tiebreak instead. */
  private async decideWinner(
    intent: IModelIntent,
    candidates: Array<{ metadata: IProviderMetadata }>,
    providerName: string,
    scores: Record<string, number>,
  ): Promise<{ winner: string; reason: ModelResolutionReason }> {
    let reason: ModelResolutionReason = intent.characteristics?.length
      ? REASON_CHARACTERISTICS_SCORED
      : REASON_PRESET_DEFAULT;
    let winner = providerName;

    if (intent.characteristics?.length && Object.keys(scores).length > 0) {
      const topScore = Math.max(...Object.values(scores));
      const winners = candidates.filter((c) => (scores[c.metadata.name] ?? -1) === topScore).map((c) =>
        c.metadata.name
      );
      if (winners.length === 1 && winners[0] !== providerName && await this.healthChecker.checkProvider(winners[0])) {
        winner = winners[0];
      }
      if (
        intent.characteristics.includes(CHARACTERISTIC_BEST) && intent.task_type &&
        intent.task_type !== TaskType.UNKNOWN &&
        await this.wasBestDecisive(intent, candidates, winner)
      ) {
        reason = "best_ranked";
      }
      return { winner, reason };
    }

    const usageWinner = await this.applyUsageTiebreak(intent, candidates);
    if (usageWinner) {
      winner = usageWinner;
      reason = "usage_ranked";
    }
    return { winner, reason };
  }

  /** `best_ranked` must reflect that `best`'s score actually decided the blended winner,
   *  not merely that `best` was requested. Re-scores the same candidate pool with `best`
   *  excluded and compares winners: an unchanged top scorer means `best` wasn't decisive. */
  private async wasBestDecisive(
    intent: IModelIntent,
    candidates: Array<{ metadata: IProviderMetadata }>,
    winner: string,
  ): Promise<boolean> {
    const withoutBest = intent.characteristics!.filter((c) => c !== CHARACTERISTIC_BEST);
    if (withoutBest.length === 0) return true; // best was the sole characteristic
    const scoresWithoutBest = await this.scoreCandidates(candidates, { ...intent, characteristics: withoutBest });
    if (Object.keys(scoresWithoutBest).length === 0) return true;
    const topScoreWithoutBest = Math.max(...Object.values(scoresWithoutBest));
    const winnersWithoutBest = candidates
      .filter((c) => (scoresWithoutBest[c.metadata.name] ?? -1) === topScoreWithoutBest)
      .map((c) => c.metadata.name);
    // best was decisive iff the winner changes (or a tie is broken) once best is removed
    return !(winnersWithoutBest.length === 1 && winnersWithoutBest[0] === winner);
  }

  /** Offers the strategy's rankUsage hook the no-characteristics candidate pool as a
   *  last-resort tiebreak. Returns the winning provider name, or null when no
   *  strategy/hook is present, the hook opts out, or the winner isn't in the pool. */
  private async applyUsageTiebreak(
    intent: IModelIntent,
    candidates: Array<{ metadata: IProviderMetadata }>,
  ): Promise<string | null> {
    if (!this.strategy?.rankUsage) return null;
    const pool = candidates.map((c) => ({
      provider: c.metadata.name,
      model: this.selectModelForProvider(c.metadata.name, intent) ?? "",
    }));
    const ranked = await this.strategy.rankUsage(pool);
    if (!ranked?.length) return null;
    return ranked.find((p) => candidates.some((c) => c.metadata.name === p)) ?? null;
  }

  private async resolveWithThinkingConstraint(
    intent: IModelIntent,
    originalProvider: string,
    originalModel: string,
    attempt: number,
    startTime: number,
    allProviders: Array<{ metadata: IProviderMetadata }>,
  ): Promise<IResolvedModel | null> {
    const thinkingCandidates = allProviders.filter((p) => p.metadata.supportsThinking);
    if (thinkingCandidates.length === 0) {
      await this.emitTrace(
        intent,
        { provider: originalProvider, model: originalModel, attempt },
        allProviders.map((p) => p.metadata.name),
        {},
        "thinking_constrained",
        { durationMs: Date.now() - startTime },
      );
      return null;
    }

    // Pick the first healthy thinking-capable provider directly, bypassing the
    // routing strategy (which already selected a non-thinking provider).
    const criteria = this.buildSelectionCriteria(intent);
    const filtered = thinkingCandidates.filter((p) =>
      criteria.requiredCapabilities?.every((cap) => p.metadata.capabilities.includes(cap)) ?? true
    );
    if (filtered.length === 0) return null;

    const chosen = filtered[0];
    const thinkingProvider = chosen.metadata.name;
    const thinkingModel = this.selectModelForProvider(thinkingProvider, intent);
    if (!thinkingModel) return null;

    const resolved: IResolvedModel = {
      provider: thinkingProvider,
      model: thinkingModel,
      options: this.buildCallOptions(intent),
      attempt,
    };

    await this.emitTrace(
      intent,
      resolved,
      allProviders.map((p) => p.metadata.name),
      {},
      "thinking_constrained",
      { durationMs: Date.now() - startTime },
    );

    return resolved;
  }

  private profileFor(size: ModelSize): ICapabilityProfile {
    const presets = this.config.model_presets ?? DEFAULT_MODEL_PRESETS;
    const profile = presets[size];
    if (!profile) return {};
    return {
      minContextWindow: profile.min_context_window,
      maxCostPerMillionTokens: profile.max_cost_per_mtok,
      supportsThinking: profile.supports_thinking,
    };
  }

  private buildSelectionCriteria(intent: IModelIntent): ISelectionCriteria {
    return {
      preferFree: intent.max_cost_usd === 0,
      maxCostUsd: intent.max_cost_usd,
      allowLocal: intent.allow_local,
      requiredCapabilities: intent.required_capabilities ?? ["chat"],
      characteristics: intent.characteristics,
    };
  }

  private applyCapabilityFilter(
    providers: Array<{ metadata: IProviderMetadata }>,
    intent: IModelIntent,
  ): Array<{ metadata: IProviderMetadata }> {
    if (!intent.required_capabilities?.length) return providers;
    return providers.filter((p) => intent.required_capabilities!.every((cap) => p.metadata.capabilities.includes(cap)));
  }

  private selectModelForProvider(
    providerName: string,
    intent: Pick<IModelIntent, "model">,
  ): string | null {
    if (intent.model && !intent.model.includes(":")) {
      return intent.model;
    }
    const defaults = getDefaultModels();
    if (defaults[providerName]) return defaults[providerName];
    return providerName;
  }

  /** Async so `best` can pull benchmark scores from the Team seam into the same weighted
   *  blend as `cheapest`/`fastest`. Skips `best` when no strategy/hook is registered
   *  (Solo) or task_type is UNKNOWN/absent. */
  private async scoreCandidates(
    candidates: Array<{ metadata: IProviderMetadata }>,
    intent: IScoreCandidatesIntent,
  ): Promise<Record<string, number>> {
    const scores: Record<string, number> = {};
    const characteristics = intent.characteristics;
    if (!characteristics?.length) return scores;

    const maxCost = Math.max(
      ...candidates.map((p) => p.metadata.costPerMtok ?? 0),
      1,
    );

    let bestScores: Record<string, number> = {};
    if (
      characteristics.includes(CHARACTERISTIC_BEST) && this.strategy?.scoreBest &&
      intent.task_type && intent.task_type !== TaskType.UNKNOWN
    ) {
      bestScores = await this.strategy.scoreBest(
        candidates.map((c) => ({
          provider: c.metadata.name,
          model: this.selectModelForProvider(c.metadata.name, intent) ?? "",
        })),
        intent.task_type,
      );
    }

    for (const p of candidates) {
      let totalScore = 0;
      let weightSum = 0;

      for (const char of characteristics) {
        weightSum += CHARACTERISTIC_WEIGHT;
        switch (char) {
          case "cheapest":
            totalScore += CHARACTERISTIC_WEIGHT * (1 - ((p.metadata.costPerMtok ?? 0) / maxCost));
            break;
          case "fastest":
            totalScore += CHARACTERISTIC_WEIGHT * 1;
            break;
          case CHARACTERISTIC_BEST:
            totalScore += CHARACTERISTIC_WEIGHT * (bestScores[p.metadata.name] ?? 0);
            break;
          default:
            totalScore += CHARACTERISTIC_WEIGHT * 1;
            break;
        }
      }

      const characteristicsScore = weightSum > 0 ? totalScore / weightSum : 0;
      scores[p.metadata.name] = await this.applyRateLimitBlend(p.metadata.name, characteristicsScore);
    }

    return scores;
  }

  /** finalScore = characteristicsScore * (1 - weight) + (remaining/maxRpm) * weight.
   *  Only active when rate_limit_weight > 0 and a registry rate-limit view is available;
   *  any failure degrades to the unblended score. */
  private async applyRateLimitBlend(provider: string, characteristicsScore: number): Promise<number> {
    const weight = this.config.provider_strategy?.rate_limit_weight;
    if (!weight || weight <= 0 || !this.modelRegistry) return characteristicsScore;
    try {
      const status = await this.modelRegistry.getRateLimit(provider);
      if (!status || status.maxRpm <= 0) return characteristicsScore;
      const rateLimitScore = Math.max(0, Math.min(1, status.remaining / status.maxRpm));
      return characteristicsScore * (1 - weight) + rateLimitScore * weight;
    } catch (_error) {
      return characteristicsScore;
    }
  }

  private buildCallOptions(intent: IModelIntent): IModelCallOptions | undefined {
    if (!intent.thinking && !intent.effort) return undefined;
    const options: IModelCallOptions = {};
    if (intent.thinking) options.thinking = true;
    if (intent.effort) {
      options.effort = intent.effort;
      options.max_tokens = EFFORT_MAX_TOKENS[intent.effort];
    }
    return options;
  }

  private mergeFallback(base: IModelIntent, fallback: Partial<IModelIntent>): IModelIntent {
    return { ...base, ...fallback };
  }

  private bumpModelSize(size: ModelSize): ModelSize | null {
    switch (size) {
      case "S":
        return "M";
      case "M":
        return "L";
      case "L":
        return "XL";
      case "XL":
        return null;
      default:
        return null;
    }
  }

  private async emitTrace(
    intent: IModelIntent,
    resolved: IResolvedModel,
    candidateProviders: string[],
    scores: Record<string, number>,
    reason: ModelResolutionReason,
    meta: ITraceMeta,
  ): Promise<void> {
    const routeInfo = meta.routeInfo;
    const consideredRoutes = (routeInfo?.considered_routes ?? []).map((r) => ({
      provider: r.provider,
      health_score: r.health_score,
      ...(r.price !== undefined ? { price: r.price } : {}),
    }));
    await this.eventLogger.info(DomainEventType.ModelResolved, resolved.model, {
      intent: this.traceIntent(intent),
      candidate_providers: candidateProviders,
      scores,
      selected: { provider: resolved.provider, model: resolved.model, attempt: resolved.attempt ?? 1 },
      reason,
      duration_ms: meta.durationMs,
      // Route decision on the journalled trace payload.
      ...(routeInfo?.route_reason ? { route_reason: routeInfo.route_reason } : {}),
      ...(consideredRoutes.length > 0 ? { considered_routes: consideredRoutes } : {}),
      // Task-type derivation source, additive on the trace.
      ...(intent.task_type_source ? { task_type_source: intent.task_type_source } : {}),
    });
  }

  /** The intent subset the typed IModelResolutionTraceEventPayload declares. */
  private traceIntent(intent: IModelIntent): {
    model_size?: ModelSize;
    thinking?: boolean;
    effort?: EffortTier;
    characteristics?: string[];
    required_capabilities?: string[];
    preferred_provider?: string;
    model?: string;
    task_type?: IModelIntent["task_type"];
    task_type_source?: IModelIntent["task_type_source"];
  } {
    return {
      model_size: intent.model_size,
      thinking: intent.thinking,
      effort: intent.effort,
      characteristics: intent.characteristics,
      required_capabilities: intent.required_capabilities,
      preferred_provider: intent.preferred_provider,
      model: intent.model,
      task_type: intent.task_type,
      task_type_source: intent.task_type_source,
    };
  }

  /** Applies the Team seam's selectRoute to a non-pinned scored choice. Mutates `resolved`
   *  in place (provider + route_reason) and returns the trace info. No strategy / no
   *  selectRoute hook (Solo) ⇒ inert: returns empty info and leaves `resolved` untouched. */
  private async applyRouteSubStep(resolved: IResolvedModel): Promise<IRouteTraceInfo> {
    if (!this.strategy?.selectRoute) return {};
    const selection = await this.strategy.selectRoute({ provider: resolved.provider, model: resolved.model });
    resolved.provider = selection.provider;
    resolved.model = selection.model;
    resolved.route_reason = selection.route_reason;
    return { route_reason: selection.route_reason, considered_routes: selection.considered_routes };
  }
}

/** Resolves a model_size to a concrete provider by applying the preset profile's
 *  constraints (cost, context window, thinking) against registered providers. */
export function resolvePresetFromSize(
  size: string,
  configPresets: Record<string, ModelPreset> = DEFAULT_MODEL_PRESETS,
): IResolvedModel {
  const profile = configPresets[size];
  if (!profile) {
    throw new Error(`No preset profile found for model_size "${size}"`);
  }

  const candidates = ProviderRegistry.getAllProviders();

  // Filter by context window
  const windowFiltered = candidates.filter(
    (p) => (p.metadata.contextWindow ?? 0) >= profile.min_context_window,
  );
  if (windowFiltered.length === 0) {
    throw new Error(`No provider meets min_context_window ${profile.min_context_window} for size "${size}"`);
  }

  // Filter by cost
  const costFiltered = windowFiltered.filter(
    (p) => (p.metadata.costPerMtok ?? 0) <= profile.max_cost_per_mtok || !p.metadata.costPerMtok,
  );
  if (costFiltered.length === 0) {
    throw new Error(`No provider meets max_cost_per_mtok ${profile.max_cost_per_mtok} for size "${size}"`);
  }

  // Filter by thinking
  const thinkingFiltered = profile.supports_thinking
    ? costFiltered.filter((p) => p.metadata.supportsThinking !== false)
    : costFiltered;

  if (thinkingFiltered.length === 0) {
    throw new Error(`No provider meets thinking=${profile.supports_thinking} for size "${size}"`);
  }

  const chosen = thinkingFiltered[0];
  const defaults = getDefaultModels();
  return { provider: chosen.metadata.name, model: defaults[chosen.metadata.name] ?? chosen.metadata.name, attempt: 1 };
}
