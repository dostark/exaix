# Model Resolution

- **Version:** 0.2.0
- **Date:** 2026-07-12

How Exaix picks which AI provider and model handle a request, why it made that choice,
and how you can steer it — through curation, characteristics, and (in the Team edition)
a live, self-updating model catalog.

This document covers both editions. **Solo** ships a static, offline model list.
**Team** adds a live, continuously-refreshed catalog with quality/cost-aware routing and
more accurate cost tracking. Everything Solo does still works unchanged in Team — Team
only adds capability, it never removes or silently changes Solo behaviour.

For the request-side flags (`--model-size`, `--characteristic`, `--thinking`, etc.) and
the Solo curation walkthrough, see the "Request Commands" section of
[`docs/Exaix_User_Guide.md`](Exaix_User_Guide.md). This document goes deeper on how
those choices actually get resolved, and what changes when Team is enabled.

---

## 1. You describe intent, Exaix picks the model

You rarely name an exact model. Instead you describe what you want:

- A **size** (`S`/`M`/`L`/`XL`) — a rough capability/cost tier, not a specific model.
- One or more **characteristics** (`cheapest`, `fastest`, `best`) — soft preferences
  that shape the choice.
- Optionally, a **preferred provider**, whether you want extended reasoning
  (`--thinking`/`--effort`), or — if you really do want a specific model — an explicit
  `provider:model` pair.

Exaix turns that into exactly one concrete choice and records why. You can always ask
"why did it pick that?" after the fact:

```bash
exactl logs --filter action_type=model.resolved --format json
```

## 2. How the choice gets made

Given your request, Exaix tries the following, in order, and stops at the first thing
that applies:

1. **You named an exact model.** If you gave a specific `provider:model` (or just a
   model name Exaix can identify), that's what runs.
   - In **Solo**, this is trusted as-is — a typo only surfaces once the call actually
     fails.
   - In **Team**, it's checked against the live catalog first. If the model is real but
     you haven't used it before, Team adds it to your catalog on the spot rather than
     rejecting it. If the provider doesn't actually offer that model, you get a clear
     error immediately instead of a failed call later.
2. **You curated a preferred list for this size.** If you've told Exaix "for size-M
   requests, try Anthropic then Ollama" (see [curation](#3-curating-your-preferred-models)
   below), the first healthy provider on that list wins.
3. **Otherwise, Exaix scores every available provider** against your requested size and
   characteristics, and picks the winner.

On top of this, if the chosen model genuinely can't handle the request (the prompt is
too large for its context window, or the provider is unavailable), Exaix automatically
steps up to a larger size tier or tries your configured fallbacks — you don't have to
retry manually.

During plan execution, request-level intent from the request frontmatter (CLI flags such
as `--model-size`, `--thinking`) overrides the agent role blueprint's intent fields for any
field explicitly set; unset fields fall through to the blueprint. Each provider's
capability metadata (context window, thinking support, reference cost) is what powers the
size/thinking eligibility checks, so a custom provider must be registered with those
fields populated for preset-based selection to apply.

## 3. Curating your preferred models

You can tell Exaix which providers to prefer for each size tier, without editing config
files by hand:

```bash
# Inspect what's available: provider:model, pricing, freshness
exactl models list
exactl models pricing

# For size-M requests, try Anthropic first, then Ollama
exactl config model --size M anthropic ollama

# See your current preferences
exactl config model --size M --list

# Reset back to automatic scoring
exactl config model --size M --clear
```

This is the same for Solo and Team — your curated preferences are always checked before
Exaix falls back to scoring.

## 4. Characteristics: preferences, not filters

`cheapest`, `fastest`, and `best` never rule a provider out — they weight the scoring in
step 3 above. Combining `["best", "cheapest"]` blends both preferences into one ranking,
rather than picking the best one and then re-deciding on price.

- **`cheapest`** favours lower per-token cost. A local or genuinely free provider always
  qualifies even under a tight budget; a model with no known price is never assumed to
  be the cheapest option.
- **`fastest`** favours responsiveness (currently a simple preference, not yet
  differentiated per-provider).
- **`best`** (**Team only**) favours whichever provider performs best on independent
  benchmarks relevant to the kind of work you're asking for — see below.

### Quality-aware selection with `best` (Team)

When you ask for `best`, Team looks at what _kind_ of task this is (feature work, a bug
fix, a refactor, docs, and so on — inferred from your request, the agent role, or a
matched skill, in that order of trust) and checks which provider scores highest on
benchmarks relevant to that kind of task. A provider with no relevant benchmark data
simply doesn't get boosted — it's never penalized for being unmeasured.

This only ever adds information; if `best` can't determine a task type or benchmark data
isn't available, Exaix falls through to ordinary scoring rather than guessing.

### Breaking ties by past usage (Team, opt-in)

If a request has no size-based curation and no characteristics at all, there's otherwise
no clear favourite among equally-good providers. Team can optionally break that tie by
your own usage history — consistently picking the provider you already use most (or
least, if you're intentionally load-balancing) instead of an arbitrary pick. This is off
by default; enable it in your config if you want deterministic tie-breaking.

## 5. The Team live catalog

Solo's model list is static — it ships with the binary and only updates when you
upgrade Exaix. Enabling Team gives you a **live catalog** that periodically checks each
provider for new and retired models, so `exactl models list` and every resolution
decision reflect what's actually available right now, not what was available when you
installed Exaix.

Turning this on is one config flag; everything below only applies once it's on — with
it off, Team behaves exactly like Solo and makes no extra network calls at all.

### What gets added to your catalog automatically

The live catalog doesn't blindly pull in every model a provider offers. A model gets
added automatically if:

- **You've curated it** (see [Curating your preferred models](#3-curating-your-preferred-models)).
- **It's from one of your main providers** (Anthropic, OpenAI, Google, Ollama) — these
  are kept complete by default, since they're not huge reseller catalogs.
- **You've actually used it** — naming a specific model once is enough to keep it
  around going forward.
- **It ranks highly on a benchmark you're tracking** — mainly relevant for
  marketplace-style providers with very large catalogs (e.g. OpenRouter), where only the
  standout models are worth surfacing automatically.

Every addition and removal is recorded, and a hiccup fetching one provider's list never
affects any other provider's already-known catalog.

### When one model is available from more than one place

Sometimes the same model is offered both directly by its maker and through a
marketplace/reseller. When that happens, Team picks a route according to a policy you
control — cheapest by default, but you can instead prefer reliability, always prefer the
direct/native provider, or set an explicit provider order per model.

### Keeping cost estimates accurate

Every provider call is logged with a cost, and where that cost comes from:

- If the provider itself reports a real cost, that's trusted directly.
- Otherwise, if Team's live catalog has pricing data for the exact model that ran, cost
  is computed from real token counts and current pricing — this is more accurate than
  Solo's fallback.
- If neither is available, Exaix falls back to a rough legacy estimate.

If a provider's self-reported cost and Team's computed cost disagree by more than a
small tolerance, Exaix flags it — a useful signal that a local price assumption may be
stale.

### Optional: benchmark-backed model quality data

Team can optionally pull in community-maintained benchmark scores on a weekly schedule.
This is what powers `best` (§4) and helps large marketplace catalogs surface their
standout models automatically (§5). It's on by default once Team's live catalog is
enabled, and you can choose which benchmarks to track.

## 6. Everything is auditable

Every model choice — which provider, which model, and why — is written to the Activity
Journal, along with the Team-specific events above (a model added to your catalog, a
routing decision, a cost mismatch, and so on). The one query worth remembering:

```bash
exactl logs --filter action_type=model.resolved --format json
```

If a choice ever looks wrong, this is where to start — it shows exactly what Exaix
considered and why it picked what it picked.
