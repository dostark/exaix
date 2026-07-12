# Model Resolution

- **Version:** 0.1.0
- **Date:** 2026-07-12

How Exaix decides which provider and model actually handle a request or plan step — the
precedence chain, curation, live model catalogs, routing, cost accuracy, and how to
observe every decision in the Activity Journal.

This document covers both editions. **Solo** ships a static, offline model floor.
**Team** adds a live, continuously-refreshed catalog with admission control, multi-route
pricing, benchmark-driven ranking, and split-priced cost accounting. Everything Solo does
still works unchanged in Team — Team only adds capability, it never removes or silently
changes Solo behaviour.

For the request-side flags (`--model-size`, `--characteristic`, `--thinking`, etc.) and
the Solo curation walkthrough, see the "Request Commands" section of
[`docs/Exaix_User_Guide.md`](Exaix_User_Guide.md). This document is the deeper reference
for how those inputs are actually resolved, and what Team adds on top.

---

## 1. The mental model

Every request or plan step carries a **ModelIntent** — a bag of preferences, not a
command. Callers rarely build one by hand; it's assembled from:

- The identity blueprint's own `model:`, `model_size:`, `characteristics:`, `task_type:`
  frontmatter.
- CLI flags on `exactl request` (`--model-size`, `--characteristic`, `--thinking`,
  `--effort`, `--preferred-provider`, `--model`).
- A matched skill's `triggers.task_types` (when frontmatter and identity are silent).

`ModelResolver.resolve()` takes that intent and returns exactly one `provider:model`
pair, with the full reasoning trace journalled as a `model.resolved` event. Nothing about
resolution is silent — every decision is auditable after the fact:

```bash
exactl logs --filter action_type=model.resolved --format json
```

## 2. Resolution precedence

`resolve()` tries the following in order and stops at the first match:

1. **Explicit `provider:model`** (e.g. `model: "anthropic:claude-opus-4.5"` in a
   blueprint, or `--model anthropic:claude-opus-4.5` on the CLI) — passed through
   almost as-is. Reason: `explicit_override`.
   - **Solo:** no validation against a catalog — a typo surfaces as a provider error at
     call time.
   - **Team:** validated against the live catalog first (§4). A real-but-unadmitted
     model is auto-admitted on the spot rather than rejected (§4.3).
2. **Bare model name** (no colon, e.g. `model: "claude-opus-4.5"`) — matched against a
   registered provider name or a curated-list entry. Ambiguous names (matching more than
   one provider's model) are rejected with the candidates listed.
3. **Curated list** for the requested `model_size` (`model_presets.<SIZE>.candidates`) —
   the first healthy, registered provider in the list wins. Reason: `preferred_list`.
4. **Capability + characteristic scoring** across every registered provider — the
   general case for a `--model-size` request with no curated list. Reason:
   `preset_default` (no characteristics) or `characteristics_scored`
   (`best_ranked`/`usage_ranked` are specialisations of this branch, §3).

A **model-size fallback chain** and a **context-window overflow** re-resolution both sit
on top of this: if the model an intent resolves to can't actually serve the prompt (too
small a context window, or the provider is unhealthy), the resolver bumps the size tier
(S→M→L→XL) or walks the `fallbacks` list before giving up.

## 3. Characteristics: soft ranking, not hard filters

`characteristics` (e.g. `["cheapest"]`, `["fastest"]`, `["best"]`) never eliminate a
candidate — they weight a score. Multiple characteristics blend into one weighted order;
`["best", "cheapest"]` is a single ranking pass, not a best-only override followed by a
cheapest tiebreak.

| Characteristic | What it scores                                                                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cheapest`     | Inverse of per-Mtok cost, normalised across candidates. Local/free providers are exempt from budget filtering entirely — they can win even under a tight `max_cost_usd`. An unknown-priced model is never treated as cheapest; only a genuinely known price qualifies. |
| `fastest`      | Flat weight today (provider latency scoring is not yet differentiated).                                                                                                                                                                                                |
| `best`         | **Team only.** Benchmark-driven ranking — see §3.1. Silently skipped (never mis-ranks) in Solo, or when `task_type` is absent/`unknown`.                                                                                                                               |

### 3.1 `best` — benchmark-driven ranking (Team)

`best` asks: "of the providers that can serve this request, which one performs best on
benchmarks relevant to this _kind_ of task?" It needs a **task type** to look up:

1. `deriveTaskType` resolves a `TaskType` (`feature`, `bugfix`, `refactor`, `docs`,
   `analysis`, `infra`, `security`, `test`, `commit`, or `unknown`) via a strict
   precedence chain — request frontmatter beats identity blueprint declaration beats the
   highest-confidence matched skill's `triggers.task_types` beats a static
   `model_registry.task_type_map` soft-match beats the request analyzer's inferred
   intent. An entity's own declaration is never silently overridden by the static map.
2. `model_registry.benchmark_map` maps that task type to one or more tracked benchmarks
   (e.g. `feature` → `swe_bench_verified`, `swe_bench_pro`).
3. Each candidate provider's model is looked up in the benchmark score table; the
   highest-scoring candidate wins that portion of the blend.
4. If a candidate has no score for any mapped benchmark, it's skipped for `best`
   scoring — it does not get penalised to zero, it simply doesn't contribute (honest
   degradation, not a hidden zero).

When `best` genuinely decides the winner (not merely present in the mix but the
deciding factor), `model.resolved` carries `reason: "best_ranked"` and
`task_type_source` names which precedence tier supplied the task type.

### 3.2 Usage tiebreak (Team, opt-in)

When no `characteristics` are given at all — a bare `--model-size` request with no
curated list and no ranking hint — resolution would otherwise fall to whichever provider
happens to be selected first. With `model_registry.usage_tiebreak = true` (default
`false`), the Team registry instead ranks the candidate pool by most/least-frequently-used
and picks deterministically. Reason: `usage_ranked`.

## 4. The Team live model catalog

Solo's model floor is static — a curated overlay shipped with the binary, refreshed only
when you upgrade. Team adds `ModelRegistryService`: a live catalog stored in SQLite,
refreshed from each provider's real model-listing endpoint on a schedule.

Enable it with:

```toml
[model_registry]
enabled = true
refresh_on_start = false          # true = one immediate refresh pass at boot
catalog_refresh_cron = "0 */6 * * *"   # every 6 hours by default
pricing_refresh_cron = "0 3 * * *"     # daily by default
```

Everything below this line is **inert unless `model_registry.enabled = true`** — a
disabled or absent block means Team behaves byte-identically to Solo, and zero outbound
calls are made.

### 4.1 Refresh and admission

On each scheduled tick (or immediately with `refresh_on_start`), the Team daemon fetches
each configured provider's real catalog and admits a filtered subset — the registry never
blindly ingests hundreds of models. A catalog entry is admitted if **any** of these hold:

| Admission reason | Condition                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `curated`        | Named in one of your `model_presets.<SIZE>.candidates` lists.                                                                                                                                                                   |
| `native`         | The provider is a first-party, non-aggregator provider (e.g. Anthropic, OpenAI, Google, Ollama) and `model_registry.admission.keep_native_whole` is `true` (the default) — native catalogs are kept whole rather than filtered. |
| `explicit_use`   | The model was explicitly requested by name at least once (§4.3 auto-admit) — "previously used" always stays admitted.                                                                                                           |
| `benchmark_topn` | In the top-N (`model_registry.admission.top_n`, default 25) of any tracked benchmark — relevant mainly for aggregators like OpenRouter, which otherwise have no native/curated admission path.                                  |

Every admission and retirement is journalled (`model.admitted`, `model.retired`), and a
failed refresh for one provider never rolls back or blocks any other provider's
already-committed catalog (`model.catalog.refreshed` / a failure audit event per
provider, with exponential backoff on repeated failures).

### 4.2 Multi-route pricing

The same model is sometimes available from more than one place — a first-party API and
an aggregator like OpenRouter, for instance. When the catalog has 2+ routes for one model
name, the **route policy** decides which route actually gets used:

```toml
[model_registry]
route_policy = "cheapest"            # cheapest | reliability | native_first | user_order
route_policy_price_tolerance = 0.05  # 5% near-tie band under "cheapest"

[model_registry.route_order]
# only read when route_policy = "user_order"
"claude-opus-4.5" = ["anthropic", "openrouter"]
```

A model with exactly one route short-circuits with `route_reason: "single_route"` and no
event. Two or more routes emit `model.route.selected` with every route considered, and
`model.resolved` carries the same `route_reason`.

### 4.3 Explicit models: validate, don't just trust

When an identity or request names an explicit `provider:model` (§2.1), Team validates it
against the live catalog instead of passing it through blindly:

- **Already admitted** → resolved verbatim.
- **Real, but not yet admitted** → auto-admitted on the spot (re-presenting the existing
  catalog plus this one new model — nothing already admitted is evicted), journalled as
  `model.admitted{reason: "explicit_use"}`, then resolved.
- **Not offered by the provider at all** → rejected with a clear "unknown model" error,
  not a silent pass-through to a call that will fail downstream.

### 4.4 Benchmark data (opt-in)

`model_registry.benchmark_source` (enabled by default once `model_registry.enabled` is
`true`) ingests community benchmark scores from
[models.dev](https://models.dev/) (MIT-licensed) on a weekly cron. This is what feeds
`best` ranking (§3.1) and the `benchmark_topn` admission path (§4.1). Track additional
benchmarks with `model_registry.benchmark_source.tracked_benchmarks`, and control which
task types map to which benchmarks with `model_registry.benchmark_map`.

### 4.5 What changes for Solo when Team is off

Nothing. `model_registry.enabled = false` (the default) or an absent block means:
zero outbound catalog/pricing/benchmark calls, `best` and `usage_ranked` silently never
fire (their strategy hooks are simply absent), and every other resolution path — explicit
override, curated lists, capability scoring — behaves exactly as in Solo.

## 5. Cost accuracy

Every provider call records a `provider_costs` row with a `cost_source`:

| `cost_source`                    | When it fires                                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider_reported`              | The provider itself reports a real cost in its response (e.g. OpenRouter's `usage.cost`, or a session-delegate's own accounting). Trusted verbatim.                                                                  |
| `registry_computed`              | **Team only.** No provider-reported cost, but the Team registry has priced this exact `provider:model` pair (`model_pricing` table) — cost is computed by multiplying real token counts against that per-Mtok price. |
| `null` (legacy blended estimate) | Neither of the above — falls back to the old static per-provider cost-rate table. Least accurate; present for backward compatibility.                                                                                |

When both a provider-reported cost and a registry-computed cost are available and they
diverge beyond `model_registry.cost_divergence_tolerance_pct` (default 5%), Exaix emits a
`model.cost.divergence` event rather than silently picking one — useful for catching a
stale local price table.

## 6. CLI reference

```bash
# Inspect the model floor: provider:model, pricing provenance, staleness
exactl models list
exactl models pricing

# Team only: append an advisory benchmark-score column
exactl models list --benchmark swe_bench_verified

# Team only: trigger/inspect the live refresh cycle
exactl models refresh

# Curate per-size preferred providers (Solo and Team both read this)
exactl config model --size M anthropic ollama
exactl config model --size M --characteristic cheapest ollama
exactl config model --size M --list
exactl config model --size M --clear
```

`exactl config model` writes straight to `exa.config.toml`'s `model_presets` block — the
same file the resolver reads — so there is no separate curation database in either
edition.

## 7. Observability

Every resolution decision is journalled. The events you'll actually want to filter on:

| Event                                                 | Fires when                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.resolved`                                      | Every single resolution — carries the full intent, candidate providers, scores, the winning `provider:model`, the `reason`, and (Team) `route_reason`/`task_type_source`. |
| `model.admitted`                                      | Team: a model clears the admission bar (§4.1), with its reason.                                                                                                           |
| `model.retired`                                       | Team: a model was in the previous catalog but not the new one.                                                                                                            |
| `model.catalog.refreshed` / `model.pricing.refreshed` | Team: one scheduled refresh pass completed for a provider.                                                                                                                |
| `model.route.selected`                                | Team: a 2+-route model's route was decided (§4.2).                                                                                                                        |
| `model.benchmark.refreshed`                           | Team: the weekly benchmark ingest ran.                                                                                                                                    |
| `model.cost.divergence`                               | Team: a reported cost and a registry-computed cost disagreed beyond tolerance.                                                                                            |

```bash
# The single most useful query while debugging "why did it pick that model?"
exactl logs --filter action_type=model.resolved --format json
```
