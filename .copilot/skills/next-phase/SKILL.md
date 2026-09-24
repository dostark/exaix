---
name: next-phase
agent: general
scope: dev
title: "Next Phase Selection (#next-phase)"
description: "Analyze exaix-dev-docs/planning/ to pick the single most productive not-yet-complete phase to implement next — verifies real completion state at the step level, checks the dependency graph, risk, scope, and environment-executability, reconciles every phase named in docs/CHANGELOG.md against its leftover open waived/ledger items, and maintains PHASE_REGISTRY.md so repeat runs are cheap"
short_summary: "Pick the most productive next phase from exaix-dev-docs/planning/ by dependency/risk/scope/environment-executability, reconcile CHANGELOG-named phases' open waived/ledger items, and keep PHASE_REGISTRY.md current."
version: "1.1.0"
topics: ["planning", "roadmap", "phase-selection", "dependencies", "prioritization", "process"]
qwen_skill: next-phase
---

```text
Key points

- Use when the user has NOT already named a phase — "what should I work on next", "which
  phase is most productive", "pick the next phase" — not for executing an already-chosen
  phase (that's #next-steps) or drafting a brand-new one from scratch (that's #plan).
- Cheap path first: read `exaix-dev-docs/planning/PHASE_REGISTRY.md`. It caches the
  dependency/risk/scope/environment verdict for every still-open phase so you don't
  re-scan all 166+ docs every time. Refresh only the rows that are stale or missing.
- Reconcile `docs/CHANGELOG.md` against `planning/` on every run: a phase that shipped
  (`## Unreleased — Phase <N>`) is commonly marked `status: COMPLETED` while still
  carrying open waived items and open ledger rows — it is NOT completely closed. Keep the
  dedicated `## Not-fully-closed phases (from docs/CHANGELOG.md)` section in the registry
  current; these are real residual backlog, just not this run's ranking candidates.
- Never trust a phase doc's `**Status**:` header alone — verify real completion at the
  step level. This is exactly the self-improvement skill's "Phase-doc status hygiene"
  procedure; reuse it, don't re-derive it.
- Rank ready candidates on: dependency-unblocked (hard deps all ✅) > bounded scope > low
  risk > environment-executable right now (required binaries/API keys actually present,
  not just assumed) > unblocks further phases.
- Deliver ONE clear top pick with full evidence, plus 2-3 named runners-up with an
  explicit reason each is not the top pick. Never hand back a bare list.
- Update the registry with what you found before finishing — the next run should be
  cheaper than this one, not the same cost again.

Canonical prompt (short):
"Read exaix-dev-docs/planning/PHASE_REGISTRY.md, refresh any stale/missing rows against
the real phase docs (step-level evidence, not header text), rank the genuinely open
candidates by unblocked-dependencies / bounded-scope / low-risk / environment-executable-now,
recommend one top pick with evidence plus 2-3 ranked runners-up, and update the registry
with what changed."
```

## When to use

- The user asks a variant of "what should I build next", "which phase is most productive
  to implement", "what's the highest-priority open work" — with no phase already named.
- Before starting `#plan` for genuinely new work, to confirm there isn't already a
  drafted-but-unstarted phase that covers the same need.
- Periodically, to keep `PHASE_REGISTRY.md` from drifting (treat like the
  self-improvement Phase-loop retro: run this after closing a phase, not just when asked),
  including the `docs/CHANGELOG.md` → planning reconciliation of not-fully-closed phases.

Not this skill: implementing the chosen phase's steps (`#next-steps`), drafting a new plan
from a blank page (`#plan`), or auditing/repairing a doc's own stale header once you already
know which phase you're touching (`#self-improvement`'s Phase-doc status hygiene).

## The registry: `exaix-dev-docs/planning/PHASE_REGISTRY.md`

A hand-maintained (agent-maintained) index of every **not-yet-complete** phase — complete,
cancelled, and postponed phases are dropped from it entirely (they're not candidates, and
keeping them bloats the file for no benefit). Columns:

| Column         | Meaning                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase          | `NNN`                                                                                                                                         |
| Title          | short title                                                                                                                                   |
| Real status    | the VERIFIED state (may differ from the doc's own header text)                                                                                |
| Hard deps      | phase numbers that must be ✅ before this can start; `None` if unblocked                                                                      |
| Blocking?      | `Ready` / `Blocked on <N>` / `Needs <resource>` (e.g. an env var, a GPU runner)                                                               |
| Risk           | L / M / M-H / H, from the doc's own Risk Level line                                                                                           |
| Scope          | step count or size signal (rough sizing, not a promise)                                                                                       |
| Env-executable | can this be implemented AND live-verified in a typical session right now, or does it need something absent (API key, binary, external infra)? |
| Notes          | the one sentence that matters — why it's ready, why it's not, what's odd about it                                                             |
| Verified       | date this row's verdict was checked against the real doc                                                                                      |

A row is **stale** the moment `git log -1 --format=%H -- planning/<file>` (run inside the
`exaix-dev-docs` submodule) returns a commit newer than the row's `Verified` date, or a
listed dependency's own status changed. Re-audit stale rows before relying on them for a
recommendation; don't just trust old prose.

**Bootstrapping** (registry missing or badly out of date): scan `exaix-dev-docs/planning/`
for every phase doc, classify each via self-improvement's Phase-doc status hygiene rules,
drop everything Complete/Cancelled/Postponed, and write one row per survivor. Full-corpus
scans are expensive (166+ files) — do this rarely, prefer incremental refresh.

## Not-fully-closed phases (from `docs/CHANGELOG.md`)

Independent of the "what's next" ranking, every run must reconcile `docs/CHANGELOG.md`
against the planning corpus. The CHANGELOG names the phases that shipped user-facing
changes (`## Unreleased — Phase <N>` headings). A shipped phase is routinely marked
`status: COMPLETED` (frontmatter and prose header) while still carrying **open waived
items** or **open ledger items** — meaning it is NOT completely closed. These phases are
not open-work candidates (they don't belong in the Registry table above or in the pickup
order — they're kept out for ranking purposes), but their residual items are real debt:
list them in the dedicated registry section
`## Not-fully-closed phases (from docs/CHANGELOG.md)`. Columns:

| Column            | Meaning                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Phase             | `NNN` (the CHANGELOG heading)                                                                                     |
| Title             | short title from the phase doc                                                                                    |
| Open waived items | success criteria / ledger entries marked `waived` / `waived by the user`, verbatim                                |
| Open ledger items | Reachability Ledger / Deferred Items rows with a non-`✅` Status column (⏳, ⏳ POSTPONED, ⚠️ deferred), verbatim |
| Verified          | date this phase's item list was re-scanned                                                                        |

Classify each item precisely:

1. **Parse the list.** `rg '^## .*— Phase ([0-9a-z]+)' docs/CHANGELOG.md` gives the phase
   IDs (match `140a`-style suffixed numbers too).
1. **Open ledger item** = a row in the phase doc's `## Reachability Ledger (pending
   production consumers)` (or its `Deferred Items`) table whose Status column is anything
   other than `✅` — e.g. `⏳`, `⏳ POSTPONED`, `⚠️ deferred`, a credit/credential-gated
   label, or a non-`✅` prose status. A `⏳`/`⚠️` marker **in prose outside a
   ledger/deferred-items table is NOT an item** — resolved-finding narratives legitimately
   keep historical pending markers while every ledger row is `✅`.
1. **Open waived item** = any success criterion / live-verification / ledger entry whose
   text says `waived` / `waived by the user` / `closed as waived`, **even when the row's
   status column reads `✅`** — the requirement was accepted-but-not-met, so the phase is
   not fully closed. Example: Phase 199's `PLANNING_LIVE_NATIVE_CELLS` (Step 11 marker run
   on a second native provider) is closed _as waived_, not met.
1. **Confirm the item is still open** — don't take a `⏳`/`waived` marker at face value. A
   row annotated "closed by Phase N" (e.g. Phase 134's rows → 135, Phase 136's → 137)
   counts as closed once that named successor actually implemented the consumer; a
   closure note saying `POSTPONED` / "deferred indefinitely" / "blocked on credits" stays
   open regardless of the phase's `status: COMPLETED` frontmatter.
1. **Remove a phase row** the moment every item closes — a phase appears in this section
   and NOT in the open-work Registry when it is complete-but-not-closed, and in NEITHER
   when fully closed.

## Procedure

1. **Read the registry.** If it doesn't exist, bootstrap it (above).
1. **Cross-check `docs/CHANGELOG.md`** for not-fully-closed phases (procedure in the
   section above): parse the `## ... — Phase <N>` headings, scan each named phase doc's
   Reachability Ledger / Deferred Items table for non-`✅` rows and any `waived` markers,
   confirm each finding is still open, and keep the
   `## Not-fully-closed phases (from docs/CHANGELOG.md)` registry section current.
1. **Find drift**: `glob exaix-dev-docs/planning/phase-*.md` and diff the filename set
   against the registry's `Phase` column — new docs since the last run, and any registry
   row whose file no longer exists (renamed/retired), both need reconciling.
1. **Refresh stale rows** using self-improvement's Phase-doc status hygiene checklist:
   step-level checkbox/status-marker evidence (mind the checkbox-era difference), explicit
   blocking language that survives a checked box (e.g. an unrun completion gate), accepted
   `⚠️ deferred`/`🗄️ Postponed` exceptions that don't block readiness.
1. **Resolve the dependency graph.** A candidate's hard deps must show `✅`/Complete in the
   registry (or be freshly confirmed) — a dependency that is itself only "code complete,
   live-verification deferred" (see phase-143's pattern) usually still counts as unblocking
   unless the depending phase specifically needs the deferred part.
1. **Check environment-executability, don't assume it.** Run `which <bin>` / check for a
   required env var the same way you'd check any tool precondition — a phase that "should"
   be runnable on paper but needs a credential this environment doesn't have (e.g. an
   OpenRouter API key) is still worth doing, but say so plainly rather than silently
   overselling it as immediately live-verifiable.
1. **Rank** every genuinely open, unblocked candidate: fewest hard blockers first, then
   scope (steps), then risk, then environment-executable-now, then "unblocks N other
   phases" as a tiebreaker.
1. **Recommend**: one top pick with the full evidence table, 2-3 runners-up each with one
   concrete reason they rank below the top pick — never a bare ranked list with no
   rationale.
1. **Update the registry**: write/refresh every row you touched, bump `Verified`, refresh
   the `## Not-fully-closed phases (from docs/CHANGELOG.md)` section, and keep
   the "Recommended pickup order" section current at the top of the file so a future run
   (or a human skimming the file) gets the answer without re-running this skill.
1. **No good candidate?** Say so explicitly — don't force a recommendation. Point to
   `#plan` if the real need requires drafting new work, or name the specific blocker
   (missing dependency, missing external resource) that must clear first.

## Do / Don't

- ✅ Do read `PHASE_REGISTRY.md` before scanning the corpus — a fresh registry makes this
  a few-file lookup, not a 166-file audit.
- ✅ Do verify at the step level before trusting any row you're about to act on — a stale
  registry row is exactly as misleading as a stale doc header.
- ✅ Do actually check environment-executability (`which`, env vars) rather than inferring
  it from the plan's prose.
- ✅ Do reconcile `docs/CHANGELOG.md` phases against their leftover open ledger/waived
  items on every run and keep the "Not-fully-closed phases" registry section current.
- ✅ Do name the tradeoff for every runner-up, not just the top pick.
- ✅ Do update the registry before finishing, even if the answer was "nothing changed."
- ❌ Don't recommend a phase whose hard dependencies aren't actually done — check, don't
  trust a doc's own "Phase Dependencies" line without confirming those phases' real state.
- ❌ Don't treat "0 steps checked" and "this doc doesn't track completion with
  checkboxes at all" as the same signal — the latter needs a different doc-open, not a
  confident verdict either way.
- ❌ Don't drop completed/cancelled/postponed phases' history — they simply don't belong
  in this registry (it exists to answer "what's next", not "what happened").
- ❌ Don't lose a `status: COMPLETED` phase's open ledger/waived items when it exits the
  open-work Registry — capture them under "Not-fully-closed phases".
- ❌ Don't hand back a plain list of candidates with no ranking rationale — every entry
  needs the "why this rank" sentence.

## Examples

- Session: asked "which planning phase is most productive to take next".
  Audited the active frontier plus spot-checked earlier phases; recommended the
  next phase with zero dependencies, a bounded step count, low risk, and a CLI
  binary confirmed present on PATH (so it was both implementable and live-verifiable
  in the same session). Runners-up were ranked lower for a real architectural-decision
  ambiguity, or a need for paid multi-trial live LLM runs, or being a multi-step
  strategic initiative better suited to a dedicated push than a single "what's next"
  pick — the ranking prose must justify every position.

## Related

- [self-improvement](../self-improvement/SKILL.md) — Phase-doc status hygiene: the
  step-level verification procedure this skill depends on for every registry row
- [plan](../plan/SKILL.md) — drafts a new phase when no existing candidate fits
- [next-steps](../next-steps/SKILL.md) — implements the chosen phase's steps once picked
- [pre-gap-analysis](../pre-gap-analysis/SKILL.md) — validates the chosen phase's plan
  before implementation begins
- [submodule-workflow](../submodule-workflow/SKILL.md) — `PHASE_REGISTRY.md` lives in the
  `exaix-dev-docs` submodule; commit/pointer-bump discipline applies
- [docs/CHANGELOG.md](../../../docs/CHANGELOG.md) — the shipped-phase list the
  "Not-fully-closed phases" registry section is reconciled against every run

---
exaix:
  skill_id: next-phase
  related_skills: [self-improvement, plan, next-steps, pre-gap-analysis, submodule-workflow]
  triggers:
    keywords: [
      next-phase,
      which-phase,
      phase-selection,
      phase-registry,
      roadmap,
      backlog,
      implementation-order,
      what-next,
    ]
    task_types: [planning, process, docs]
    tags: [planning, roadmap, prioritization, phase-registry]
  constraints:
    - "Read PHASE_REGISTRY.md before scanning the full planning/ corpus"
    - "Verify real completion at the step level before trusting any registry row"
    - "Check environment-executability with a real command, not inference"
    - "Reconcile docs/CHANGELOG.md phases with their open waived/ledger items every run"
    - "Recommend one top pick plus 2-3 ranked runners-up, each with a stated reason"
    - "Update PHASE_REGISTRY.md with every row touched before finishing"
  output_requirements:
    - "One clear top-pick recommendation with evidence"
    - "2-3 named runners-up, each with a reason it ranks lower"
    - "PHASE_REGISTRY.md updated to reflect the audit"
    - "Not-fully-closed registry section kept current (phases and items added/removed as items close)"
    - "Explicit statement when no candidate is ready, naming the blocker"
  quality_criteria:
    - name: evidence_grounding
      description: Every readiness/risk/scope claim is backed by something actually read, not inferred
      weight: 30
    - name: registry_freshness
      description: PHASE_REGISTRY.md is left current, not stale, after the run — including the Not-fully-closed CHANGELOG section
      weight: 25
    - name: ranking_rationale
      description: Every candidate's rank (including runners-up) has a stated reason
      weight: 25
    - name: environment_check
      description: Environment-executability is verified with a real command, not assumed
      weight: 20
---
