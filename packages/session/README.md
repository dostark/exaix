# @exaix/session

Phase 106 — **Session Delegation as a Governed Gate Strategy**.

`@exaix/session` models an interactive session tool (VS Code, Cursor, Claude
Code, OpenCode) as a **bounded external delegate** at a pipeline gate. It is a
package-pure implementation of the three-part brief → launch → return handoff
contract; runtime wiring (daemon watcher, gate hooks, CLI/TUI) lives in `apps/`.

> **Status: shipped in Phase 111.** Every component below is implemented,
> test-backed, and wired into production via `apps/daemon/main.ts`. The daemon
> constructs all session-delegation services when `session_delegate.enabled = true`.
> For the runtime wiring, gate hooks, and headless launch details, see
> `exaix-dev-docs/planning/phase-111-session-delegation-runtime-and-e2e.md`.

## Contract

| Stage         | Responsibility                                                                  |
| ------------- | ------------------------------------------------------------------------------- |
| **Brief**     | Materialize `Session/{traceId}/brief.json` (objective, scope, token budget).    |
| **Launch**    | A per-tool adapter builds a hardened launch descriptor (no shell, no secrets).  |
| **Return**    | The tool writes a mandatory `Session/{traceId}/return.json` (with token stats). |
| **Reconcile** | Validate scope, attribute cost, resume the gate's durable wait state.           |

## Components

- `session_adapter_registry.ts` / `i_session_adapter.ts` — `SessionAdapterRegistry`
  plus the four built-in adapters (`claude-code`, `opencode` are
  supervised-capable; `cursor`, `vscode` are advisory-only).
- `session_delegate_service.ts` — `prepareBrief` (atomic brief.json + single-use
  resume token) and `resolveLaunch`.
- `reconcile.ts` / `scope_checker.ts` — constant-time token binding, two-stage
  path-scope enforcement, gate/decision legality, non-blocking budget overage.
- `packages/session/src/wait/session_wait_store.ts` — durable wait-state shim (`ISessionWaitStore`),
  swappable for Phase 84's `WaitStateService`.
- `session_return_processor.ts` — reads brief+return, reconciles, resumes (the
  partial/forged/out-of-scope-safe core the daemon `SessionReturnWatcher` calls).
- `gate_mappers.ts` — maps a delegated return into the existing
  `ZPlanAmendmentDecision`, `Review` status, and `ClarificationSession` contracts.
- `supervised_launch.ts` — GAP-4 spawn hardening (`sanitizeChildEnv` secret strip,
  `assertBinaryAllowed`).
- `cost_mapping.ts` / `config_resolver.ts` / `event_payload.ts` — cost record
  (`session:<tool>`, USD sentinel), config precedence, typed event payload.
- `session_delegation.ts` — `ISessionDelegationCoordinator`/`ISessionDelegationRequest`, the
  typed entry point `@exaix/flow`'s `session_delegate_cycle` step handler drives once per
  hardened-plan step; every request carries a required `agentRole` (see below).
- `session_delegate_cycle_claim_store.ts` (Phase 174) — `SessionDelegateCycleClaimStore`, a
  SQLite-backed launch source of truth. `acquire()` inserts under a unique
  `(parentTraceId, parentStepId, sequence, planDigest)` key and returns the existing row on
  conflict rather than relaunching; `transition()` drives `claimed → launched → returned →
  reviewed | failed`.
- `session_delegate_cycle_store.ts` (Phase 174) — `SessionDelegateCycleStore`, an atomic
  temp-write/rename JSON checkpoint under `Memory/Execution/{parentTraceId}/
  session_delegate_cycles/{flowStepId}.json` mirroring `completedSteps`/`inFlight`/`status` for
  cheap resume without re-scanning claims. Never the authority on its own — the claim store's
  unique key is; the checkpoint is a resume convenience.

### Agent Role Threading (Phase 174)

Every `ISessionDelegationRequest` and `SessionBrief` now carries a **required** `agentRole` /
`agent_role` — the blueprint agent role actually delegating the session, sourced from the flow
step's own `agent_role:` field (`PlanExecutor`/`SessionDelegateCycleStepHandler` →
`SessionDelegationCoordinator` → `SessionDelegateService` → `opencode_permission_generator.ts`).
There is no default and no fallback constant: `generateOpencodePermissionConfig(...)` keys the
generated OpenCode agent config on whichever `agentRole` it is given, and
`resolveHardenedLaunch()`'s `agentNameMismatch` check compares the generated key against that
same value — so the check is keyed on the real delegating agent role, not a hardcoded name.

The security invariant is mechanical: only files and the typed `return.json`
cross back into the core pipeline — never session or conversation state.
