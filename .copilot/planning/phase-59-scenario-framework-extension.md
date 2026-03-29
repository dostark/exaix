---
agent: qwen
scope: dev
title: "Phase 59: Scenario Framework Extension for Dynamic Execution & New MCP Tools"
short_summary: "Extend the scenario framework with comprehensive test scenarios for Phase 56/57/58 features: dynamic tool selection, ReAct reasoning engine, and new MCP tool handlers."
version: "1.0"
topics: ["scenario-framework", "testing", "dynamic-execution", "react", "mcp-tools", "integration-tests"]
---

> [!NOTE]
> **Status: ⏳ Pending**
> This phase extends the scenario framework to validate all features introduced in Phases 56, 57, and 58.
> New scenarios will test dynamic tool selection, ReAct reasoning, and the six new MCP tool handlers
> in realistic end-to-end workflows.
>
> **Prerequisites:**
> - Phase 56 (Dynamic Tool Selection) — provides `execution_mode`, `permitted_tools`, `DynamicStepExecutor`
> - Phase 57 (New MCP Tools) — provides `patch_file`, `delete_file`, `move_file`, `create_directory`, `run_command`, `search_files`
> - Phase 58 (ReAct Reasoning Engine) — provides `LlmClient`, `McpClient`, `ActivityJournal`, FlowRunner integration

## Executive Summary

The scenario framework currently has 5 scenarios in the `agent_flows` pack, covering:
- Request analysis smoke tests
- Portal knowledge snapshot
- Quality gate clarification
- Memory-aware analysis
- Acceptance criteria propagation

**This phase adds 12 new scenarios** organized into 3 new scenario packs:

| Pack | Scenarios | Focus |
|------|-----------|-------|
| `dynamic_execution` | 4 | Dynamic tool selection, ReAct loops, permission boundaries |
| `mcp_tools_extended` | 5 | New MCP tool handlers in realistic workflows |
| `integration_e2e` | 3 | End-to-end flows combining all new features |

### **Design Principles**

- **Realistic workflows** — scenarios mirror actual user tasks (refactoring, codebase exploration, dependency mapping)
- **Measurable criteria** — every step has input/output criteria that can be automatically validated
- **Mode compatibility** — scenarios support `auto` mode for CI and `manual-checkpoint` for debugging
- **Evidence capture** — all tool calls, journal entries, and artifacts are preserved for audit
- **Provider flexibility** — scenarios work with mock providers (CI) and real LLMs (manual validation)

---

## Goals

- [ ] Create `dynamic_execution` scenario pack with 4 scenarios
- [ ] Create `mcp_tools_extended` scenario pack with 5 scenarios
- [ ] Create `integration_e2e` scenario pack with 3 scenarios
- [ ] Add shared fixtures for new scenarios (request templates, sample portals)
- [ ] Extend scenario schema to support flow execution steps
- [ ] Add assertions for Activity Journal validation
- [ ] Write framework tests for new step types and criteria
- [ ] Update scenario framework documentation with new features
- [ ] Add CI profile for extended scenarios (`ci-extended-dynamic`)

---

## Scenario Pack 1: Dynamic Execution

### Scenario 1.1: `dynamic-exploration-smoke`

**Purpose:** Validate basic dynamic tool selection with read-only tools.

**Workflow:**
1. Mount a sample codebase portal
2. Execute a dynamic step to explore the codebase structure
3. Verify that the model used `read_file`, `list_directory`, and `search_files` appropriately
4. Verify Activity Journal contains all tool calls with trace IDs

**Scenario YAML:**
```yaml
schema_version: "1.0.0"
id: "dynamic-exploration-smoke"
title: "Dynamic step explores codebase using read-only tools"
pack: "dynamic_execution"
tags: ["smoke", "dynamic", "read-only"]
request_fixture: "fixtures/requests/dynamic_execution/explore_codebase.md"
mode_support: ["auto", "manual-checkpoint"]
portals:
  - alias: "sample-ts-project"
    source_path: "/tmp/sample-ts-project"
flow_fixture: "fixtures/flows/dynamic_execution/explore.flow.yaml"
steps:
  - id: "execute-flow"
    type: "exactl"
    command: "flow run explore.flow.yaml --request $REQUEST_FIXTURE"
    input_criteria:
      - id: "flow-file-exists"
        kind: "file-found"
        path_pattern: "fixtures/flows/dynamic_execution/explore.flow.yaml"
    output_criteria:
      - id: "flow-execution-succeeded"
        kind: "command-exit-code"
        equals: 0
  - id: "verify-journal"
    type: "exactl"
    command: "journal query --trace-id $FLOW_TRACE_ID --format json"
    output_criteria:
      - id: "tool-calls-logged"
        kind: "json-query"
        query: ".[].action_type"
        contains: ["mcp.tool.read_file", "mcp.tool.list_directory", "mcp.tool.search_files"]
      - id: "trace-id-present"
        kind: "json-query"
        query: ".[].trace_id"
        not_empty: true
  - id: "verify-output"
    type: "wait-for-file"
    args: ["**/flow_run_*.json"]
    timeout_sec: 120
    output_criteria:
      - id: "dynamic-step-completed"
        kind: "json-query"
        query: ".steps[?@.execution_mode=='dynamic'].completed"
        equals: true
```

**Request Fixture (`explore_codebase.md`):**
```markdown
---
trace_id: "explore-{{timestamp}}"
created: "{{timestamp}}"
status: "pending"
priority: "normal"
source: "cli"
created_by: "scenario-framework"
---

# Explore Codebase Structure

Please explore the mounted `sample-ts-project` portal and provide a summary of:
1. The main entry points
2. Key modules and their responsibilities
3. Any configuration files present

Use the available tools to explore the codebase efficiently.
```

**Flow Fixture (`explore.flow.yaml`):**
```yaml
# @schema-version: 1.0.0
---
id: "explore-codebase"
name: "Explore Codebase Structure"
version: "1.0.0"
steps:
  - id: "explore"
    name: "Explore and analyze codebase structure"
    identity: "researcher"
    execution_mode: "dynamic"
    permitted_tools:
      - read_file
      - list_directory
      - search_files
    input:
      source: "request"
    timeout: 60000
```

**Success Criteria:**
- [ ] Flow executes without errors
- [ ] At least 3 tool calls are logged in the Activity Journal
- [ ] All tool calls have the same trace ID
- [ ] Dynamic step completes within timeout
- [ ] Output contains codebase structure summary

---

### Scenario 1.2: `dynamic-permission-boundary`

**Purpose:** Validate that dynamic steps cannot use write tools.

**Workflow:**
1. Create a flow with a dynamic step that incorrectly lists `write_file` in `permitted_tools`
2. Run `exactl flow validate` to verify it produces a warning
3. Attempt to execute the flow and verify it fails gracefully

**Scenario YAML:**
```yaml
schema_version: "1.0.0"
id: "dynamic-permission-boundary"
title: "Dynamic steps reject write tools in permitted_tools"
pack: "dynamic_execution"
tags: ["security", "dynamic", "validation"]
request_fixture: "fixtures/requests/dynamic_execution/write_attempt.md"
mode_support: ["auto"]
portals: []
flow_fixture: "fixtures/flows/dynamic_execution/invalid-write.flow.yaml"
steps:
  - id: "validate-flow"
    type: "exactl"
    command: "flow validate invalid-write.flow.yaml"
    output_criteria:
      - id: "validation-warning"
        kind: "command-output-contains"
        contains: ["write_file", "not allowed", "dynamic"]
  - id: "execute-flow-expect-failure"
    type: "exactl"
    command: "flow run invalid-write.flow.yaml --request $REQUEST_FIXTURE"
    expect_failure: true
    output_criteria:
      - id: "execution-blocked"
        kind: "command-output-contains"
        contains: ["write tool", "dynamic mode", "not permitted"]
```

**Flow Fixture (`invalid-write.flow.yaml`):**
```yaml
# @schema-version: 1.0.0
---
id: "invalid-write-attempt"
name: "Invalid Write Tool in Dynamic Mode"
version: "1.0.0"
steps:
  - id: "write-attempt"
    name: "Attempt to write file in dynamic mode"
    identity: "senior-coder"
    execution_mode: "dynamic"
    permitted_tools:
      - read_file
      - write_file  # This should be rejected
    input:
      source: "request"
```

**Success Criteria:**
- [ ] `exactl flow validate` produces a warning about write tools in dynamic mode
- [ ] Flow execution fails gracefully with descriptive error
- [ ] No files are modified

---

### Scenario 1.3: `react-reasoning-loop`

**Purpose:** Validate ReAct reasoning loop with multiple iterations.

**Workflow:**
1. Create a dynamic step that requires multiple tool calls to complete
2. Execute with a real LLM provider (or recorded mock)
3. Verify that the model iteratively selects tools based on observations
4. Verify all reasoning steps are logged

**Scenario YAML:**
```yaml
schema_version: "1.0.0"
id: "react-reasoning-loop"
title: "ReAct loop executes multiple iterations to complete objective"
pack: "dynamic_execution"
tags: ["react", "dynamic", "provider-live"]
request_fixture: "fixtures/requests/dynamic_execution/find_and_summarize.md"
mode_support: ["manual-checkpoint"]
portals:
  - alias: "sample-ts-project"
    source_path: "/tmp/sample-ts-project"
flow_fixture: "fixtures/flows/dynamic_execution/find_and_summarize.flow.yaml"
steps:
  - id: "execute-flow"
    type: "exactl"
    command: "flow run find_and_summarize.flow.yaml --request $REQUEST_FIXTURE"
    checkpoint: true
    output_criteria:
      - id: "flow-succeeded"
        kind: "command-exit-code"
        equals: 0
  - id: "verify-iterations"
    type: "exactl"
    command: "journal query --trace-id $FLOW_TRACE_ID --action dynamic_step_event --format json"
    output_criteria:
      - id: "multiple-iterations"
        kind: "json-query"
        query: "length"
        min: 3
      - id: "tool-calls-logged"
        kind: "json-query"
        query: ".[].tool_name"
        unique_count_min: 2
```

**Success Criteria:**
- [ ] ReAct loop completes within max_iterations (10)
- [ ] At least 3 iterations are logged
- [ ] At least 2 different tools are used
- [ ] Final output satisfies the step objective

---

### Scenario 1.4: `dynamic-step-timeout`

**Purpose:** Validate that dynamic steps respect timeout configuration.

**Workflow:**
1. Create a dynamic step with a short timeout (5 seconds)
2. Use a mock LLM that delays responses
3. Verify the step terminates gracefully after timeout

**Scenario YAML:**
```yaml
schema_version: "1.0.0"
id: "dynamic-step-timeout"
title: "Dynamic steps respect timeout configuration"
pack: "dynamic_execution"
tags: ["timeout", "dynamic", "error-handling"]
request_fixture: "fixtures/requests/dynamic_execution/timeout_test.md"
mode_support: ["auto"]
portals: []
flow_fixture: "fixtures/flows/dynamic_execution/timeout.flow.yaml"
steps:
  - id: "execute-flow"
    type: "exactl"
    command: "flow run timeout.flow.yaml --request $REQUEST_FIXTURE"
    expect_failure: true
    output_criteria:
      - id: "timeout-error"
        kind: "command-output-contains"
        contains: ["timeout", "max iterations"]
```

**Success Criteria:**
- [ ] Step terminates within 2x the configured timeout
- [ ] Error message indicates timeout/max iterations
- [ ] Partial results are logged

---

## Scenario Pack 2: MCP Tools Extended

### Scenario 2.1: `patch-file-refactor`

**Purpose:** Validate `patch_file` tool for targeted code refactoring.

**Workflow:**
1. Create a sample TypeScript file with a function to rename
2. Execute a flow that uses `patch_file` to rename the function
3. Verify the file was modified correctly
4. Verify no other content was changed

**Scenario YAML:**
```yaml
schema_version: "1.0.0"
id: "patch-file-refactor"
title: "Patch file performs targeted refactoring"
pack: "mcp_tools_extended"
tags: ["patch_file", "refactoring", "write-tools"]
request_fixture: "fixtures/requests/mcp_tools/refactor_function.md"
mode_support: ["auto", "manual-checkpoint"]
portals:
  - alias: "refactor-target"
    source_path: "/tmp/refactor-target"
flow_fixture: "fixtures/flows/mcp_tools/refactor.flow.yaml"
steps:
  - id: "setup"
    type: "shell"
    command: "cp"
    args: ["-r", "fixtures/portals/refactor-target", "$PORTAL_DIR"]
  - id: "execute-flow"
    type: "exactl"
    command: "flow run refactor.flow.yaml --request $REQUEST_FIXTURE"
    output_criteria:
      - id: "flow-succeeded"
        kind: "command-exit-code"
        equals: 0
  - id: "verify-patch"
    type: "shell"
    command: "grep"
    args: ["-c", "export function newName", "$PORTAL_DIR/src/main.ts"]
    output_criteria:
      - id: "function-renamed"
        kind: "command-exit-code"
        equals: 0
      - id: "old-name-removed"
        type: "shell"
        command: "grep"
        args: ["-c", "export function oldName", "$PORTAL_DIR/src/main.ts"]
        equals: 0
```

**Success Criteria:**
- [ ] Function is renamed correctly
- [ ] No other content is modified
- [ ] File structure is preserved

---

### Scenario 2.2: `delete-file-cleanup`

**Purpose:** Validate `delete_file` tool for removing dead code.

**Workflow:**
1. Create a portal with deprecated files
2. Execute a flow that identifies and deletes deprecated files
3. Verify files are deleted
4. Verify remaining files are untouched

---

### Scenario 2.3: `move-file-restructure`

**Purpose:** Validate `move_file` tool for codebase restructuring.

**Workflow:**
1. Create a portal with files in incorrect locations
2. Execute a flow that moves files to correct locations
3. Verify files are moved correctly
4. Verify directory structure is updated

---

### Scenario 2.4: `search-files-discovery`

**Purpose:** Validate `search_files` tool for codebase discovery.

**Workflow:**
1. Create a portal with various file types
2. Execute a flow that searches for specific patterns
3. Verify correct files are found
4. Verify search results are portal-relative paths

---

### Scenario 2.5: `run-command-build`

**Purpose:** Validate `run_command` tool for build verification.

**Workflow:**
1. Create a portal with a buildable project
2. Execute a flow that runs build commands
3. Verify build succeeds
4. Verify build output is captured

---

## Scenario Pack 3: Integration End-to-End

### Scenario 3.1: `full-refactoring-workflow`

**Purpose:** End-to-end test combining dynamic exploration + targeted patches.

**Workflow:**
1. Dynamic step: Explore codebase to find refactoring opportunities
2. Declared step: Human approves refactoring plan
3. Dynamic step: Execute patches using `patch_file`
4. Declared step: Run build verification with `run_command`

---

### Scenario 3.2: `codebase-mapping-with-journal`

**Purpose:** End-to-end test validating full Activity Journal auditability.

**Workflow:**
1. Execute a multi-step flow with mixed execution modes
2. Query Activity Journal for all tool calls
3. Verify trace ID correlation across steps
4. Verify journal entries include all required fields

---

### Scenario 3.3: `permission-escalation-prevention`

**Purpose:** End-to-end security validation of permission boundaries.

**Workflow:**
1. Create flows with various permission boundary violations
2. Execute and verify all violations are caught
3. Verify no unauthorized tool calls are executed
4. Verify security events are logged

---

## Implementation Plan

### Task 1: Scenario Fixtures

**Files to create:**
- `fixtures/requests/dynamic_execution/*.md` (4 request templates)
- `fixtures/requests/mcp_tools/*.md` (5 request templates)
- `fixtures/flows/dynamic_execution/*.yaml` (4 flow definitions)
- `fixtures/flows/mcp_tools/*.yaml` (5 flow definitions)
- `fixtures/portals/sample-ts-project/` (sample TypeScript project)
- `fixtures/portals/refactor-target/` (sample project for refactoring)

**Estimated effort:** 2 days

---

### Task 2: Scenario Definitions

**Files to create:**
- `scenarios/dynamic_execution/*.yaml` (4 scenarios)
- `scenarios/mcp_tools_extended/*.yaml` (5 scenarios)
- `scenarios/integration_e2e/*.yaml` (3 scenarios)

**Estimated effort:** 2 days

---

### Task 3: Framework Extensions

**Files to modify:**
- `tests/scenario_framework/schema/step_schema.ts` — add flow execution step type
- `tests/scenario_framework/runner/executor.ts` — add flow execution handler
- `tests/scenario_framework/runner/assertions.ts` — add journal query assertions
- `tests/scenario_framework/runner/assertions.ts` — add JSON query assertions

**Estimated effort:** 1.5 days

---

### Task 4: Framework Tests

**Files to create:**
- `tests/scenario_framework/tests/unit/dynamic_execution_test.ts`
- `tests/scenario_framework/tests/unit/mcp_tools_assertions_test.ts`
- `tests/scenario_framework/tests/integration/journal_query_test.ts`

**Estimated effort:** 1 day

---

### Task 5: Documentation

**Files to update:**
- `tests/scenario_framework/README.md` — add new scenario packs
- `tests/scenario_framework/VALIDATION_GUIDE.md` — add dynamic execution examples
- `.copilot/docs/documentation.md` — index new scenarios

**Estimated effort:** 0.5 days

---

## Success Criteria

### Functional Requirements

- [ ] All 12 scenarios execute successfully in `auto` mode
- [ ] All scenarios support `manual-checkpoint` mode where specified
- [ ] Activity Journal queries return correct data
- [ ] Flow execution steps work correctly
- [ ] JSON query assertions work correctly
- [ ] All new MCP tools are tested

### Quality Requirements

- [ ] TypeScript compilation: zero errors
- [ ] All framework tests pass
- [ ] No regressions in existing scenarios
- [ ] Documentation is complete and accurate

### Performance Requirements

- [ ] Smoke scenarios complete in < 30 seconds
- [ ] Core scenarios complete in < 2 minutes
- [ ] Extended scenarios complete in < 10 minutes

---

## Implementation Timeline

| Task | Description | Duration | Dependencies |
|------|-------------|----------|--------------|
| **Task 1** | Create scenario fixtures | 2 days | None |
| **Task 2** | Create scenario definitions | 2 days | Task 1 |
| **Task 3** | Extend framework schema and executor | 1.5 days | None |
| **Task 4** | Write framework tests | 1 day | Task 3 |
| **Task 5** | Update documentation | 0.5 days | Task 2, Task 4 |

**Estimated Total:** 7 days

---

## Related Work

- **Phase 56:** Dynamic Tool Selection — provides `execution_mode`, `permitted_tools`
- **Phase 57:** New MCP Tool Handlers — provides 6 new tools
- **Phase 58:** ReAct Reasoning Engine — provides `LlmClient`, `McpClient`, `ActivityJournal`
- **Phase 48:** Dynamic criteria merging — established precedent for runtime-determined behavior

---

## References

- [`tests/scenario_framework/README.md`](../../tests/scenario_framework/README.md) — Scenario framework documentation
- [`tests/scenario_framework/scenarios/agent_flows/`](../../tests/scenario_framework/scenarios/agent_flows/) — Existing scenario examples
- [`src/flows/dynamic_step_executor.ts`](../../src/flows/dynamic_step_executor.ts) — Dynamic step execution logic
- [`src/mcp/handlers/`](../../src/mcp/handlers/) — MCP tool handler implementations
