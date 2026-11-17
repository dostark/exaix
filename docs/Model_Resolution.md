# Model Resolution

- **Version:** 0.3.0
- **Date:** 2026-11-16

How Exaix picks which AI provider and model handle a request, why it made that choice,
and what steers it: curation, characteristics and (in the Team edition) a live,
self-updating model catalog.

This page explains how the choice is made. It covers both editions. **Solo** ships a
static, offline model list. **Team** adds a live, continuously-refreshed catalog with
quality/cost-aware routing and more accurate cost tracking. Everything Solo does still works
unchanged in Team. Team only adds capability, it never removes or silently changes Solo
behaviour.

| You want to know                                                                               | Read                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The request flags (`--model-size`, `--characteristic`, `--thinking`) and the curation commands | [User Guide, Request Commands](user_guide/requests-plans-reviews.md#exactl-model-candidates--exactl-model-list--solo-model-curation-the-curated-model-registry) |
| The config keys, environment variables, bindings and presets that set a provider or model      | [Model Settings](Model_Settings.md)                                                                                                                             |
| How Exaix turns those inputs into one model, and how to read the result                        | This page                                                                                                                                                       |

---

## 1. You describe intent, Exaix picks the model

You rarely name an exact model. Instead you describe what you want:

- A **size** (`S`/`M`/`L`/`XL`): a rough capability/cost tier, not a specific model.
- One or more **characteristics** (`cheapest`, `fastest`, `best`): soft preferences
  that shape the choice.
- Optionally, a **preferred provider**, whether you want extended reasoning
  (`--thinking`/`--effort`), or, if you really do want a specific model, an explicit
  `provider:model` pair.

Exaix turns that into exactly one concrete choice and records why. [Section 6](#6-everything-is-auditable)
shows how to ask "why did it pick that?" after the fact.

## 2. How the choice gets made

Given your request, Exaix tries the following, in order, and stops at the first thing
that applies:

1. **You named an exact model.** If you gave a specific `provider:model` (or just a
   model name Exaix can identify), that's what runs.
   - In **Solo**, this is trusted as-is. A typo only surfaces once the call fails.
   - In **Team**, it's checked against the live catalog first. If the model is real but
     you haven't used it before, Team adds it to your catalog on the spot rather than
     rejecting it. If the provider doesn't actually offer that model, you get a clear
     error immediately instead of a failed call later.
1. **You curated a preferred list for this size.** If you've told Exaix "for size-M
   requests, try Anthropic then Ollama" (see [section 3](#3-curating-your-preferred-providers)),
   the first healthy, registered provider on that list wins.
1. **Otherwise, Exaix scores every available provider** against your requested size and
   characteristics, and picks the winner. A local or free provider is exempt from the
   budget filter, so it can win under a tight budget.

### Reading the reason

Every choice carries a reason. The reason tells you which rule decided:

| Reason                    | What decided                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `explicit_override`       | You named a `provider:model`.                                                             |
| `preferred_list`          | The first healthy provider of the curated list for the size.                              |
| `characteristics_scored`  | Scoring, with your characteristics in the blend.                                          |
| `preset_default`          | Scoring by the size profile alone.                                                        |
| `best_ranked` (Team)      | The `best` characteristic was decisive, through the benchmark ranking.                    |
| `usage_ranked` (Team)     | The opt-in usage tie-break settled a pick that was otherwise arbitrary.                   |
| `fixed_client`            | The caller's client is fixed, so the intent set only the call options (see below).        |
| `fallback`                | A later attempt, with one of the fallbacks that the request intent carries.               |
| `thinking_constrained`    | You asked for thinking and the first pick could not think. See below.                     |
| `context_window_overflow` | A larger size replaced the pick because the input exceeded its context window. See below. |

### After the pick

- **Thinking.** If you ask for thinking and the routing picked a provider that cannot think,
  Exaix switches to the first healthy provider that can, and records `thinking_constrained`.
  If no registered provider can think, the first pick stays and the event still records it.
- **Fallbacks.** If the intent carries fallbacks, Exaix tries them in order after the first
  attempt fails to resolve, with reason `fallback`.
- **Large prompts.** The resolver can step up one size tier (S, M, L, XL) when an
  input-size estimate exceeds the chosen model's context window. That needs an intent with
  `context_window_fallback` on and an `estimated_input_tokens` value, and a known context
  window. No request command sets these fields today, so a large prompt is not moved to a
  larger size on its own.

### Request intent and blueprint intent

During plan execution, request-level intent from the request frontmatter (CLI flags such
as `--model-size`, `--thinking`) overrides the agent role blueprint's intent fields for any
field explicitly set. Unset fields fall through to the blueprint. Each provider's
capability metadata (context window, thinking support, reference cost) powers the
size/thinking eligibility checks, so a custom provider must be registered with those
fields populated for preset-based selection to apply.

### The daemon runs on a fixed client

Plan execution and flow steps call one provider instance: the daemon's configured
`agents.default_model`, or a flow step's bound service. They cannot switch providers per
step. In those paths the resolver does not choose. It reports that client as the selected
`provider:model` with reason `fixed_client`, and your size, characteristics and preferred
provider have no effect on the choice. Your `--thinking` and `--effort` still set the call
options. To run a step on another model, change `agents.default_model` or bind the flow step
(see [section 7](#7-flow-step-bindings-and-intent-resolution)). A `default_model` that names
a fallback chain has no fixed client, so the resolver keeps choosing as described above.

## 3. Curating your preferred providers

A curated list is an ordered list of **provider names** for one size tier. The resolver
tries the list before any scoring, and the first healthy, registered provider wins. Notes:

- Entries are provider names such as `anthropic`, not `provider:model` pairs. The resolver
  picks the model for that provider.
- An unknown provider is stored but flagged `unconfigured`, and the resolver skips it.
- A characteristic sub-list reorders entries inside the list. For example, a `cheapest`
  sub-list that holds `ollama` promotes `ollama` when you ask for `cheapest`. It never adds
  an entry that the base list lacks.
- Curated lists work the same in Solo and Team. They are always checked before scoring.

The commands (`exactl model candidates`, `exactl model list`) are in the
[User Guide](user_guide/requests-plans-reviews.md#exactl-model-candidates--exactl-model-list--solo-model-curation-the-curated-model-registry).
The list lives under `model_sizes.<SIZE>.candidates` in `exa.config.toml`, described in
[Model Settings](Model_Settings.md#model-configuration).

## 4. Characteristics: preferences, not filters

`cheapest`, `fastest`, and `best` never rule a provider out. They weight the scoring in
step 3 of section 2. Combining `["best", "cheapest"]` blends both preferences into one
ranking, rather than picking the best one and then re-deciding on price.

- **`cheapest`** favours lower per-token cost. A local or genuinely free provider always
  qualifies even under a tight budget. A model with no known price is never assumed to
  be the cheapest option.
- **`fastest`** is accepted, but it does not change the ranking today. Every provider gets
  the same score for it, so it neither helps nor hurts any of them.
- **`best`** (**Team only**) favours whichever provider performs best on independent
  benchmarks relevant to the kind of work you're asking for. See below.

### Quality-aware selection with `best` (Team)

When you ask for `best`, Team looks at what _kind_ of task this is (feature work, a bug
fix, a refactor, docs, and so on, inferred from your request, the agent role, or a
matched skill, in that order of trust) and checks which provider scores highest on
benchmarks relevant to that kind of task. By default, feature, bug-fix and test work use
SWE-bench Verified, refactoring adds SWE-bench Pro, and analysis uses GPQA. You can change
this map. A provider with no relevant benchmark data simply doesn't get boosted. It's never
penalized for being unmeasured.

This only ever adds information. If `best` can't determine a task type or benchmark data
isn't available, Exaix falls through to ordinary scoring rather than guessing.

### Breaking ties by past usage (Team, opt-in)

If a request has no size-based curation and no characteristics at all, there's otherwise
no clear favourite among equally-good providers. Team can optionally break that tie by
your own usage history, consistently picking the provider you already use most (or
least, if you're intentionally load-balancing) instead of an arbitrary pick. This is off
by default. Turn it on with `model_registry.usage_tiebreak = true`.

## 5. The Team live catalog

Solo's model list is static. It ships with the binary and only updates when you
upgrade Exaix. Enabling Team gives you a **live catalog** that periodically checks each
provider for new and retired models, so `exactl model list` and every resolution
decision reflect what's actually available right now, not what was available when you
installed Exaix.

Turning this on is one config flag, `model_registry.enabled = true`. It is off by default.
Everything below only applies once it's on. With it off, Team behaves exactly like Solo and
makes no extra network calls at all. By default the catalog refreshes every six hours and
prices refresh daily. [Team model registry](Model_Settings.md#team-model-registry-live-catalog)
lists every key.

### What gets added to your catalog automatically

The live catalog doesn't blindly pull in every model a provider offers. A model gets
added automatically if:

- **You've curated it** (see [section 3](#3-curating-your-preferred-providers)).
- **It's from a native provider**, one that is not a reseller (Anthropic, OpenAI, Google
  and Ollama are examples). These are kept complete by default, since they're not huge
  reseller catalogs.
- **You've actually used it.** Naming a specific model once is enough to keep it
  around going forward.
- **It ranks highly on a benchmark you're tracking.** This mainly matters for
  marketplace-style providers with very large catalogs (e.g. OpenRouter), where only the
  standout models are worth surfacing automatically.

Every addition and removal is recorded, and a hiccup fetching one provider's list never
affects any other provider's already-known catalog.

### When one model is available from more than one place

Sometimes the same model is offered both directly by its maker and through a
marketplace/reseller. When that happens, Team picks a route according to a policy you
control (`model_registry.route_policy`):

| Policy         | Picks                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `cheapest`     | The cheapest route. Routes within 5% of it are separated by provider health. This is the default. |
| `reliability`  | The most reliable route.                                                                          |
| `native_first` | The direct provider of the model.                                                                 |
| `user_order`   | The provider order that you set for that model in `model_registry.route_order`.                   |

### Keeping cost estimates accurate

Every provider call is logged with a cost, and where that cost comes from. The source is one
of three values:

- `provider_reported`: the provider itself reports a real cost, and Exaix trusts it.
- `registry_computed`: Team's live catalog has pricing for the exact model that ran, so cost
  is computed from real token counts and current pricing. This is more accurate than
  Solo's fallback.
- `estimated`: neither is available, so Exaix falls back to a rough legacy estimate.

If a provider's self-reported cost and Team's computed cost disagree by more than a small
tolerance (5% by default), Exaix records a `model.cost.divergence` event. It's a useful
signal that a local price assumption may be stale.

### Optional: benchmark-backed model quality data

Team can optionally pull in community-maintained benchmark scores from
[models.dev](https://models.dev/) on a weekly schedule. This is what powers `best` (section 4)
and helps large marketplace catalogs surface their standout models automatically
(section 5). It's on by default once Team's live catalog is enabled, and you can choose
which benchmarks to track.

## 6. Everything is auditable

Every model choice (which provider, which model, and why) is written to the Activity
Journal as a `model.resolved` event. The one query worth remembering:

```bash
exactl log list --filter action_type=model.resolved -o json
```

If a choice ever looks wrong, this is where to start. It shows what Exaix considered and
which reason in [section 2](#reading-the-reason) decided.

Team adds events for what its catalog does: `model.admitted` and `model.retired` for
catalog changes, `model.route.selected` for a routing decision, `model.catalog.refreshed`
and `model.pricing.refreshed` for refreshes, `model.pricing.stale` for old prices, and
`model.cost.divergence` for a cost mismatch.

## 7. Flow step bindings and intent resolution

A flow step binding fixes the service and model through the model binding catalog and binding
resolver before the step calls a model. A bound step uses that resolved provider directly.
Its `model.resolved` event names the bound adapter and service model with reason
`fixed_client`; the step's intent sets only thinking and effort. The run snapshot
keeps the selected identity and field sources stable for that run. New runs resolve the
current config and overlays again.

An unbound flow step runs on the boot provider and reports it the same way. A
`cli_delegate` step runs its session tool, so it carries no fixed client. Plan
generation, plan execution and other non-flow requests do not use flow-step bindings;
plan execution reports the boot provider as its fixed client. See
[Model bindings for flow steps](Model_Settings.md#model-bindings-for-flow-steps) for
selectors, overlay precedence, pins, diagnostics and replay locks.
