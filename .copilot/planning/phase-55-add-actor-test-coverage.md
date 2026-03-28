# Prompt: Add Test Coverage for Actor/Agent/Identity Journal Fields

> **Important instruction to the coding agent:** After implementing, uncomment the `_bad` block above. If `deno check` passes without error on that block, it means `IRequestFrontmatter.agent?` is still present and Phase 54 Step 4 is incomplete. The test file itself is the detection mechanism — it should **fail to compile** when the legacy field exists.

***

## Execution Instructions for the Coding Agent

1. **Read these files before writing any test:**
   - `src/services/common/types.ts` — `ILogEvent`, `IServiceContext`
   - `src/repositories/activity_repository.ts` — `IActivity`, `LogActivityRequest`
   - `src/services/db.ts` — `LogEntry`, `ActivityRecordSchema`, INSERT statement
   - `src/services/event_logger.ts` — how it maps `ILogEvent` → `LogActivityRequest`
   - `src/services/agent_executor.ts` — `logExecutionStart`, `logExecutionComplete`, `logExecutionError`
   - `migrations/001_init.sql` — actual DB column names (`actor_type`, `identity_id`, `identity_kind`)
   - `src/shared/enums.ts` — `ActorType`, `AgentKind`, all renamed enum members

1.
   - Look at `tests/services/` and `tests/repositories/` for existing test style
   - Use the same spy/stub helper utilities already in use (do not introduce new test dependencies)
   - Use the same `beforeEach`/`afterEach` DB setup pattern already established for integration tests

1.

1.

   ```bash
   deno task fmt
   deno task lint
   deno check src/
   deno task test
   ```

   All four commands must exit 0 before the task is complete.

1.

### Context

The Exaix codebase has completed Phases 53 and 54, which introduced a strict three-way separation of concepts:

- **Actor** — who initiated the request (e.g. `"user:alice"`, `"service:memory-bank"`). Typed via `ActorType` enum.
- **Agent** — the runtime execution unit (e.g. `"agent-executor"`, `"flow-runner"`). Typed via `AgentKind` enum. Stored in field `agentId` (string) + `identityKind` (AgentKind).
- **Identity** — the LLM blueprint/persona loaded by the runtime (e.g. `"senior-coder"`). Stored in `identityId`.

These fields were added to:

- `ILogEvent` and `IServiceContext` in `src/services/common/types.ts`
- `IActivity` and `LogActivityRequest` in `src/repositories/activity_repository.ts`
- `ActivityRecordSchema` and `LogEntry` in `src/services/db.ts`
- `EventLogger` in `src/services/event_logger.ts`
- The `activity` table in `migrations/001_init.sql` (columns: `actor_type`, `identity_id`, `identity_kind`)

**The new fields are wired through the stack but have no dedicated test coverage yet.** Your task is to write tests that verify the full path from `EventLogger.log()` call → `ActivityRepository.logActivity()` → SQLite row → `IActivity` read-back, confirming all three fields are correctly persisted and retrieved.

***

### Reference: Key Interfaces

```typescript
// src/services/common/types.ts
interface ILogEvent {
  action: string;
  target: string;
  payload?: Record<string, JSONValue>;
  actor?: Actor;            // e.g. "user:alice"
  actorType?: ActorType | null;  // ActorType.USER | SERVICE | MCP_CLIENT | IDENTITY
  traceId?: string;
  agentId?: string;         // runtime agent name, e.g. "agent-executor"
  identityKind?: AgentKind | null;  // AgentKind.AGENT_EXECUTOR | FLOW_AGENT | etc.
  identityId?: string;      // LLM blueprint slug, e.g. "senior-coder"
  level?: LogLevel;
  icon?: string;
}

// src/repositories/activity_repository.ts
interface LogActivityRequest {
  actor: string;
  actionType: string;
  target: string | null;
  payload?: Record<string, JSONValue>;
  traceId?: string;
  agentId?: string | null;
  actorType?: string | null;
  identityKind?: string | null;
  identityId?: string | null;
}

interface IActivity {
  id: string;
  traceId: string;
  actor: string | null;
  actorType: string | null;
  agentId: string | null;
  identityKind?: string | null;
  identityId: string | null;
  actionType: string;
  target: string | null;
  payload: Record<string, JSONValue>;
  timestamp: string;
}
```

***

### Files to Create / Modify

| Action | File |
| --- | --- |
| **Create** | `tests/services/event_logger_identity_fields_test.ts` |
| **Create** | `tests/repositories/activity_repository_identity_fields_test.ts` |
| **Create** | `tests/services/agent_executor_journal_test.ts` |
| **Extend** | `tests/services/db_test.ts` (or nearest existing DB test) |

***

### Test 1 — `EventLogger` correctly forwards all three fields to `ActivityRepository`

**File:** `tests/services/event_logger_identity_fields_test.ts`

Write a unit test using a **spy/stub** on `ActivityRepository.logActivity`. Do NOT use a real SQLite database.

```typescript
// Pseudocode — implement using the project's existing test helpers and spy utilities

describe("EventLogger — actor/agent/identity field forwarding", () => {

  it("passes actorType, agentId, identityKind, identityId through to logActivity", async () => {
    // Arrange
    const capturedRequests: LogActivityRequest[] = [];
    const mockRepo: ActivityRepository = {
      logActivity: async (req) => { capturedRequests.push(req); },
      // ... stub remaining methods
    };
    const logger = new EventLogger(mockRepo /* inject mock */);

    // Act
    await logger.log({
      action: "test.event",
      target: "some-portal",
      actor: "user:test@example.com",
      actorType: ActorType.USER,
      agentId: "agent-executor",
      identityKind: AgentKind.AGENT_EXECUTOR,
      identityId: "senior-coder",
      traceId: "trace-abc-123",
    });

    // Assert
    assertEquals(capturedRequests.length, 1);
    const req = capturedRequests[0];
    assertEquals(req.actor, "user:test@example.com");
    assertEquals(req.actorType, ActorType.USER);       // "user"
    assertEquals(req.agentId, "agent-executor");
    assertEquals(req.identityKind, AgentKind.AGENT_EXECUTOR);  // "agent-executor"
    assertEquals(req.identityId, "senior-coder");
    assertEquals(req.traceId, "trace-abc-123");
  });

  it("passes null actorType and identityKind when not provided", async () => {
    // Arrange + Act: call logger.log() without actorType/identityKind/identityId
    // Assert: req.actorType === null, req.identityKind === null, req.identityId === null
  });

  it("does NOT put a blueprint slug (identity) into agentId", async () => {
    // This is the key regression guard for the separation concept.
    // If a caller accidentally passes identityId value into agentId field,
    // this test should catch it by checking the captured request.
    // Arrange: log an event where identityId = "senior-coder" and agentId = "agent-executor"
    // Assert: req.agentId !== "senior-coder"
    // Assert: req.identityId === "senior-coder"
  });
});
```

***

### Test 2 — `ActivityRepository` persists and reads back all new fields end-to-end

**File:** `tests/repositories/activity_repository_identity_fields_test.ts`

Use a real **in-memory SQLite database** (`:memory:`) initialized with the schema from `migrations/001_init.sql`. This is an integration test.

```typescript
describe("ActivityRepository — actor/agent/identity field persistence", () => {

  let db: DatabaseService;
  let repo: ActivityRepository; // or concrete implementation

  beforeEach(async () => {
    // Initialize in-memory SQLite with 001_init.sql schema
    // Use the project's existing db setup helper if available
  });

  afterEach(async () => {
    await db.close();
  });

  it("writes and reads back all three separation fields", async () => {
    // Arrange
    const traceId = crypto.randomUUID();
    const request: LogActivityRequest = {
      actor: "user:test@example.com",
      actorType: "user",
      actionType: "test.action",
      target: "some-portal",
      payload: { key: "value" },
      traceId,
      agentId: "agent-executor",
      identityKind: "agent-executor",
      identityId: "senior-coder",
    };

    // Act
    await repo.logActivity(request);
    const rows = await repo.getActivitiesByTraceId(traceId);

    // Assert
    assertEquals(rows.length, 1);
    const row = rows[0];
    assertEquals(row.actor, "user:test@example.com");
    assertEquals(row.actorType, "user");
    assertEquals(row.agentId, "agent-executor");
    assertEquals(row.identityKind, "agent-executor");
    assertEquals(row.identityId, "senior-coder");
    assertEquals(row.actionType, "test.action");
  });

  it("stores null when actor separation fields are omitted", async () => {
    // Arrange: LogActivityRequest with only required fields (no actorType/agentId/identityId)
    // Act: logActivity + read back
    // Assert: actorType === null, agentId === null, identityKind === null, identityId === null
  });

  it("agentId stores a runtime agent name, not a blueprint slug", async () => {
    // Regression: verify the contract that agentId != identityId
    // Arrange: write a row with agentId="flow-runner" and identityId="code-reviewer"
    // Assert: row.agentId === "flow-runner"
    // Assert: row.identityId === "code-reviewer"
    // Assert: row.agentId !== row.identityId
  });

  it("indexes on identity_id are queryable", async () => {
    // Arrange: write two rows — one with identityId="senior-coder", one with identityId="code-reviewer"
    // Act: query rows filtered by identityId = "senior-coder"
    // Assert: only one row returned
    // (This verifies the idx_activity_identity index works and the column is populated)
  });

  it("indexes on actor_type are queryable", async () => {
    // Arrange: write two rows — one with actorType="user", one with actorType="service"
    // Act: query by actorType = "user"
    // Assert: only the user row is returned
  });
});
```

***

### Test 3 — `AgentExecutor` journal calls use the correct field for each concept

**File:** `tests/services/agent_executor_journal_test.ts`

Use a **spy on `EventLogger.log`** to verify that the three log methods (`logExecutionStart`, `logExecutionComplete`, `logExecutionError`) in `AgentExecutor` put values into the correct fields.

```typescript
describe("AgentExecutor — journal field separation", () => {

  it("logExecutionStart writes agentId='agent-executor' and identityId=blueprintSlug", async () => {
    // Arrange
    const loggedEvents: ILogEvent[] = [];
    const mockLogger = { log: async (e: ILogEvent) => loggedEvents.push(e), /* other methods */ };
    const executor = new AgentExecutor(/* inject mockLogger */);

    // Act
    await executor.logExecutionStart("trace-123", "senior-coder", "my-portal");

    // Assert
    assertEquals(loggedEvents.length, 1);
    const event = loggedEvents[0];
    assertEquals(event.agentId, "agent-executor");       // constant — the runtime agent
    assertEquals(event.identityId, "senior-coder");      // the blueprint slug
    assertEquals(event.actor, "system");
    assertEquals(event.actorType, ActorType.SERVICE);
    assertNotEquals(event.agentId, event.identityId);    // KEY: they must differ
  });

  it("logExecutionComplete writes agentId='agent-executor' and identityId=blueprintSlug", async () => {
    // Same pattern as above for logExecutionComplete
    // Assert event.agentId === "agent-executor" and event.identityId === "senior-coder"
  });

  it("logExecutionError writes agentId='agent-executor' and identityId=blueprintSlug", async () => {
    // Same pattern for logExecutionError
    // Assert event.agentId === "agent-executor" and event.identityId === "senior-coder"
    // Also assert: event.target === identityId (the identity that failed, not the agent name)
  });

  it("REGRESSION: agentId must never be set to an identity blueprint slug", async () => {
    // This is the most important regression guard.
    // Arrange: log with identityId = "senior-coder"
    // Assert: event.agentId !== "senior-coder"
    // Assert: event.agentId === "agent-executor"
  });
});
```

***

### Test 4 — DB schema has the correct columns (schema contract test)

**File:** Extend nearest existing DB test (e.g. `tests/services/db_test.ts`)

```typescript
it("activity table has actor_type, identity_id, identity_kind columns", async () => {
  // Arrange: open in-memory DB with 001_init.sql
  // Act: query PRAGMA table_info(activity)
  const columns = await db.query<{ name: string }>("PRAGMA table_info(activity)");
  const columnNames = columns.map(c => c.name);

  // Assert required columns exist
  assertIncludes(columnNames, "actor");
  assertIncludes(columnNames, "actor_type");
  assertIncludes(columnNames, "identity_id");
  assertIncludes(columnNames, "identity_kind");
  assertIncludes(columnNames, "action_type");
  assertIncludes(columnNames, "trace_id");

  // Assert legacy column is NOT present (Phase 54 cleanup)
  assertNotIncludes(columnNames, "agent_id");  // if fully removed from DB
  // NOTE: if agent_id still exists in the schema, remove the assertion above
  // and instead assert that identity_id exists as a SEPARATE column from agent_id
});

it("activity table has indexes for identity_id and actor_type", async () => {
  // Act: query sqlite_master for indexes
  const indexes = await db.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='activity'"
  );
  const indexNames = indexes.map(i => i.name);

  assertIncludes(indexNames, "idx_activity_identity");
  assertIncludes(indexNames, "idx_activity_actor_type");
  assertIncludes(indexNames, "idx_activity_identity_kind");
});
```

***

### Test 5 — `ILogEvent` type contract via compile-time verification

Add a type-only test file that will fail TypeScript compilation if the interface regresses:

**File:** `tests/types/log_event_fields_type_test.ts`

```typescript
// This file contains no runtime tests.
// It exists solely to verify the TypeScript contract at compile time.
// If any field is renamed or removed, `deno check` will fail.

import type { ILogEvent, IServiceContext } from "../../src/services/common/types.ts";
import type { ActorType, AgentKind } from "../../src/shared/enums.ts";

// Verify ILogEvent has all three separation fields
const _logEvent: ILogEvent = {
  action: "test",
  target: "portal",
  actor: "user:test",
  actorType: "user" as ActorType,
  agentId: "agent-executor",            // runtime agent — NOT a blueprint slug
  identityKind: "agent-executor" as AgentKind,  // category of runtime agent
  identityId: "senior-coder",           // LLM identity blueprint slug
};

// Verify IServiceContext has the same three separation fields
const _ctx: IServiceContext = {
  actor: "user:test",
  actorType: "user" as ActorType,
  agentId: "agent-executor",
  identityKind: "agent-executor" as AgentKind,
  identityId: "senior-coder",
};

***

```typescript
// The following MUST be a TypeScript error if uncommented:
// const _bad: ILogEvent = {
//   action: "test",
//   target: "portal",
//   agentId: "senior-coder",   // ← ERROR: this is a blueprint slug, NOT a runtime agent name
//                               //   agentId must hold runtime agent names only
// };
//
// The following MUST also be a TypeScript error if uncommented:
// const _misnamed: ILogEvent = {
//   action: "test",
//   target: "portal",
//   agentKind: AgentKind.AGENT_EXECUTOR,  // ← ERROR: field is named identityKind, not agentKind
// };
```

***

### Test 6 — `FlowRunner` journal events use `identityId`, not `agentId`, for blueprint slugs

**File:** `tests/flows/flow_runner_identity_journal_test.ts`

```typescript
describe("FlowRunner — identity separation in journal events", () => {

  it("flow.step.started event carries identityId not agentId for blueprint slug", async () => {
    // Arrange
    const loggedEvents: ILogEvent[] = [];
    const mockLogger = {
      log: async (e: ILogEvent) => loggedEvents.push(e),
      info: async (action: string, target: string, payload?: Record<string, unknown>, ctx?: Partial<ILogEvent>) => {
        loggedEvents.push({ action, target, payload, ...ctx } as ILogEvent);
      },
      // stub remaining methods
    };

    // Build minimal flow with one step
    const flow: IFlow = {
      id: "test-flow",
      name: "Test Flow",
      description: "Unit test",
      version: "1.0.0",
      steps: [{
        id: "step-1",
        name: "Step One",
        type: FlowStepType.AGENT,
        identity: "senior-coder",   // <-- canonical field, not 'agent'
        dependsOn: [],
        input: { source: FlowInputSource.REQUEST, transform: "passthrough" },
        retry: { maxAttempts: 1, backoffMs: 0 },
      }],
      output: { from: "step-1", format: FlowOutputFormat.MARKDOWN },
      settings: { maxParallelism: 1, failFast: true },
    };

    const runner = new FlowRunner(flow, /* inject mockLogger, mockExecutor */);
    // (stub AgentExecutor to return a mock IChangesetResult without real execution)

    // Act
    await runner.execute(/* minimal IExecutionContext */);

    // Assert: find the flow.step.started event
    const startedEvent = loggedEvents.find(e => e.action === "flow.step.started");
    assertExists(startedEvent);

    // KEY ASSERTIONS — blueprint slug goes to identityId, not agentId
    assertEquals(startedEvent?.identityId, "senior-coder");
    assertNotEquals(startedEvent?.agentId, "senior-coder");

    // agentId must be the runtime runner name
    assertEquals(startedEvent?.agentId, "flow-runner");
  });

  it("flow.step.completed event carries identityId for blueprint slug", async () => {
    // Same setup as above, find "flow.step.completed" event
    // Assert completedEvent?.identityId === "senior-coder"
    // Assert completedEvent?.agentId === "flow-runner"
  });

  it("flow.step.failed event carries identityId for blueprint slug", async () => {
    // Arrange: stub AgentExecutor to throw
    // Assert failedEvent?.identityId === "senior-coder"
    // Assert failedEvent?.agentId === "flow-runner"
  });
});
```

***

### Test 7 — `MemoryExtractorService` passes `identityId` (not `agent`) to proposals

**File:** `tests/services/memory_extractor_identity_test.ts`

```typescript
describe("MemoryExtractorService — identity_id in proposals", () => {

  it("createProposal sets identity_id on the proposal, not agent", async () => {
    // Arrange
    const writtenProposals: IMemoryUpdateProposal[] = [];
    const mockMemoryBank = {
      writeProposal: async (p: IMemoryUpdateProposal) => writtenProposals.push(p),
    };
    const service = new MemoryExtractorService(/* inject mockMemoryBank */);

    const execution: IExecutionMemory = {
      trace_id: crypto.randomUUID(),
      request_id: "req-1",
      started_at: new Date().toISOString(),
      status: ExecutionStatus.COMPLETED,
      portal: "my-portal",
      identity_id: "senior-coder",   // source of truth
      summary: "Did some work",
      context_files: [],
      context_portals: [],
      changes: { files_created: [], files_modified: [], files_deleted: [] },
    };

    const learning: IProposalLearning = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      source: MemoryBankSource.IDENTITY,
      scope: MemoryScope.PROJECT,
      project: "my-portal",
      title: "Test learning",
      description: "A test learning",
      category: LearningCategory.PATTERN,
      tags: [],
      confidence: ConfidenceLevel.HIGH,
    };

    // Act
    await service.createProposal(learning, execution, "senior-coder");

    // Assert
    assertEquals(writtenProposals.length, 1);
    const proposal = writtenProposals[0];
    assertEquals(proposal.identity_id, "senior-coder");
    // Ensure the old field name is gone
    assertFalse("agent" in proposal);
  });

  it("proposal metadata uses identity_id key, not agent", async () => {
    // Arrange + Act: same as above
    // Inspect logActivity spy to confirm metadata.identity_id is set, not metadata.agent
    const loggedActivities: LogActivityRequest[] = [];
    // ... inject spy into service
    // Assert: loggedActivities[0].payload?.identity_id === "senior-coder"
    // Assert: !("agent" in (loggedActivities[0].payload ?? {}))
  });
});
```

***

### Test 8 — Enum value contracts (prevent regression on renamed members)

**File:** `tests/shared/enums_identity_separation_test.ts`

```typescript
describe("Enum values — actor/agent/identity separation", () => {

  it("ActorType enum has correct string values", () => {
    assertEquals(ActorType.USER, "user");
    assertEquals(ActorType.SERVICE, "service");
    assertEquals(ActorType.MCP_CLIENT, "mcp-client");
    assertEquals(ActorType.IDENTITY, "identity");
  });

  it("AgentKind enum has correct string values", () => {
    assertEquals(AgentKind.AGENT_EXECUTOR, "agent-executor");
    assertEquals(AgentKind.FLOW_AGENT, "flow-agent");
    assertEquals(AgentKind.TOOL_AGENT, "tool-agent");
    assertEquals(AgentKind.REQUEST_ROUTER, "request-router");
    assertEquals(AgentKind.IDENTITY_RUNNER, "identity-runner");
  });

  it("ActivityActor uses IDENTITY not AGENT", () => {
    assertEquals(ActivityActor.IDENTITY, "identity");
    // Ensure the old AGENT member is gone at runtime
    assertFalse("AGENT" in ActivityActor);
  });

  it("RequestKind uses IDENTITY not AGENT", () => {
    assertEquals(RequestKind.IDENTITY, "identity");
    assertFalse("AGENT" in RequestKind);
  });

  it("MemoryBankSource.IDENTITY exists with correct value", () => {
    assertEquals(MemoryBankSource.IDENTITY, "identity");
  });

  it("TuiNodeType.IDENTITY exists with correct value", () => {
    assertEquals(TuiNodeType.IDENTITY, "identity");
    assertFalse("AGENT" in TuiNodeType);
  });

  it("GroupingMode.IDENTITY exists with correct value", () => {
    assertEquals(GroupingMode.IDENTITY, "identity");
    assertFalse("AGENT" in GroupingMode);
  });

  it("LogGroupingMode.IDENTITY exists (not AGENT)", () => {
    assertEquals(LogGroupingMode.IDENTITY, "identity");
    assertFalse("AGENT" in LogGroupingMode);
  });

  it("RequestDialogType.FILTER_IDENTITY exists (not FILTER_AGENT)", () => {
    assertEquals(RequestDialogType.FILTER_IDENTITY, "filter-identity");
    assertFalse("FILTER_AGENT" in RequestDialogType);
  });
});
```

***

### Test 9 — `IRequestFrontmatter` does NOT have `agent?` field (Phase 54 contract)

**File:** `tests/types/request_frontmatter_type_test.ts`

```typescript
// Compile-time contract test. Runs deno check only.

import type { IRequestFrontmatter } from "../../src/services/request_processing/types.ts";

// The canonical field must exist
const _fm: IRequestFrontmatter = {
  trace_id: crypto.randomUUID(),
  created: new Date().toISOString(),
  status: "pending" as RequestStatusType,
  priority: "normal",
  source: "cli",
  identity: "senior-coder",  // ← canonical, must compile
};

// The following MUST be a TypeScript error if Phase 54 is complete:
// const _bad: IRequestFrontmatter = {
//   trace_id: crypto.randomUUID(),
//   created: new Date().toISOString(),
//   status: "pending" as RequestStatusType,
//   priority: "normal",
//   source: "cli",
//   agent: "senior-coder",  // ← ERROR: removed in Phase 54
// };
```
