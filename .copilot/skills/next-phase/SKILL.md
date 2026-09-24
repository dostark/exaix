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

- Not this skill: executing a chosen phase (#next-steps) or drafting brand-new work (#plan).
- Cheap path first: read `exaix-dev-docs/planning/PHASE_REGISTRY.md`. It caches the
  dependency/risk/scope/environment verdict for still-open phases. Refresh only stale or
  missing rows.
- Reconcile `docs/CHANGELOG.md` with `planning/` every run: a shipped phase marked
  `status: COMPLETED` can still carry open waived/ledger items — it is NOT fully closed.
  Keep the `## Not-fully-closed phases (from docs/CHANGELOG.md)` registry section current.
- Never trust a doc's `**Status**:` header — verify completion at the step level
  (self-improvement's "Phase-doc status hygiene"; reuse, don't re-derive).
- Rank: dependency-unblocked (hard deps ✅) > bounded scope > low risk >
  environment-executable now (real binaries/keys) > unblocks further phases.
- Deliver ONE top pick with evidence plus 2-3 runners-up, each with a reason. Never a bare
  list. Update the registry before finishing — the next run must be cheaper.

Canonical prompt (short):
"Read exaix-dev-docs/planning/PHASE_REGISTRY.md, refresh any stale/missing rows against
the real phase docs (step-level evidence, not header text), rank the genuinely open
candidates by unblocked-dependencies / bounded-scope / low-risk / environment-executable-now,
recommend one top pick with evidence plus 2-3 ranked runners-up, and update the registry
with what changed."
```

## When to use

- The user asks a variant of "what should I build next" with no phase named.
- Before `#plan` for new work, to confirm no drafted-but-unstarted phase covers it.
- Periodically, to stop `PHASE_REGISTRY.md` drifting (like the self-improvement retro —
  after closing a phase, not just when asked), including the CHANGELOG → planning
  reconciliation.

## The registry: `exaix-dev-docs/planning/PHASE_REGISTRY.md`

Agent-maintained index of every **not-yet-complete** phase; complete/cancelled/postponed
phases are dropped (not candidates, and they bloat the file). Columns:

| Column         | Meaning |
| -------------- | ------- |
| Phase          | `NNN` |
| Title          | short title |
| Real status    | the VERIFIED state (may differ from the doc header) |
| Hard deps      | phases that must be ✅ before start; `None` if unblocked |
| Blocking?      | `Ready` / `Blocked on <N>` / `Needs <resource>` |
| Risk           | L / M / M-H / H (from the doc's Risk Level line) |
| Scope          | step count or size signal |
| Env-executable | implementable AND live-verifiable now, or needs something absent? |
| Notes          | the one sentence that matters |
| Verified       | date the verdict was checked |

A row is **stale** when `git log -1 --format=%H -- planning/<file>` (in the submodule)
postdates its `Verified`, or a listed dependency's status changed. Re-audit stale rows.

**Bootstrapping** (registry missing/out of date): scan `planning/`, classify each via the
status-hygiene rules, drop Complete/Cancelled/Postponed, write one row per survivor.
Full-corpus scans are expensive (166+ files) — prefer incremental refresh.

## Not-fully-closed phases (from `docs/CHANGELOG.md`)

The CHANGELOG names shipped phases (`## Unreleased — Phase <N>`). A shipped phase marked
`status: COMPLETED` can still carry open waived or open ledger items. Such phases are not
ranking candidates but their residual debt belongs in the dedicated
`## Not-fully-closed phases (from docs/CHANGELOG.md)` section. Columns:

| Column | Meaning |
| ------ | ------- |
| Phase | `NNN` (CHANGELOG heading) |
| Title | short title |
| Open waived items | criteria/ledger entries marked `waived` / `waived by the user`, verbatim |
| Open ledger items | ledger/deferred rows with a non-`✅` Status (⏳, ⏳ POSTPONED, ⚠️ deferred), verbatim |
| Verified | date the item list was re-scanned |

Classify precisely:

1. **Parse.** `rg '^## .*— Phase ([0-9a-z]+)' docs/CHANGELOG.md` (match `140a` too).
1. **Open ledger item** = a row in `## Reachability Ledger (pending production
   consumers)`/`Deferred Items` whose Status is not `✅` (⏳, ⏳ POSTPONED, ⚠️ deferred,
   credit-gated label, or non-`✅` prose). A `⏳`/`⚠️` in prose outside such a table is
   NOT an item — resolved narratives keep historical markers while rows are `✅`.
1. **Open waived item** = a criterion/live-verification/ledger entry saying `waived` /
   `waived by the user` / `closed as waived`, even when the row status reads `✅` — the
   requirement was accepted-but-not-met. Example: Phase 199's `PLANNING_LIVE_NATIVE_CELLS`.
1. **Confirm it is still open.** A row annotated "closed by Phase N" is closed once that
   successor implemented the consumer; `POSTPONED` / "deferred indefinitely" /
   "blocked on credits" stays open regardless of `status: COMPLETED`.
1. **Remove the row** when every item closes — such a phase appears in this section but
   not the open-work Registry; fully closed in NEITHER.

## Procedure

1. **Read the registry** (bootstrap if absent).
1. **Cross-check `docs/CHANGELOG.md`** for not-fully-closed phases (above): parse the
   `## ... — Phase <N>` headings, scan each phase's ledger/deferred rows + `waived`
   markers, confirm they are open, keep the registry section current.
1. **Find drift**: `glob planning/phase-*.md` vs the registry's `Phase` column — new docs
   and retired rows both need reconciling.
1. **Refresh stale rows** via the status-hygiene checklist (step-level evidence, blocking
   language surviving a checked box, accepted ⚠️/🗄️ exceptions).
1. **Resolve the dependency graph**: hard deps show `✅`/Complete or are freshly
   confirmed. A dep that is "code complete, live-verification deferred" (phase-143's
   pattern) usually unblocks unless the dependent needs the deferred part.
1. **Check environment-executability, don't assume it**: `which <bin>` / env var — a
   phase needing a credential this env lacks is still worth doing, but say so plainly.
1. **Rank** open, unblocked candidates: fewest blockers, then scope, risk,
   environment-executable-now, then "unblocks N phases".
1. **Recommend**: one top pick with full evidence; 2-3 runners-up each with a reason they
   rank lower — never a bare ranked list.
1. **Update the registry**: refresh touched rows, bump `Verified`, keep the
   not-fully-closed section and "Recommended pickup order" current.
1. **No good candidate?** Say so; point to `#plan` or name the blocker that must clear.

## Do / Don't

- ✅ Read `PHASE_REGISTRY.md` before scanning the corpus.
- ✅ Verify at the step level before trusting any row you act on.
- ✅ Check environment-executability with a real command (`which`/env), not inference.
- ✅ Reconcile `docs/CHANGELOG.md` open ledger/waived items each run.
- ✅ Name the tradeoff for every runner-up.
- ✅ Update the registry before finishing, even if nothing changed.
- ❌ Recommend a phase whose hard deps aren't actually done — confirm, don't trust the
  "Phase Dependencies" line.
- ❌ Treat "0 steps checked" and "no checkboxes in the doc" as the same signal.
- ❌ Drop completed phases' history — they don't belong here ("what's next", not "what happened").
- ❌ Lose a `status: COMPLETED` phase's open items — capture them under "Not-fully-closed".
- ❌ Hand back a candidate list without the "why this rank" sentence.

## Examples

- Session: asked "which planning phase is most productive to take next". Audited the
  frontier, recommended a zero-dependency, bounded-scope, low-risk phase whose CLI binary
  was on PATH (implementable and live-verifiable in one session). Runners-up ranked lower
  on an architectural-decision ambiguity, paid multi-trial live LLM runs, or a multi-step
  strategic effort better served by a dedicated push.

## Related

- [self-improvement](../self-improvement/SKILL.md) — Phase-doc status hygiene (verification
  this skill relies on)
- [plan](../plan/SKILL.md) — drafts a new phase when no candidate fits
- [next-steps](../next-steps/SKILL.md) — implements the chosen phase
- [review-phase-plan](../review-phase-plan/SKILL.md) — validates the chosen plan
- [submodule-workflow](../submodule-workflow/SKILL.md) — registry lives in the submodule
- [docs/CHANGELOG.md](../../../docs/CHANGELOG.md) — the shipped-phase list reconciled against

---
exaix:
  skill_id: next-phase
  related_skills: [self-improvement, plan, next-steps, review-phase-plan, submodule-workflow]
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
