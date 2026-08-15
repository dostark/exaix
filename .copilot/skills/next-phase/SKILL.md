---
name: next-phase
agent: general
scope: dev
title: "Next Phase Selection (#next-phase)"
description: "Analyze exaix-dev-docs/planning/ to pick the single most productive not-yet-complete phase to implement next — verifies real completion state at the step level, checks the dependency graph, risk, scope, and environment-executability, and maintains PHASE_REGISTRY.md so repeat runs are cheap"
short_summary: "Pick the most productive next phase from exaix-dev-docs/planning/ by dependency/risk/scope/environment-executability, backed by a maintained PHASE_REGISTRY.md cache."
version: "1.0.0"
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
  self-improvement Phase-loop retro: run this after closing a phase, not just when asked).

Not this skill: implementing the chosen phase's steps (`#next-steps`), drafting a new plan
from a blank page (`#plan`), or auditing/repairing a doc's own stale header once you already
know which phase you're touching (`#self-improvement`'s Phase-doc status hygiene).

## The registry: `exaix-dev-docs/planning/PHASE_REGISTRY.md`

A hand-maintained (agent-maintained) index of every **not-yet-complete** phase — complete,
cancelled, and postponed phases are dropped from it entirely (they're not candidates, and
keeping them bloats the file for no benefit). Columns:

| Column | Meaning |
| --- | --- |
| Phase | `NNN` |
| Title | short title |
| Real status | the VERIFIED state (may differ from the doc's own header text) |
| Hard deps | phase numbers that must be ✅ before this can start; `None` if unblocked |
| Blocking? | `Ready` / `Blocked on <N>` / `Needs <resource>` (e.g. an env var, a GPU runner) |
| Risk | L / M / M-H / H, from the doc's own Risk Level line |
| Scope | step count or size signal (rough sizing, not a promise) |
| Env-executable | can this be implemented AND live-verified in a typical session right now, or does it need something absent (API key, binary, external infra)? |
| Notes | the one sentence that matters — why it's ready, why it's not, what's odd about it |
| Verified | date this row's verdict was checked against the real doc |

A row is **stale** the moment `git log -1 --format=%H -- planning/<file>` (run inside the
`exaix-dev-docs` submodule) returns a commit newer than the row's `Verified` date, or a
listed dependency's own status changed. Re-audit stale rows before relying on them for a
recommendation; don't just trust old prose.

**Bootstrapping** (registry missing or badly out of date): scan `exaix-dev-docs/planning/`
for every phase doc, classify each via self-improvement's Phase-doc status hygiene rules,
drop everything Complete/Cancelled/Postponed, and write one row per survivor. Full-corpus
scans are expensive (166+ files) — do this rarely, prefer incremental refresh.

## Procedure

1. **Read the registry.** If it doesn't exist, bootstrap it (above).
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
1. **Update the registry**: write/refresh every row you touched, bump `Verified`, and keep
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
- ✅ Do name the tradeoff for every runner-up, not just the top pick.
- ✅ Do update the registry before finishing, even if the answer was "nothing changed."
- ❌ Don't recommend a phase whose hard dependencies aren't actually done — check, don't
  trust a doc's own "Phase Dependencies" line without confirming those phases' real state.
- ❌ Don't treat "0 steps checked" and "this doc doesn't track completion with
  checkboxes at all" as the same signal — the latter needs a different doc-open, not a
  confident verdict either way.
- ❌ Don't drop completed/cancelled/postponed phases' history — they simply don't belong
  in this registry (it exists to answer "what's next", not "what happened").
- ❌ Don't hand back a plain list of candidates with no ranking rationale — every entry
  needs the "why this rank" sentence.

## Examples

- Session (2026-08-15): asked "which planning phase is most productive to take next".
  Audited the active 130-167 frontier plus spot-checked older phases; recommended
  Phase 166 (Codex CLI Delegate) — zero dependencies, 5 bounded steps, Risk L, and the
  `codex` CLI binary was confirmed present (`which codex` → `codex-cli 0.77.0`), so it was
  both implementable and live-verifiable in the same session. Runners-up: Phase 154 (MCP
  Tool Catalog Unification — ready but Step 2 carries a real architectural-decision
  ambiguity), Phase 161 (Identity Persona Value Isolation — ready but needs paid,
  multi-trial live LLM runs across the identity catalog), Phase 145-149 (the
  eval-framework-maturation cluster — all legitimate, but each is a multi-step strategic
  initiative better suited to a dedicated push than a single "what's next" pick).

## Related

- [self-improvement](../self-improvement/SKILL.md) — Phase-doc status hygiene: the
  step-level verification procedure this skill depends on for every registry row
- [plan](../plan/SKILL.md) — drafts a new phase when no existing candidate fits
- [next-steps](../next-steps/SKILL.md) — implements the chosen phase's steps once picked
- [pre-gap-analysis](../pre-gap-analysis/SKILL.md) — validates the chosen phase's plan
  before implementation begins
- [submodule-workflow](../submodule-workflow/SKILL.md) — `PHASE_REGISTRY.md` lives in the
  `exaix-dev-docs` submodule; commit/pointer-bump discipline applies

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
    - "Recommend one top pick plus 2-3 ranked runners-up, each with a stated reason"
    - "Update PHASE_REGISTRY.md with every row touched before finishing"
  output_requirements:
    - "One clear top-pick recommendation with evidence"
    - "2-3 named runners-up, each with a reason it ranks lower"
    - "PHASE_REGISTRY.md updated to reflect the audit"
    - "Explicit statement when no candidate is ready, naming the blocker"
  quality_criteria:
    - name: evidence_grounding
      description: Every readiness/risk/scope claim is backed by something actually read, not inferred
      weight: 30
    - name: registry_freshness
      description: PHASE_REGISTRY.md is left current, not stale, after the run
      weight: 25
    - name: ranking_rationale
      description: Every candidate's rank (including runners-up) has a stated reason
      weight: 25
    - name: environment_check
      description: Environment-executability is verified with a real command, not assumed
      weight: 20
---
