---
agent: antigravity
scope: dev
title: "Phase 61: AgentExecutor MCP Integration & Real-World Execution"
short_summary: "Replace the code-description stub in AgentExecutor with a robust Model Context Protocol (MCP) subprocess execution strategy, enabling secure, git-audited file system operations via spawned agents while unifying the execution engine under the IExecutionStrategy pattern."
version: "1.0"
topics: ["agent-executor", "mcp", "subprocess", "security", "git-audit", "execution-strategy", "identities"]
---

# Phase 61: AgentExecutor MCP Integration & Real-World Execution

## Executive Summary

Exaix currently suffers from a critical architectural gap (**W2**) where the `AgentExecutor`—intended to be the engine for autonomous plan execution—is effectively a "simulator." It asks an LLM to describe changes rather than executing them using tools. This phase replaces the hardcoded SHAs and LLM-only simulation with a robust **Out-of-Process Execution Model** using the Model Context Protocol (MCP).

By integrating the `SafeSubprocess` lifecycle with the local `ToolRegistry`, Exaix will transition from "descriptive" to "executive" agency. This phase also finalizes the **Identity Migration (W6)** by grounding all blueprint loading in the `Identities/` directory.

### **Design Principles**

- **Grounding over Simulation** — Every commit SHA must be derived from a real `git rev-parse`, not an LLM hallucination.
- **Isolated Execution** — Agents run in a separate Deno process with restricted permissions (`--allow-read`, `--allow-net`).
- **Unified Interface** — Both ReAct loops and MCP sub-processes use a shared `IExecutionStrategy` contract.
- **Security-First Audit** — Automated git porcelain audits verify that every modification matches the agent's authorized scope.

---

## Current vs. Target Execution Path

### **Before (W2 Stub)**
```text
AgentExecutor.executeStep()
  ├── Load Blueprint (from deprecated agents/ path)
  ├── Build Prompt (Simulation-style)
  ├── provider.generate() (LLM describes files and SHAs)
  └── Return HARDCODED "abc123456..." SHA
```

### **After (Phase 61)**
```text
AgentExecutor.executeStep()
  ├── Load Identity (from Identities/ path)
  ├── Factory resolves Strategy (McpAgentStrategy)
  ├── McpAgentStrategy.execute()
  │     ├── Spawn SafeSubprocess (exaix-agent)
  │     ├── MCP Handshake (JSON-RPC over stdio)
  │     ├── Tool Calls → Local ToolRegistry Bridge
  │     └── Capture Final git commit SHA
  └── Git Audit (Verify porcelain status vs. authorizedPaths)
```

---

## Implementation Plan

### Step 61.1: Strategy Pattern & Identity Refactoring

- **Action**: Define `IExecutionStrategy` and update `AgentExecutor` to dispatch execution using the strategy pattern.
- **Justification**: Breaks hardcoded stubs and aligns with the **W6** identity migration.
- **Dependencies**: Phase 60.

**Success Criteria:**
- [ ] `IExecutionStrategy` interface defined in `src/services/agent/strategies/execution_strategy.ts`.
- [ ] `AgentExecutor` accepts a strategy registry in its constructor.
- [ ] `loadBlueprint` logic updated to use `Identities/` directory and `IdentityBlueprint` naming.
- [ ] Identity-level `permitted_tools` (from Phase 56) are correctly parsed and passed to strategies.

**Planned Tests:**
- **Unit**: `tests/unit/agent/strategy_registry_test.ts` — verify registration of McpAgent and ReActLoop strategies.
- **Unit**: `tests/unit/agent/blueprint_identity_load_test.ts` — verify correct path resolution for Identities.

---

### Step 61.2: McpAgentStrategy Subprocess Lifecycle

- **Action**: Implement the `SafeSubprocess` management engine for out-of-process agents.
- **Justification**: Provides the "Executive" foundation for **W2**.
- **Dependencies**: Step 61.1.

**Success Criteria:**
- [ ] `McpAgentStrategy` successfully launches `exaix-agent` as a separate Deno process.
- [ ] Environment variables and Deno permission flags (--allow-read, etc.) are dynamically built based on SecurityMode.
- [ ] Parent-Child handshake established via `JSON-RPC` over `stdio`.
- [ ] Strategy captures subprocess exit codes and translates crashes into `AgentExecutionError`.

**Planned Tests:**
- **Integration**: `tests/integration/agent/mcp_handshake_test.ts` — verify RPC initialization between parent and child.
- **Functional**: `tests/functional/agent/subprocess_isolation_test.ts` — verify that a spawned agent is restricted to authorized directories.

---

### Step 61.3: Real-World MCP Tool Bridge

- **Action**: Route subprocess tool calls to the local `ToolRegistry` and capture real SHAs.
- **Justification**: Resolves the core "hallucination" problem of W2.
- **Dependencies**: Step 61.2.

**Success Criteria:**
- [ ] Subprocess `tool_calls` are intercepted and executed by the parent's `ToolRegistry`.
- [ ] File system side-effects (write_file, patch_file) are physically committed to the portal worktree.
- [ ] `IChangesetResult` contains a real `git rev-parse HEAD` SHA after the agent completes its task.
- [ ] Subprocess output is piped to the `EventLogger` for real-time monitoring.

**Planned Tests:**
- **Integration**: `tests/integration/agent/mcp_real_execution_test.ts` — verify that a spawned agent creates a real commit.
- **Functional**: `tests/functional/agent/SHA_accuracy_test.ts` — verify that the returned SHA matches the actual git HEAD.

---

### Step 61.4: Security Audit & Automatic Revert

- **Action**: Implement git porcelain audit post-execution and automated revert logic.
- **Justification**: Satisfies **W2/W7/W13**; provides the "safety net" for autonomous execution.
- **Dependencies**: Step 61.3.

**Success Criteria:**
- [ ] Audit runs immediately after execution, comparing `git status --porcelain` output against `allowedPaths`.
- [ ] `revertUnauthorizedChanges` triggers if the audit detects any unauthorized file modification.
- [ ] Security violations are logged to the `Activity Journal` with `HIGH` severity.
- [ ] Execution is marked as `FAILED` if isolation is breached.

**Planned Tests:**
- **Security**: `tests/security/agent_isolation_audit_test.ts` — simulate an agent attempting to modify a file outside its portal and verify it is reverted.
- **Unit**: `tests/unit/agent/git_audit_parser_test.ts` — verify parsing of complex git porcelain status.

---

### Step 61.5: Strategy Unification & Parity

- **Action**: Migrate legacy `ExecutionLoop` reasoning into the `ReActLoopStrategy` and ensure logging parity.
- **Justification**: Finalizes the unification required by **W2**.
- **Dependencies**: Step 61.4.

**Success Criteria:**
- [ ] `ReActLoopStrategy` implemented using reasoning logic from `src/services/execution_loop.ts`.
- [ ] Both strategies (MCP and ReAct) emit identical event schemas to the `Activity Journal`.
- [ ] Existing TDD/Refactoring scenarios continue to pass using the unified strategy engine.

**Planned Tests:**
- **Regression**: `tests/regression/strategy_parity_test.ts` — run same request through both strategies and verify result schema consistency.
- **Load**: `tests/load/agent_executor_strategy_swap_test.ts` — verify that swapping strategies at runtime causes no internal state corruption.

---

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
| :--- | :--- | :--- | :--- |
| **R1: Subprocess Orphanage** | System instability / resource leaks | Medium | Implement PID tracking and a `SIGINT` cleanup handler in `SafeSubprocess`. |
| **R2: Git Audit False Negatives** | Security breach (unauthorized changes) | Low | Use `git status --porcelain=v1` for deterministic parsing and assume any unknown change is unauthorized. |
| **R3: MCP Latency** | Degraded UX for real-time tasks | Medium | Implement persistent JSON-RPC heartbeats and optimize Deno startup time using pre-cached modules. |
| **R4: Strategy Divergence** | Broken TUI / Journal parsing | High | Centralize result validation in `AgentExecutor` using the shared `ChangesetResultSchema`. |

---

## Success Metrics

### **Functional Goals**
- [ ] All `commit_sha` entries in the Activity Journal correspond to real git commits (100% accuracy).
- [ ] `IAgentFileBlueprint` loading is purely identity-based and grounded in the `Identities/` directory.
- [ ] Spawned agents successfully receive context and return completion signals via MCP.

### **Security & Quality**
- [ ] Zero unauthorized file modifications persist after the post-execution audit runs.
- [ ] TypeScript compilation: 0 errors in the `agent_executor` module.
- [ ] 100% of the planned "Phase 61" Integration suite passes in CI.

---
**Agent Instructions**: Follow the steps in order. Each step MUST pass its associated planned tests before proceeding to the next. Do not mark steps as completed until the `ci.ts` pipeline returns a PASS for the specific test category.
