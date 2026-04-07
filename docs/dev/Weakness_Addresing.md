# Redesigned Weakness Planning Order — Ruflo-Informed Priority

The comparative analysis changes the calculus in two important ways. First, ExaIx already leads Ruflo substantially in auditability, memory hierarchy, and quality gating — so weaknesses that protect those differentiators become **more** urgent. Second, Ruflo reveals three genuine architectural gaps (shared flow state, parallel coordination, adaptive mid-execution reasoning) that are **not covered at all** by the current W1–W16 list and should enter as new phases before several lower-impact original weaknesses.

## Promoted in priority (now blocking competitive parity)

The Ruflo analysis reveals that ExaIx's sequential transform chain between flow steps is a real coordination bottleneck — Ruflo's blackboard namespace simultaneously closes W2/W3/W4 class problems and enables the parallel execution already present in `flow_runner.ts` to share state. This single addition has the highest leverage of anything in the backlog.

### Demoted or deferred

W9 (Deno runtime), W16 (.copilot/ git artifact), and W14 (multi-portal flows) have no competitive signal from Ruflo — Ruflo has no equivalent feature to compare against — and remain low-urgency.

---

## Sprint 1 — Already planned (correctness blockers)**

1. **Phase 61** — W2: AgentExecutor MCP subprocess integration _(P0 — blocks real execution)_
2. **Phase 62** — W7: PromptBudgetAllocator / context window coordinator _(P1 — silent overflow risk)_
3. **Phase 63** — W13: Flow-level error recovery, `onError` steps, checkpointing _(P1 — long flow resilience)_

## Sprint 2-A — New phases from Ruflo analysis (no W-number yet; highest competitive leverage)**

1. **Phase 64-R** — **Flow Namespace / Shared Blackboard** _(Ruflo Weakness 2+3 composite)_ — `shared.md` per flow, YAML-declared `namespace_reads`/`namespace_writes` per step; enables parallel identities to share discovered context without transform-chain threading; prerequisite for Phase 65-R
2. **Phase 65-R** — **Parallel Execution Groups in Flow YAML** _(Ruflo Weakness 3)_ — `parallel: group-x` flag, `Promise.all` fan-out, synthetic fan-in merge step; leverages existing wave executor already in `flow_runner.ts`
3. **Phase 66-R** — **Plan Amendment Gate** _(Ruflo Weakness 1 — adaptive reasoning)_ — bounded mid-execution re-plan triggered on `ConfidenceScorer < threshold`; diff against remaining approved steps only; adds Amendment Approval Gate without removing the Human-in-Loop gate

## Sprint 2-B — Original W-numbered high-value UX (adjusted order)**

1. **Phase 67** — W8: Live execution streaming + `exactl watch <trace_id>` _(SSE bus; closes real-time feedback gap; enables Plan Amendment Gate visibility)_
2. **Phase 68** — W1: Ollama embedding for semantic search _(Solo-tier vector search; prerequisite for W4 skills matching quality)_
3. **Phase 69** — W15: Token & cost persistence in Activity Journal + `exactl log cost` CLI

## Sprint 3 — Coherence & completeness**

1. **Phase 70** — W4: Wire `SkillsService.matchSkills()` into `AgentRunner` + `exactl skills list|show` commands _(procedural memory is an ExaIx differentiator Ruflo lacks — wire it)_
2. **Phase 71** — W5: Confidence-based memory auto-approval + pending-memory digest notification
3. **Phase 72** — W11: Git-hash portal knowledge invalidation _(replace time-based staleness)_
4. **Phase 73** — W12: ReflexiveAgent convergence detection + complexity-proportional iteration budget

## Sprint 3-B — New phase from Ruflo analysis**

1. **Phase 74-R** — **RoutingPolicy layer + capability-based identity selection** _(Ruflo Weakness 6)_ — blueprint version selection and traffic splitting driven by Activity Journal statistics; `capabilities[]` already in `ILoadedBlueprint` but unused for routing

## Sprint 4 — Architecture evolution**

1. **Phase 75** — W10: Plan TTL + stale-context detection before execution + pending-plan reminders
2. **Phase 76** — W3: HTTP API adapter layer (`POST /api/v1/requests`) + SSE clarification push stream
3. **Phase 77** — W6: Blueprint dual-path deprecation (`agents/` → WARN), merge `IBlueprint` types, `exactl blueprint migrate`
4. **Phase 78** — W16: Move `.copilot/` out of git + pre-commit hook + SQLite-vss incremental embedding

## Sprint 4-B — New phase from Ruflo analysis (bounded delegation)**

1. **Phase 79-R** — **Bounded Delegation Tool** _(Ruflo Weakness 5)_ — `delegate_to_identity` as a declarable plan step; sub-identity output returned as tool result linked to parent `trace_id`; `max_steps` cap prevents unbounded recursion; requires careful audit schema extension

## Deferred / low urgency**

1. **Phase 80** — W14: Multi-portal flow support _(Team+ only; no Ruflo analog; defer until Flow Namespace from Phase 64-R is stable)_
2. **Phase 81** — W9: Dockerfile + Deno onboarding _(no competitive pressure; Ruflo is Node-native so this only matters for contributor friction)_
