# @exaix/session

Phase 106 — **Session Delegation as a Governed Gate Strategy**.

`@exaix/session` models an interactive session tool (VS Code, Cursor, Claude
Code, OpenCode) as a **bounded external delegate** at a pipeline gate. It is a
package-pure implementation of the three-part brief → launch → return handoff
contract; runtime wiring (daemon watcher, gate hooks, CLI/TUI) lives in `apps/`.

> **Status: package complete; not yet reached by production.** Every component
> below is implemented and test-backed, but no live path imports this package
> yet — the daemon-startup registration, gate hooks, headless launch, and CLI are
> tracked in **Phase 111** (`exaix-dev-docs/planning/phase-111-session-delegation-runtime-and-e2e.md`)
> and its Reachability Ledger. Until then, `session_delegate.enabled = true` has no
> runtime effect.

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
- `wait/session_wait_store.ts` — durable wait-state shim (`ISessionWaitStore`),
  swappable for Phase 84's `WaitStateService`.
- `session_return_processor.ts` — reads brief+return, reconciles, resumes (the
  partial/forged/out-of-scope-safe core the daemon `SessionReturnWatcher` calls).
- `gate_mappers.ts` — maps a delegated return into the existing
  `ZPlanAmendmentDecision`, `Review` status, and `ClarificationSession` contracts.
- `supervised_launch.ts` — GAP-4 spawn hardening (`sanitizeChildEnv` secret strip,
  `assertBinaryAllowed`).
- `cost_mapping.ts` / `config_resolver.ts` / `event_payload.ts` — cost record
  (`session:<tool>`, USD sentinel), config precedence, typed event payload.

The security invariant is mechanical: only files and the typed `return.json`
cross back into the core pipeline — never session or conversation state.
