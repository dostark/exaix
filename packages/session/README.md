# @exaix/session

Phase 106 — **Session Delegation as a Governed Gate Strategy**.

`@exaix/session` models an interactive session tool (VS Code, Cursor, Claude
Code, OpenCode) as a **bounded external delegate** at a pipeline gate. It is a
package-pure implementation of the three-part brief → launch → return handoff
contract; runtime wiring (daemon watcher, gate hooks, CLI/TUI) lives in `apps/`.

## Contract

| Stage         | Responsibility                                                                  |
| ------------- | ------------------------------------------------------------------------------- |
| **Brief**     | Materialize `Session/{traceId}/brief.json` (objective, scope, token budget).    |
| **Launch**    | A per-tool adapter builds a hardened launch descriptor (no shell, no secrets).  |
| **Return**    | The tool writes a mandatory `Session/{traceId}/return.json` (with token stats). |
| **Reconcile** | Validate scope, attribute cost, resume the gate's durable wait state.           |

## Components

- `packages/session/src/i_session_adapter.ts` — `ISessionAdapter` / `ISessionLaunch`
  launch-strategy contract.
- `packages/session/src/session_adapter_registry.ts` — `SessionAdapterRegistry`
  plus the four built-in adapters (`claude-code`, `opencode` are
  supervised-capable; `cursor`, `vscode` are advisory-only).

The security invariant is mechanical: only files and the typed `return.json`
cross back into the core pipeline — never session or conversation state.
