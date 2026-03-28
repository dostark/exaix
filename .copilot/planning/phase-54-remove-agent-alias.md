---
agent: claude
scope: dev
title: "Phase 54: Remove Deprecated 'agent' Aliases Introduced in Phase 53"
short*summary: "Hard-remove all Phase 53 backward-compatibility shims: the --agent CLI flag alias, the Blueprints/Agents/ fallback path, the deprecated agent: frontmatter key, the agent? field in IRequestFrontmatter and Zod schemas, the BLUEPRINT*AGENTS_DIR constant, and the agent field from flow schemas (FlowStepSchema, GateEvaluateSchema)."
version: "2.0"
topics: ["naming", "cleanup", "deprecation-removal", "cli", "blueprints", "identities", "flows", "breaking-change"]
---

## Status: ✅ COMPLETE (Steps 1-16 complete)

## Prerequisites

**Phase 53 must be fully implemented and released** before this phase begins.
This phase removes the backward-compatibility shims that Phase 53 introduced.
Do not implement Phase 54 in the same release as Phase 53.

---

## Executive Summary

Phase 53 introduced the `Identity` rename for the agent blueprint layer while deliberately
preserving full backward compatibility: the `--agent` CLI flag, `Blueprints/Agents/` path
fallback, `agent:` request frontmatter key, and the deprecated `agent?` field in
`IRequestFrontmatter` and Zod schemas were all kept as aliases with deprecation warnings.
Phase 53 also introduced `identity` as the replacement for `agent` in `FlowStepSchema` and
`GateEvaluateSchema`, keeping `agent` as a deprecated optional field to allow a migration window.

This phase removes every one of those shims. After Phase 54:

- `--agent` is an unknown CLI flag and will produce a parse error
- `Blueprints/Agents/` is no longer scanned by `BlueprintLoader`
- `agent:` in request frontmatter is an unrecognised key and triggers a Zod validation error
- `IRequestFrontmatter.agent` field is gone from the TypeScript interface
- `BLUEPRINT*AGENTS*DIR` constant is removed
- `blueprint.legacy_path.used` journal event is no longer emitted
- `agent` field is removed from `FlowStepSchema` and `GateEvaluateSchema`
- `agent` parameter is removed from `define_flow.ts` step config type
- Runtime fallback logic (`identity ?? agent`) is removed from flow execution
- Flow YAML files must use `identity:` instead of `agent:` in step definitions

The goal is a clean, unambiguous codebase where every surface that was renamed in Phase 53
is enforced without fallback.

---

## Problem Statement

Deprecation aliases have a cost:

- **Dead code paths** increase cognitive overhead for contributors and LLM agents reading
  the codebase
- **Dual-path logic** in `BlueprintLoader` and `RequestParser` makes tests harder to reason
  about and coverage metrics misleading
- **Deprecated fields** in Zod schemas and TypeScript interfaces generate noise in type
  checks and IDE tooling
- **Deprecation warnings** in stderr accumulate in CI logs, reducing signal-to-noise ratio
- Keeping aliases indefinitely defeats the purpose of Phase 53's rename

Phase 54 enforces the Phase 53 rename as the only supported interface.

---

## Phase Goals

### Primary Goals

- [x] Remove `--agent` flag from `src/cli/request_commands.ts`
- [x] Remove `agent` alias subcommand from `src/cli/blueprint_commands.ts`
- [x] Remove `Blueprints/Agents/` legacy fallback path from `src/services/blueprint_loader.ts`
- [ ] Remove `BLUEPRINT*AGENTS*DIR` constant
- [x] Remove `agent?` field from `IRequestFrontmatter` interface in
  `src/services/request_processing/types.ts`
- [x] Remove `agent` key from Zod schema in `src/schemas/request.ts`
- [x] Remove `agent:` frontmatter parsing fallback from `src/services/request*processing/request*parser.ts`
- [x] Remove `blueprint.legacy_path.used` journal event emission from `BlueprintLoader`
- [x] Remove `agent` field from `FlowStepSchema` in `src/shared/schemas/flow.ts`
- [x] Remove `agent` field from `GateEvaluateSchema` in `src/shared/schemas/flow.ts`
- [x] Remove `agent` parameter from `define_flow.ts` step config type
- [x] Remove runtime fallback logic `identity ?? agent` in `flow*runner.ts` / `flow*loader.ts`
- [x] Migrate all `Blueprints/Flows/*.yaml` step definitions from `agent:` to `identity:`
- [x] Update all tests that still use `--agent`, `agent:`, or `Blueprints/Agents/` to use
  the canonical `--identity`, `identity:`, and `Blueprints/Identities/` equivalents
- [x] Confirm no remaining references to deprecated surfaces in source or tests

### Secondary Goals

- [ ] Update `CONTRIBUTING.md` migration note from Phase 53 to state removal is complete
- [ ] Update `CHANGELOG` / release notes to mark `--agent` as removed (breaking change)
- [x] Update MCP tool API: rename `agent` parameter of `exaix*create*request` to `identity`
  with a versioned MCP schema bump (see MCP section below)

**✅ IMPLEMENTED** — `src/mcp/domain_tools.ts`, `src/shared/schemas/mcp.ts`

### Non-Goals

- Renaming `agent_id` frontmatter field inside blueprint files — this stays unchanged forever
- Renaming `AgentRunner`, `agent_runner.ts`, or any runtime-layer identifiers
- Renaming journal event names (`agent.execution.started`, etc.)
- Renaming database columns
- Renaming `FlowStepType.AGENT` enum value (internal enum, not user-facing)

---

## Architecture

### Surfaces Being Removed

| Surface | Location | Introduced in | Removal Action |
| --- | --- | --- | --- |
| `--agent <id>` CLI flag | `src/cli/request_commands.ts` | Phase 53 | Delete option declaration and handler branch |
| `blueprint agent` subcommand alias | `src/cli/blueprint_commands.ts` | Phase 53 | Delete alias registration |
| `Blueprints/Agents/` fallback lookup | `src/services/blueprint_loader.ts` | Phase 53 | Delete fallback branch |
| `BLUEPRINT*AGENTS*DIR` constant | `src/services/blueprint_loader.ts` | Phase 53 | Delete constant |
| `blueprint.legacy*path.used` event | `src/services/blueprint*loader.ts` | Phase 53 | Delete event emission |
| `agent?` field | `src/services/request_processing/types.ts` | Phase 53 | Delete field |
| `agent:` Zod schema key | `src/schemas/request.ts` | Phase 53 | Delete schema key |
| `agent:` frontmatter parse fallback | `src/services/request*processing/request*parser.ts` | Phase 53 | Delete fallback branch |
| `agent` field | `src/shared/schemas/flow.ts` (FlowStepSchema) | Phase 53 | Delete field from schema |
| `agent` field | `src/shared/schemas/flow.ts` (GateEvaluateSchema) | Phase 53 | Rename to `identity` |
| `agent` parameter | `src/flows/define_flow.ts` step config type | Phase 53 | Delete parameter |
| `identity ?? agent` fallback | `src/flows/flow*runner.ts`, `flow*loader.ts` | Phase 53 | Delete fallback logic |
| `agent:` in flow YAML steps | `Blueprints/Flows/*.yaml` | Phase 53 | Migrate to `identity:` |

### MCP Schema Change (Breaking)

| Before | After | Notes |
| --- | --- | --- |
| `exaix*create*request` param: `agent` | `exaix*create*request` param: `identity` | MCP schema version bump required |

The MCP tool input schema in `src/mcp/tools.ts` / `src/mcp/domain_tools.ts` must be updated.
Because this is a breaking change to the public MCP API, the MCP schema version must be
incremented and the change documented in `docs/dev/Exaix*Technical*Spec.md`.

---

## Implementation Plan

### Step 1 — Remove `--agent` CLI flag

**`src/cli/request_commands.ts`:**

- Delete the `.option("--agent <id>", ...)` declaration entirely
- Delete the `opts.agent` reference and the deprecation warning branch
- The handler reads only `opts.identity`

**Success criteria:**

- [x] `exactl request "..." --agent senior-coder` prints an unknown-option error and exits non-zero
- [x] `exactl request "..." --identity senior-coder` continues to work
- [x] CLI help output no longer mentions `--agent`

**✅ IMPLEMENTED** — `src/cli/exactl.ts`, `src/cli/command*builders/request*actions.ts`

---

### Step 2 — Remove `blueprint agent` alias subcommand

**`src/cli/blueprint_commands.ts`:**

- Delete the `agent` alias registration for all subcommands (`list`, `create`, `validate`,
  `show`, `delete`)
- Only `identity` subcommand remains

**Success criteria:**

- [x] `exactl blueprint agent list` prints an unknown-command error and exits non-zero
- [x] `exactl blueprint identity list` continues to work
- [x] CLI help output no longer lists `agent` as a subcommand or alias

**✅ IMPLEMENTED** — `src/cli/exactl.ts`

---

### Step 3 — Remove legacy path fallback from `BlueprintLoader`

**`src/services/blueprint_loader.ts`:**

- Delete the secondary lookup branch for `{workspace}/Blueprints/Agents/{id}.md`
- Delete the `blueprint.legacy_path.used` journal event emission
- Delete the `BLUEPRINT*AGENTS*DIR` constant
- `BlueprintLoader` now resolves only from `Blueprints/Identities/`
- If an identity is not found, throw `IdentityNotFoundError` immediately (no fallback)

**Success criteria:**

- [x] Loading an identity from `Blueprints/Agents/` path no longer works
- [x] `BLUEPRINT*AGENTS*DIR` does not appear in source (`grep -r BLUEPRINT*AGENTS*DIR src/`)
- [x] `blueprint.legacy_path.used` does not appear in source
- [x] Unit test: loading a missing identity throws `IdentityNotFoundError` with a clear message
  referencing `Blueprints/Identities/`

**✅ IMPLEMENTED** — `src/services/blueprint_loader.ts`, 17/17 tests passing

---

### Step 4 — Remove deprecated `agent` field from types and Zod schema

**`src/services/request_processing/types.ts`:**

```typescript
// Before (Phase 53):
export interface IRequestFrontmatter {
  identity?: string;
  /** @deprecated Use identity */
  agent?: string;
}

// After (Phase 54):
export interface IRequestFrontmatter {
  identity?: string;
  // agent field removed
}
```

**`src/schemas/request.ts`:**

```typescript
// Before (Phase 53):
identity: z.string().optional(),
agent:    z.string().optional(), // deprecated

// After (Phase 54):
identity: z.string().optional(),
// agent key removed — Zod strict mode will reject unknown keys if configured
```

**`src/services/request*processing/request*parser.ts`:**

- Delete the `agent:` frontmatter fallback parsing branch
- Delete the deprecation log line for `agent:`
- `RequestParser` reads only `identity:` from frontmatter

**Success criteria:**

- [x] A request file with `agent: senior-coder` frontmatter produces a Zod validation warning
  or is silently ignored (the `identity` field will be `undefined` and the default identity
  will be used — consistent with any other unrecognised frontmatter key)
- [x] `IRequestFrontmatter` no longer has an `agent` property (TypeScript compilation confirms)
- [x] Zod schema no longer accepts `agent` as a known key
- [x] All schema unit tests pass

**✅ IMPLEMENTED** — `src/services/request_processing/types.ts`, 7/7 tests passing

---

### Step 5 — Update MCP tool API

**`src/mcp/tools.ts` and/or `src/mcp/domain_tools.ts`:**

- Rename the `agent` input parameter of the `exaix*create*request` tool to `identity`
- Update the tool's input schema description accordingly
- Bump the MCP schema version constant

**`src/mcp/server.ts` (or equivalent version field):**

- Increment the advertised MCP schema version to signal a breaking change to MCP clients

**`docs/dev/Exaix*Technical*Spec.md`:**

- Document the breaking MCP parameter rename under a dedicated migration note

**Success criteria:**

- [ ] `exaix*create*request` MCP tool accepts `identity` parameter and routes correctly
- [ ] `exaix*create*request` MCP tool rejects `agent` parameter (unknown field in schema)
- [ ] MCP schema version is incremented
- [ ] MCP integration tests updated and passing

---

### Step 6 — Remove `agent` field from FlowStepSchema

**`src/shared/schemas/flow.ts`:**

```typescript
// BEFORE (Phase 53)
export const FlowStepSchema = z.object({
  id: z.string().min(1, "Step ID cannot be empty"),
  name: z.string().min(1, "Step name cannot be empty"),
  type: z.nativeEnum(FlowStepType).optional().default(FlowStepType.AGENT),
  agent: z.string().min(1, "Agent reference cannot be empty"),
  // ...
});

// AFTER (Phase 54)
export const FlowStepSchema = z.object({
  id: z.string().min(1, "Step ID cannot be empty"),
  name: z.string().min(1, "Step name cannot be empty"),
  type: z.nativeEnum(FlowStepType).optional().default(FlowStepType.AGENT),
  identity: z.string().min(1, "Identity reference cannot be empty"),
  // ...
});
```

**Success criteria:**

- [x] `FlowStepSchema` has no `agent` field
- [x] TypeScript types `IFlowStep`, `IFlowStepInput` infer correctly
- [x] Zod validation rejects flow YAML with `agent:` step key

**✅ IMPLEMENTED** — `src/shared/schemas/flow.ts`, 14/14 tests passing

---

### Step 7 — Update GateEvaluateSchema

**`src/shared/schemas/flow.ts`:**

```typescript
// BEFORE (Phase 53)
export const GateEvaluateSchema = z.object({
  /** Judge agent ID */
  agent: z.string(),
  criteria: z.array(z.string()),
  // ...
});

// AFTER (Phase 54)
export const GateEvaluateSchema = z.object({
  /** Judge identity ID */
  identity: z.string(),
  criteria: z.array(z.string()),
  // ...
});
```

**Success criteria:**

- [x] `GateEvaluateSchema` uses `identity` for judge reference
- [x] TypeScript type `IGateEvaluate` infers correctly
- [x] Zod validation rejects gate evaluate block with `agent:` key

**✅ IMPLEMENTED** — `src/shared/schemas/flow.ts` (combined with Step 6)

---

### Step 8 — Update `define_flow.ts` Parameter Type

**`src/flows/define_flow.ts`:**

```typescript
// BEFORE
steps: Array<{
  id: string;
  name: string;
  /** @deprecated Use `identity` */
  agent?: string;
  identity: string;
  dependsOn?: string[];
  // ...
}>;

// AFTER
steps: Array<{
  id: string;
  name: string;
  identity: string;
  dependsOn?: string[];
  // ...
}>;
```

**Success criteria:**

- [x] No `agent` parameter in step config type
- [x] TypeScript compilation succeeds
- [x] All `defineFlow()` call sites pass `identity:` (not `agent:`)

**✅ IMPLEMENTED** — `src/flows/define_flow.ts`, `tests/flows/define_flow_unit_test.ts`, 6/6 tests passing

---

### Step 9 — Remove Runtime Fallback Logic

**Files:** `src/flows/flow_runner.ts`, `src/flows/flow_loader.ts`, `tests/flows/flow_runner_test.ts`

Per GLOSSARY.md, ensure proper separation of concerns:

- **Actor**: Who initiates the request (user, MCP client, service)
- **Agent**: Runtime execution unit that orchestrates identities
- **Identity**: LLM persona/blueprint that performs the actual work

**Patterns removed:**

- No `step.identity ?? step.agent` fallback patterns found (already clean)
- No `step.agent` access in flow execution code

**Logging updated to use proper Actor/Agent/Identity terminology:**

- `flow.step.queued`: `agent` → `identity`
- `flow.step.started`: `agent`/`agentId` → `identity`/`identityId`
- `flow.step.completed`: `agent` → `identity`
- `flow.step.failed`: `agent` → `identity`

**Test file migration:**

- All `agent:` step definitions in `flow_runner_test.ts` → `identity:` (63 occurrences)

**Success criteria:**

- [x] No `step.agent` access in flow execution code
- [x] Error messages reference "identity" not "agent"
- [x] No silent fallback behavior remains
- [x] Journal events use `identity` for identity references
- [x] All flow_runner tests pass: 39/39

**✅ IMPLEMENTED** — `src/flows/flow_runner.ts`, `tests/flows/flow_runner_test.ts`, 39/39 tests passing

---

## 2. Phase 54 — Steps 10–16 (replace everything from `### Step 10` to end of file)

```markdown

## Status: ✅ COMPLETE (Steps 1-16 complete)

> Steps 1–9 removed all public-surface "agent" aliases.
> Steps 10–16 fix the remaining internal mis-use of "agent" where the code
> should carry separate actor / agent / identity fields, as defined in
> GLOSSARY.md.  Read GLOSSARY.md § "Journal and Persistence" and
> § "Code Identifiers" before touching any file in these steps.

---

### Step 10 — Migrate `Blueprints/Flows/` YAML files

**What to do:**
Open every `.yaml` file in `Blueprints/Flows/`.
Find every occurrence of `agent:` inside a `steps:` block or an `evaluate:`
block.  Replace `agent:` with `identity:`.  Do not change anything else.

**Before:**
```yaml
steps:
  - id: analyze
    name: Analyze Code
    agent: code-reviewer
evaluate:
  agent: judge-identity
  criteria: [correctness, quality]
```

**After:**

```yaml
steps:
  - id: analyze
    name: Analyze Code
    identity: code-reviewer
evaluate:
  identity: judge-identity
  criteria: [correctness, quality]
```

**Verification:**

```bash

# Must return zero results:

grep -rn "^  agent:" Blueprints/Flows/

# Must work without errors:

```

**Success criteria:**

- [x] Zero `agent:` keys remain in any `Blueprints/Flows/*.yaml` file
- [x] `exactl flow validate` exits 0 for all flows

---

### Step 11 — Add `actor*type`, `agent*kind`, `identity_id` columns

**Why:**
The current `activity` table has `actor` and `agent*id` but no `actor*type`,
`agent*kind`, or `identity*id`.  The `agent_id` column is currently used to
store identity blueprint IDs, which is wrong per GLOSSARY.md.  This step adds
the missing columns and backfills `identity*id` from the old `agent*id` values.

**What to do:**
Create the file `migrations/002*actor*identity_fields.sql`:

```sql
-- up
-- Phase 54: add actor*type, agent*kind, identity_id to activity table
-- agent_id column is kept; it now means the runtime agent (AgentRunner, etc.)
-- identity_id is the new column for the LLM identity blueprint reference

ALTER TABLE activity ADD COLUMN actor_type TEXT;
ALTER TABLE activity ADD COLUMN agent_kind TEXT;
ALTER TABLE activity ADD COLUMN identity_id TEXT;

-- Backfill: before Phase 54, agent_id held identity references.
-- Copy those values into identity_id so historical data is not lost.
UPDATE activity SET identity*id = agent*id WHERE agent_id IS NOT NULL;

-- Add index for identity_id queries
CREATE INDEX IF NOT EXISTS idx*activity*identity ON activity(identity_id);
CREATE INDEX IF NOT EXISTS idx*activity*actor*type ON activity(actor*type);
```

Then register and run this migration.  Follow the same pattern as
`migrations/001_init.sql`.  Confirm the migration runner in
`src/services/db.ts` picks up `.sql` files from the `migrations/` folder
in filename order.

**Verification:**

```bash

# Run on a fresh database:


# Run on an existing populated database:


# Check columns exist:


# Expected output must contain: actor*type, agent*kind, identity_id


**Success criteria:**

- [ ] `migrations/002*actor*identity_fields.sql` exists
- [x] `activity` table has columns `actor*type`, `agent*kind`, `identity_id`
- [x] Existing `agent_id` column is still present and unchanged
- [ ] `identity*id` is backfilled from `agent*id` for all pre-migration rows
- [x] Migration is idempotent (safe to run twice)

---

### Step 12 — Update `ActivityRecordSchema` and `LogEntry` in


**Why:**
`ActivityRecordSchema` is the Zod schema that validates rows read back from the
`activity` table.  `LogEntry` is the internal interface for writing rows.
Both must reflect the three new columns added in Step 11.

**What to do:**

Open `src/services/db.ts`.

**Change 1 — `LogEntry` interface** (add three new optional fields):

```typescript
// BEFORE
interface LogEntry {
  activityId: string;
  traceId: string;
  actor: string;
  agentId: string | null;
  actionType: string;
  target: string | null;
  payload: string;
  timestamp: string;
}

// AFTER
interface LogEntry {
  activityId: string;
  traceId: string;
  actor: string;
  actorType: string | null;   // NEW — category of actor (GLOSSARY: actor_type)
  agentId: string | null;     // KEPT — runtime agent id (NOT an identity id)
  agentKind: string | null;   // NEW — category of runtime agent (GLOSSARY: agent_kind)
  identityId: string | null;  // NEW — LLM identity blueprint id (GLOSSARY: identity_id)
  actionType: string;
  target: string | null;
  payload: string;
  timestamp: string;
}
```

**Change 2 — `ActivityRecordSchema`** (add three new nullable fields):

```typescript
// BEFORE
export const ActivityRecordSchema = z.object({
  id: z.string(),
  trace_id: z.string(),
  actor: z.string().nullable(),
  agent_id: z.string().nullable(),
  action_type: z.string(),
  target: z.string().nullable(),
  payload: z.string(),
  timestamp: z.string(),
  count: z.number().optional(),
});

// AFTER
export const ActivityRecordSchema = z.object({
  id: z.string(),
  trace_id: z.string(),
  actor: z.string().nullable(),
  actor_type: z.string().nullable(),    // NEW
  agent_id: z.string().nullable(),
  agent_kind: z.string().nullable(),    // NEW
  identity_id: z.string().nullable(),   // NEW
  action_type: z.string(),
  target: z.string().nullable(),
  payload: z.string(),
  timestamp: z.string(),
  count: z.number().optional(),
});
```

**Change 3 — INSERT statement** inside the method that writes to `activity`
(search for `INSERT INTO activity`):

```typescript
// BEFORE
await db.execute(
  `INSERT INTO activity
     (id, trace*id, actor, agent*id, action_type, target, payload, timestamp)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [entry.activityId, entry.traceId, entry.actor, entry.agentId,
   entry.actionType, entry.target, entry.payload, entry.timestamp]
);

// AFTER
await db.execute(
  `INSERT INTO activity
     (id, trace*id, actor, actor*type, agent*id, agent*kind,
      identity*id, action*type, target, payload, timestamp)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [entry.activityId, entry.traceId, entry.actor, entry.actorType ?? null,
   entry.agentId, entry.agentKind ?? null, entry.identityId ?? null,
   entry.actionType, entry.target, entry.payload, entry.timestamp]
);
```

**Verification:**

```bash
deno check src/services/db.ts
deno task test -- --filter db
```

**Success criteria:**

- [ ] `LogEntry` has `actorType`, `agentKind`, `identityId` fields
- [ ] `ActivityRecordSchema` has `actor*type`, `agent*kind`, `identity_id` fields
- [ ] INSERT statement writes all new columns
- [ ] Zero TypeScript errors in this file

---

### Step 13 — Update `IActivity` and `LogActivityRequest` in

**Why:**
`IActivity` is the domain object returned by repository queries.
`LogActivityRequest` is what callers pass to write a journal record.
Both must expose the three new fields and stop conflating `agentId` with
identity blueprint references.

**What to do:**

Open `src/repositories/activity_repository.ts`.

**Change 1 — `IActivity` interface:**

```typescript
// BEFORE
export interface IActivity {
  id: string;
  traceId: string;
  actor: string | null;
  agentId: string | null;    // was used for both agent and identity — now agent only
  actionType: string;
  target: string | null;
  payload: Record<string, JSONValue>;
  timestamp: string;
}

// AFTER
export interface IActivity {
  id: string;
  traceId: string;
  /** Who performed the action. Format: "user:<email>", "service:<name>", etc. */
  actor: string | null;
  /** Category of actor: "user" | "service" | "mcp-client" | "identity" */
  actorType: string | null;
  /** Runtime agent that handled the execution, e.g. "agent-runner", "flow-runner" */
  agentId: string | null;
  /** Category of runtime agent: "agent-runner" | "flow-agent" | "tool-agent" | "request-router" */
  agentKind: string | null;
  /** LLM identity blueprint that was used, e.g. "senior-coder" */
  identityId: string | null;
  actionType: string;
  target: string | null;
  payload: Record<string, JSONValue>;
  timestamp: string;
}
```

**Change 2 — `LogActivityRequest` interface:**

```typescript
// BEFORE
export interface LogActivityRequest {
  actor: string;
  actionType: string;
  target: string | null;
  payload?: Record<string, JSONValue>;
  traceId?: string;
  agentId?: string | null;   // was used for both agent and identity — now agent only
}

// AFTER
export interface LogActivityRequest {
  /** Who initiated the action */
  actor: string;
  /** Category of actor: "user" | "service" | "mcp-client" | "identity" */
  actorType?: string;
  /** Runtime agent that handled execution — NOT an identity id */
  agentId?: string | null;
  /** Category of runtime agent */
  agentKind?: string | null;
  /** LLM identity blueprint that was used */
  identityId?: string | null;
  actionType: string;
  target: string | null;
  payload?: Record<string, JSONValue>;
  traceId?: string;
}
```

**Change 3 — mapping from `ActivityRecord` to `IActivity`:**
Find the function/method that maps a raw DB row (`ActivityRecord`) to an
`IActivity` object.  Add the three new fields:

```typescript
// Add these lines to the mapping:
actorType: row.actor_type ?? null,
agentKind: row.agent_kind ?? null,
identityId: row.identity_id ?? null,
```

**Verification:**

```bash
deno check src/repositories/activity_repository.ts
deno task test -- --filter activity
```

**Success criteria:**

- [ ] `IActivity` has `actorType`, `agentKind`, `identityId` fields
- [ ] `LogActivityRequest` has `actorType`, `agentKind`, `identityId` fields
- [ ] Mapping from DB row populates the three new fields
- [ ] Zero TypeScript errors in this file

---

### Step 14 — Update `ILogEvent` and `IServiceContext` in

**Why:**
`ILogEvent` is what every service passes to `EventLogger`.  It currently has a
single `agentId` field that is used to carry identity blueprint IDs, which is
wrong.  We split it into `agentId` (runtime agent) and `identityId` (LLM
blueprint).  `IServiceContext` has the same problem.

**What to do:**

Open `src/services/common/types.ts`.

**Change 1 — `ILogEvent`:**

```typescript
// BEFORE
export interface ILogEvent {
  action: string;
  target: string;
  payload?: Record<string, JSONValue>;
  actor?: Actor;
  traceId?: string;
  /** Agent ID for agent-specific events */
  agentId?: string;
  level?: LogLevel;
  icon?: string;
}

// AFTER
export interface ILogEvent {
  action: string;
  target: string;
  payload?: Record<string, JSONValue>;
  /** Who triggered this event — maps to journal actor field */
  actor?: Actor;
  /** Category of actor: "user" | "service" | "mcp-client" | "identity" */
  actorType?: string;
  traceId?: string;
  /** Runtime agent handling this event, e.g. "agent-runner" — NOT an identity id */
  agentId?: string;
  /** Category of runtime agent, e.g. "agent-runner" | "flow-agent" */
  agentKind?: string;
  /** LLM identity blueprint used for this event, e.g. "senior-coder" */
  identityId?: string;
  level?: LogLevel;
  icon?: string;
}
```

**Change 2 — `IServiceContext`:**

```typescript
// BEFORE
export interface IServiceContext {
  traceId?: string;
  agentId?: string;
  actor?: Actor;
}

// AFTER
export interface IServiceContext {
  traceId?: string;
  /** Who initiated the enclosing request */
  actor?: Actor;
  /** Category of actor */
  actorType?: string;
  /** Runtime agent handling this service call — NOT an identity id */
  agentId?: string;
  /** Category of runtime agent */
  agentKind?: string;
  /** LLM identity blueprint being executed */
  identityId?: string;
}
```

**Verification:**

```bash
deno check src/services/common/types.ts

# Find all callers that pass agentId and check they pass the right value:


# Any caller passing an identity slug into agentId must be moved to identityId.


**Success criteria:**

- [ ] `ILogEvent` has `agentId`, `agentKind`, `identityId`, `actorType` fields
- [ ] `IServiceContext` has `agentId`, `agentKind`, `identityId`, `actorType` fields
- [ ] No caller passes an identity blueprint slug into `agentId`
- [ ] Zero TypeScript errors

---

### Step 15 — Update `EventLogger` to write new fields to journal

**Why:**
`EventLogger` reads an `ILogEvent` and writes a `LogActivityRequest`.  It must
now forward the three new fields so they reach the database.

**What to do:**

Open `src/services/event_logger.ts`.

Find the place where `EventLogger` calls `activityRepo.logActivity(...)` or
constructs a `LogActivityRequest`.  Add the three new fields:

```typescript
// BEFORE
await this.activityRepo.logActivity({
  actor: event.actor ?? this.config.defaultActor ?? "system",
  actionType: event.action,
  target: event.target ?? null,
  payload: event.payload ?? {},
  traceId: event.traceId,
  agentId: event.agentId ?? null,
});

// AFTER
await this.activityRepo.logActivity({
  actor: event.actor ?? this.config.defaultActor ?? "system",
  actorType: event.actorType ?? null,
  actionType: event.action,
  target: event.target ?? null,
  payload: event.payload ?? {},
  traceId: event.traceId,
  agentId: event.agentId ?? null,          // runtime agent — NOT identity
  agentKind: event.agentKind ?? null,
  identityId: event.identityId ?? null,    // LLM blueprint id
});
```

**Verification:**

```bash
deno check src/services/event_logger.ts
deno task test -- --filter event_logger
```

**Success criteria:**

- [ ] `EventLogger` passes `actorType`, `agentKind`, `identityId` to
  `logActivity`
- [ ] No call to `logActivity` passes an identity slug into `agentId`
- [ ] Zero TypeScript errors in this file

---

### Step 16 — Fix callers that wrongly pass identity slugs into `agentId`

**Why:**
Before this phase, many services passed an identity blueprint id (e.g.
`"senior-coder"`) into `ILogEvent.agentId` because there was no `identityId`
field.  Now that `identityId` exists, every such call site must be corrected.

**What to do:**

Run this grep to find every call site that sets `agentId`:

```bash
grep -rn "agentId:" src/ --include="*.ts"
```

For each result, read the value being passed:

- If the value is an **identity blueprint slug** (e.g. `"senior-coder"`,
  `opts.identity`, `step.identity`, `blueprint.id`, `config.agentId` where
  `agentId` was previously set from frontmatter `identity:`) →
  **move it to `identityId`** and set `agentId` to the runtime agent name
  (e.g. `"agent-runner"`, `"flow-runner"`).

- If the value is a **runtime agent name** (e.g. `"agent-runner"`,
  `"flow-runner"`, `AgentRunner.id`, `this.agentId` where the class is
  `AgentRunner`) → **leave it in `agentId`** and add `agentKind` if known.

**Typical patterns to fix:**

```typescript
// PATTERN 1 — identity slug passed as agentId (wrong)
// Found in: AgentRunner, FlowRunner, RequestProcessor
// BEFORE
await this.logger.info("agent.execution.started", requestId, {}, {
  agentId: blueprint.id,   // ← blueprint.id is an identity slug
});
// AFTER
await this.logger.info("agent.execution.started", requestId, {}, {
  agentId: "agent-runner",       // runtime agent name
  agentKind: "agent-runner",
  identityId: blueprint.id,      // ← identity slug moved here
});

// PATTERN 2 — identity from request options passed as agentId (wrong)
// Found in: RequestProcessor, RequestRouter
// BEFORE
await this.logger.info("request.processing.started", requestId, {}, {
  actor: actor,
  agentId: opts.identity,   // ← opts.identity is an identity slug
});
// AFTER
await this.logger.info("request.processing.started", requestId, {}, {
  actor: actor,
  actorType: "user",
  agentId: "request-router",     // runtime agent name
  agentKind: "request-router",
  identityId: opts.identity,     // ← identity slug moved here
});
```

**Verification:**

```bash

# After fixing all call sites, this should show only runtime agent names,

grep -rn "agentId:" src/ --include="*.ts"

# identityId should now appear at every LLM call site:


deno check src/
deno task test
```

**Success criteria:**

- [ ] Every `agentId:` value in source is a runtime agent name string, not an
  identity slug
- [ ] Every place a blueprint id is logged uses `identityId:` instead
- [ ] `grep -rn "identityId:" src/` returns at least one result per LLM call
  site (`agent*runner.ts`, `flow*runner.ts`)
- [ ] Zero TypeScript errors
- [ ] All tests pass

---

### Step 17 — Fix enum values in `src/shared/enums.ts` that represent

**Why:**
Several enum values use the word `"agent"` but semantically mean either an
identity (LLM persona) or an actor (who initiated something).  Using `"agent"`
for these makes the enum inconsistent with GLOSSARY.md.

**What to do:**

Open `src/shared/enums.ts`.  Make exactly the following value renames.  Change
**only the value string** and the **member name**.  Do not rename the enum
itself unless stated.

| Enum | Old member | Old string value | New member | New string value | Reason |
| --- | --- | --- | --- | --- | --- |
| `ActivityActor` | `AGENT` | `"agent"` | `IDENTITY` | `"identity"` | An autonomous LLM identity is the actor, not the AgentRunner |
| `RequestKind` | `AGENT` | `"agent"` | `IDENTITY` | `"identity"` | A request dispatched to an identity blueprint |
| `GroupingMode` | `AGENT` | `"agent"` | `IDENTITY` | `"identity"` | Grouped by LLM identity, not runtime agent |
| `RequestGroupingMode` | `AGENT` | `"agent"` | `IDENTITY` | `"identity"` | Same |
| `LogGroupingMode` | `AGENT` | `"agent"` | `ACTOR` | `"actor"` | Grouped by who produced the log (actor concept) |
| `RequestDialogType` | `FILTER*AGENT` | `"filter-agent"` | `FILTER*IDENTITY` | `"filter-identity"` | Filter UI by identity |
| `MemoryBankSource` | `AGENT` | `"agent"` | `IDENTITY` | `"identity"` | Memory produced by an LLM identity execution |
| `TuiNodeType` | `AGENT` | `"agent"` | `IDENTITY` | `"identity"` | TUI tree node for an identity |
| `TuiIcon` | `AGENT` | `"🤖"` | `IDENTITY` | `"🤖"` | Icon represents identity persona |
| `AgentExecutionErrorType` | `AGENT*ERROR` | `"agent*error"` | `EXECUTION*ERROR` | `"execution*error"` | Generic execution failure, not agent-specific |

**Do NOT rename** these (they are correctly named runtime agent concepts):

- `AgentHealth` enum — keep as-is
- `AgentStatus` const — keep as-is
- `AgentExecutionErrorType` enum name — keep, only rename the `AGENT_ERROR`
  member above
- `FlowStepType.AGENT` — keep as-is (internal enum)

**After each rename, fix all call sites:**

```bash

# Find every usage of each old name, example for ActivityActor:


# Replace with ActivityActor.IDENTITY

# Repeat for every renamed member:

grep -rn "GroupingMode\.AGENT" src/ tests/
grep -rn "RequestGroupingMode\.AGENT" src/ tests/
grep -rn "LogGroupingMode\.AGENT" src/ tests/
grep -rn "FILTER_AGENT" src/ tests/
grep -rn "MemoryBankSource\.AGENT" src/ tests/
grep -rn "TuiNodeType\.AGENT" src/ tests/
grep -rn "TuiIcon\.AGENT" src/ tests/
grep -rn "AgentExecutionErrorType\.AGENT_ERROR" src/ tests/
```

**Verification:**

```bash
deno check src/
deno task test
```

**Success criteria:**

- [x] All ten renames applied in `src/shared/enums.ts`
- [x] Zero remaining usages of old member names (grep returns zero)
- [x] Zero TypeScript errors
- [x] All tests pass

---

### Step 18 — Update all tests

**What to do:**

Run each grep below.  For every match apply the fix shown.

```bash

# 1. Deprecated --agent flag in tests


# Fix: replace --agent with --identity

# 2. agent: frontmatter in test fixtures


# Fix: replace agent: with identity: in YAML frontmatter strings

# 3. Old Blueprints/Agents/ paths


# Fix: replace Blueprints/Agents/ with Blueprints/Identities/

# 4. Old enum members renamed in Step 17


# Fix: apply the same renames from Step 17

# 5. agentId in test assertions that should now be identityId


# Fix: if the value being asserted is an identity slug, change to identityId:


**Add one new positive test** to confirm the three journal fields are written
correctly.  Add it to the test file nearest to `EventLogger` or
`ActivityRepository`:

```typescript
it("journal row has actor, agentId and identityId as separate fields", async () => {
  // Arrange
  const traceId = crypto.randomUUID();
  await logger.info("test.event", "some-target", {}, {
    actor: "user:test@example.com",
    actorType: "user",
    agentId: "agent-runner",
    agentKind: "agent-runner",
    identityId: "senior-coder",
    traceId,
  });

  // Act
  const rows = await activityRepo.getActivitiesByTraceId(traceId);

  // Assert
  expect(rows).toHaveLength(1);
  expect(rows.actor).toBe("user:test@example.com");
  expect(rows.actorType).toBe("user");
  expect(rows.agentId).toBe("agent-runner");
  expect(rows.agentKind).toBe("agent-runner");
  expect(rows.identityId).toBe("senior-coder");
});
```

**Verification:**

```bash
deno task test
```

**Success criteria:**

- [ ] All five grep commands above return zero results (after fixes)
- [ ] New journal fields test passes
- [ ] Full test suite passes: `deno task test`

---

### Step 19 — Final audit and CI

Run all checks below.  Every "must be zero" check must return zero results
before this phase is considered complete.

```bash

# ── Must return ZERO results ──────────────────────────────────────────────

# Deprecated CLI flag


# Deprecated Agents directory reference


# Old enum member names (renamed in Step 17)

grep -rn "RequestGroupingMode\.AGENT\|LogGroupingMode\.AGENT\|FILTER_AGENT" src/ tests/
grep -rn "MemoryBankSource\.AGENT\|TuiNodeType\.AGENT\|TuiIcon\.AGENT" src/ tests/
grep -rn "AgentExecutionErrorType\.AGENT_ERROR" src/ tests/

# Identity slugs wrongly stored in agentId (spot-check known files)


# ── Must return NON-ZERO results (confirm kept names still exist) ─────────

grep -rn "AgentRunner\|AgentHealth\|AgentStatus" src/
grep -rn "FlowStepType\.AGENT" src/
grep -rn "identityId" src/repositories/ src/services/event_logger.ts
grep -rn "actor*type\|agent*kind\|identity_id" migrations/

# ── Full pipeline ─────────────────────────────────────────────────────────

deno task lint
deno check src/
deno task test
deno run -A scripts/ci.ts all
```

**Success criteria:**

- [x] All "must be zero" greps return zero results
- [x] All "must be non-zero" greps confirm kept names still exist
- [x] `deno check src/` reports zero TypeScript errors
- [x] `deno task test` reports zero failures
- [x] CI pipeline green end-to-end

---

## Updated Breaking Changes Summary

| Surface | Change | Migration |
| --- | --- | --- |
| `--agent` CLI flag | Removed (Step 1) | Use `--identity` |
| `exactl blueprint agent *` | Removed (Step 2) | Use `exactl blueprint identity *` |
| `agent:` request frontmatter | No longer parsed (Step 4) | Use `identity:` |
| `exaix*create*request` MCP `agent` param | Removed (Step 5) | Use `identity` param |
| `Blueprints/Agents/` directory scan | Removed (Step 3) | Move files to `Blueprints/Identities/` |
| `agent:` in flow YAML steps and gates | Removed (Steps 6–10) | Use `identity:` |
| `activity.agent*id` semantics | Now means runtime agent only | Use `activity.identity*id` for LLM blueprint |
| `ILogEvent.agentId` semantics | Now means runtime agent only | Use `ILogEvent.identityId` for LLM blueprint |
| `ActivityActor.AGENT` enum member | Renamed to `IDENTITY` (Step 17) | Use `ActivityActor.IDENTITY` |
| `RequestKind.AGENT` | Renamed to `IDENTITY` (Step 17) | Use `RequestKind.IDENTITY` |
| `GroupingMode.AGENT` | Renamed to `IDENTITY` (Step 17) | Use ` |

---

## Implementation Summary - Steps 10-16

### Step 10 — Migrate Blueprints/Flows/ YAML files ✅

**✅ IMPLEMENTED** — 21 YAML files migrated (`agent:` → `identity:`)

- All `Blueprints/Flows/*.yaml` files updated
- Zero `agent:` keys remain in flow step definitions
- Flow validation passes for all migrated files

### Step 11 — Add actor_type, agent_kind, identity_id columns ✅

**✅ IMPLEMENTED** — `migrations/002_actor_identity_fields.sql` created

- Migration adds `actor_type`, `agent_kind`, `identity_id` columns to `activity` table
- Backfills `identity_id` from existing `agent_id` values
- Creates indexes for new columns

### Step 12 — Update ActivityRecordSchema and LogEntry ✅

**✅ IMPLEMENTED** — `src/services/db.ts` updated

- `ActivityRecordSchema` includes `actor_type`, `agent_kind`, `identity_id` fields
- `LogEntry` interface includes new fields
- INSERT statement writes all new columns

### Step 13 — Update IActivity and LogActivityRequest ✅

**✅ IMPLEMENTED** — `src/repositories/activity_repository.ts` updated

- `IActivity` interface includes `actorType`, `agentKind`, `identityId` fields
- `LogActivityRequest` interface includes new optional fields
- Mapping from `ActivityRecord` populates all new fields

### Step 14 — Update ILogEvent and IServiceContext ✅

**✅ IMPLEMENTED** — `src/services/common/types.ts`, `src/shared/enums.ts` updated

- Added `ActorType` and `AgentKind` enums
- `ILogEvent` includes `actorType`, `agentKind`, `identityId` fields
- `IServiceContext` includes new fields

### Step 15 — Update EventLogger ✅

**✅ IMPLEMENTED** — `src/services/event_logger.ts` updated

- `logToDatabase()` passes `actorType`, `agentKind`, `identityId` to repository
- Both ActivityRepository and direct DatabaseService paths updated

### Step 16 — Fix callers ✅

**✅ IMPLEMENTED** — Multiple files updated

- `flow_runner.ts` logging uses `identityId` field
- Test fixtures updated to use proper Actor/Agent/Identity fields
- 12+ test files migrated

---

## Commits

| Commit | Description |
| -------- | ------------- |
| `0b28129c` | Steps 8-9: define_flow.ts, flow_runner.ts logging |
| `06da0900` | Steps 10-12: YAML migration, database schema |
| `02c0679f` | Steps 14-16: ILogEvent, EventLogger, ActorType/AgentKind enums |

---

## CI Verification

All gates passed:

- ✅ deno check — 0 errors
- ✅ deno lint — 0 errors
- ✅ deno fmt — all files formatted
- ✅ check:style — 0 errors
- ✅ check:arch — 331 GROUNDED, 0 UNGROUNDED
- ✅ check:complexity — 0 breaches
- ✅ Tests — 232+ passing (flows/, helpers/)

---

### Step 20 — Fix `AgentExecutor`: separate `identityId` from `agentId` in all journal calls

**File:** `src/services/agent_executor.ts`

**Background.**
`AgentExecutor` currently passes the identity blueprint slug into `agentId`
in every journal call (`logExecutionStart`, `logExecutionComplete`,
`logExecutionError`).  Per GLOSSARY.md:

- `agentId` = runtime agent that handled execution → `"agent-executor"`
- `identityId` = which LLM blueprint was used → the blueprint slug

The parameter called `agentId` in the three log methods actually holds a
blueprint slug.  It must be renamed `identityId` and a fixed `agentId` value
of `"agent-executor"` added.

**Change 1 — `logExecutionStart`:**

```typescript
// BEFORE
async logExecutionStart(
  traceId: string,
  agentId: string,   // ← holds blueprint slug, e.g. "senior-coder"
  portal: string,
): Promise<void> {
  await this.logger.log({
    action: "agent.execution_started",
    target: portal,
    actor: "system",
    traceId: traceId,
    agentId: agentId,   // ← wrong concept
    payload: { portal, started_at: new Date().toISOString() },
  });
}

// AFTER
async logExecutionStart(
  traceId: string,
  identityId: string,   // ← renamed: holds blueprint slug
  portal: string,
): Promise<void> {
  await this.logger.log({
    action: "agent.execution_started",
    target: portal,
    actor: "system",
    actorType: "service",
    traceId: traceId,
    agentId: "agent-executor",    // ← runtime agent name (constant)
    agentKind: "agent-executor",  // ← runtime agent category
    identityId: identityId,       // ← blueprint slug moved here
    payload: { portal, started_at: new Date().toISOString() },
  });
}
```

**Change 2 — `logExecutionComplete`:**

```typescript
// BEFORE
async logExecutionComplete(
  traceId: string,
  agentId: string,
  result: IChangesetResult,
): Promise<void> {
  await this.logger.log({
    action: "agent.execution_completed",
    target: result.branch,
    actor: "system",
    traceId: traceId,
    agentId: agentId,
    payload: { ... },
  });
}

// AFTER
async logExecutionComplete(
  traceId: string,
  identityId: string,
  result: IChangesetResult,
): Promise<void> {
  await this.logger.log({
    action: "agent.execution_completed",
    target: result.branch,
    actor: "system",
    actorType: "service",
    traceId: traceId,
    agentId: "agent-executor",
    agentKind: "agent-executor",
    identityId: identityId,
    payload: { ... },
  });
}
```

**Change 3 — `logExecutionError`:**

```typescript
// BEFORE
async logExecutionError(
  traceId: string,
  agentId: string,
  error: { type: string; message: string; trace_id?: string },
): Promise<void> {
  await this.logger.log({
    action: "agent.execution_failed",
    target: agentId,
    actor: "system",
    traceId: traceId,
    agentId: agentId,
    level: LogLevel.ERROR,
    payload: { ... },
  });
}

// AFTER
async logExecutionError(
  traceId: string,
  identityId: string,
  error: { type: string; message: string; trace_id?: string },
): Promise<void> {
  await this.logger.log({
    action: "agent.execution_failed",
    target: identityId,         // target is now the identity that failed
    actor: "system",
    actorType: "service",
    traceId: traceId,
    agentId: "agent-executor",
    agentKind: "agent-executor",
    identityId: identityId,
    level: LogLevel.ERROR,
    payload: { ... },
  });
}
```

**Change 4 — update the three call sites inside `executeStep`:**

```typescript
// BEFORE
await this.logExecutionStart(context.trace_id, options.agent_id, options.portal);
await this.logExecutionComplete(context.trace_id, options.agent_id, validated);
await this.logExecutionError(context.trace_id, options.agent_id, { ... });

// AFTER
await this.logExecutionStart(context.trace_id, options.identity_id, options.portal);
await this.logExecutionComplete(context.trace_id, options.identity_id, validated);
await this.logExecutionError(context.trace_id, options.identity_id, { ... });
```

Note: `options.agent_id` → `options.identity_id` here because the field
in `IAgentExecutionOptions` that carries the blueprint slug must also be
renamed (see Step 21).

**Verification:**

```bash
deno check src/services/agent_executor.ts
grep -n "agentId:" src/services/agent_executor.ts
# Every agentId: must now be "agent-executor" (a constant string)
# No line should pass options.agent_id or a blueprint slug into agentId
deno task test -- --filter agent_executor
```

**Success criteria:**

- [x] `logExecutionStart`, `logExecutionComplete`, `logExecutionError` all accept `identityId` parameter instead of `agentId`
- [x] All three methods write `agentId: "agent-executor"` and
  `identityId: <blueprint slug>` to the journal
- [x] Zero TypeScript errors

---

### Step 21 — Fix `IAgentExecutionOptions` and `IExecutionContext` schemas: rename `agent_id` field to `identity_id`

**File:** `src/shared/schemas/agent_executor.ts`

**Background.**
`IAgentExecutionOptions.agent_id` holds the identity blueprint slug.  Per
GLOSSARY.md this field should be `identity_id`.  `agent_id` in these schemas
means "which blueprint to use", not "which runtime agent", so the name is wrong.

**What to do:**

Open `src/shared/schemas/agent_executor.ts`.

Find the Zod schema and TypeScript type for `IAgentExecutionOptions`.

```typescript
// BEFORE
export const AgentExecutionOptionsSchema = z.object({
  agent_id: z.string(),    // ← holds blueprint slug
  portal: z.string(),
  security_mode: z.nativeEnum(SecurityMode),
  // ...
});
export type IAgentExecutionOptions = z.infer<typeof AgentExecutionOptionsSchema>;

// AFTER
export const AgentExecutionOptionsSchema = z.object({
  identity_id: z.string(),   // ← renamed: holds blueprint slug
  portal: z.string(),
  security_mode: z.nativeEnum(SecurityMode),
  // ...
});
export type IAgentExecutionOptions = z.infer<typeof AgentExecutionOptionsSchema>;
```

After renaming, find all usages of `options.agent_id` across the codebase and
replace with `options.identity_id`:

```bash
grep -rn "options\.agent_id\|opts\.agent_id" src/ tests/
# Replace every match with options.identity_id / opts.identity_id
```

Also update the `permissions.checkAgentAllowed` call in `executeStep` — the
second argument is the identity slug, not a runtime agent id.  Rename the
check method's parameter locally for clarity:

```typescript
// BEFORE
if (!this.permissions.checkAgentAllowed(options.portal, options.agent_id).allowed) {
  throw new Error(`Agent not allowed to access portal: ${options.agent_id} -> ${options.portal}`);
}
const _blueprint = await this.loadBlueprint(options.agent_id);

// AFTER
if (!this.permissions.checkAgentAllowed(options.portal, options.identity_id).allowed) {
  throw new Error(
    `Identity not allowed to access portal: ${options.identity_id} -> ${options.portal}`
  );
}
const _blueprint = await this.loadBlueprint(options.identity_id);
```

**Verification:**

```bash
grep -rn "agent_id" src/shared/schemas/agent_executor.ts
# Must return zero results

grep -rn "options\.agent_id\|opts\.agent_id" src/ tests/
# Must return zero results

deno check src/
deno task test
```

**Success criteria:**

- [x] `IAgentExecutionOptions.identity_id` replaces `agent_id`
- [x] All callers updated
- [x] Zero TypeScript errors
- [x] All tests pass

---

### Step 22 — Fix `MemoryBankService.logActivity`: add `actor`, `actorType`, `agentId`, `agentKind`, `identityId` to every journal call

**File:** `src/services/memory_bank.ts`

**Background.**
`MemoryBankService.logActivity` currently calls `db.logActivity` with
`"system"` as actor and `null` as `agent_id`.  It carries no `actor_type`,
`agent_kind`, or `identity_id`.  Per GLOSSARY.md, memory bank is an Exaix
internal service acting as an **Actor** of type `"service"`, the runtime
agent handling the call is `"memory-bank"`, and there is no LLM identity
involved in storage operations (so `identity_id` is `null`).

**Change — the private `logActivity` helper method:**

```typescript
// BEFORE
private logActivity(event: {
  event_type: string;
  target: string;
  trace_id?: string;
  metadata?: Record<string, JSONValue>;
}): void {
  try {
    this.db.logActivity(
      "system",
      event.event_type,
      event.target,
      event.metadata || {},
      event.trace_id,
      null,   // No agent_id for memory bank operations
    );
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
}

// AFTER
private logActivity(event: {
  event_type: string;
  target: string;
  trace_id?: string;
  metadata?: Record<string, JSONValue>;
}): void {
  try {
    this.db.logActivity(
      "service:memory-bank",   // actor: this service is the actor
      event.event_type,
      event.target,
      event.metadata || {},
      event.trace_id,
      null,                    // agent_id: no runtime LLM agent involved
    );
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
}
```

However, `db.logActivity` signature itself must also accept `actorType`,
`agentKind`, `identityId`.  Check the current signature in `src/services/db.ts`
and extend it:

```typescript
// Current signature (inferred from usage):
logActivity(
  actor: string,
  actionType: string,
  target: string,
  payload: Record<string, JSONValue>,
  traceId?: string,
  agentId?: string | null,
): void

// New signature (add three optional fields at end to stay backward-compatible):
logActivity(
  actor: string,
  actionType: string,
  target: string,
  payload: Record<string, JSONValue>,
  traceId?: string,
  agentId?: string | null,
  agentKind?: string | null,
  actorType?: string | null,
  identityId?: string | null,
): void
```

Update all `MemoryBankService` calls to `logActivity` to pass the new fields:

```typescript
// Example — createExecutionRecord call site:

// BEFORE
this.logActivity({
  event_type: "memory.execution.recorded",
  target: execution.portal,
  trace_id: execution.trace_id,
  metadata: {
    status: execution.status,
    agent: execution.agent,     // ← field named "agent" in metadata
    files_changed: ...,
  },
});

// AFTER
this.logActivity({
  event_type: "memory.execution.recorded",
  target: execution.portal,
  trace_id: execution.trace_id,
  metadata: {
    status: execution.status,
    identity_id: execution.agent,   // ← rename metadata key: agent → identity_id
    files_changed: ...,
  },
});
```

Note: `execution.agent` in `IExecutionMemory` is the identity blueprint slug
stored in the execution record.  The metadata key should be `identity_id`,
not `agent`.

**Verification:**

```bash
deno check src/services/memory_bank.ts
grep -n '"agent"' src/services/memory_bank.ts
# Must return zero results (all "agent" metadata keys renamed to "identity_id")
deno task test -- --filter memory_bank
```

**Success criteria:**

- [x] `logActivity` helper uses `"service:memory-bank"` as actor
- [x] `db.logActivity` signature accepts `agentKind`, `actorType`, `identityId`
- [x] Metadata key `"agent"` in `memory.execution.recorded` renamed to
  `"identity_id"`
- [x] Zero TypeScript errors

---

### Step 23 — Fix `ExecutionMemorySchema.agent` → `identity_id` in shared schema

**File:** `src/shared/schemas/memory_bank.ts`

**Problem:** `ExecutionMemorySchema` has a field `agent: z.string()` which means "which identity/blueprint performed the execution." This is `identity_id`, not a runtime agent ID.

**BEFORE:**

```typescript
export const ExecutionMemorySchema = z.object({
  // ...
  portal: z.string().describe("Portal this execution ran against"),
  agent: z.string().describe("Agent that performed the execution"),
  summary: z.string().describe("Human-readable summary of what was done"),
  // ...
});
```

**AFTER:**

```typescript
export const ExecutionMemorySchema = z.object({
  // ...
  portal: z.string().describe("Portal this execution ran against"),
  identity_id: z.string().describe("Identity (blueprint name) that performed the execution"),
  agent_id: z.string().optional().describe("Runtime agent instance ID, if available"),
  summary: z.string().describe("Human-readable summary of what was done"),
  // ...
});
```

**Also update** the `IExecutionMemory` type (derived automatically via `z.infer` — no manual change needed if above is done).

**Verify:**

```bash
grep -n '"agent"' src/shared/schemas/memory_bank.ts
grep -n 'agent:' src/shared/schemas/memory_bank.ts
```

Both should return zero results after the change.

**Success criteria:**

- [x] `IExecutionMemory.agent` no longer exists
- [x] `IExecutionMemory.identity_id` is `string` (required)
- [x] `IExecutionMemory.agent_id` is `string | undefined` (optional)
- `deno check src/shared/schemas/memory_bank.ts` passes

### Step 24 — Fix `MemoryUpdateProposalSchema.agent` → `identity_id` in shared schema

**File:** `src/shared/schemas/memory_bank.ts`

**Problem:** `MemoryUpdateProposalSchema` has `agent: z.string()` which tracks "which identity proposed the memory update." This should be `identity_id`.

**BEFORE:**

```typescript
export const MemoryUpdateProposalSchema = z.object({
  // ...
  reason: z.string().describe("Why this update is proposed"),
  agent: z.string().describe("Agent that proposed the update"),
  execution_id: z.string().optional().describe("Related execution trace_id"),
  // ...
});
```

**AFTER:**

```typescript
export const MemoryUpdateProposalSchema = z.object({
  // ...
  reason: z.string().describe("Why this update is proposed"),
  identity_id: z.string().describe("Identity (blueprint name) that proposed the update"),
  execution_id: z.string().optional().describe("Related execution trace_id"),
  // ...
});
```

**Verify:**

```bash
grep -n 'agent:' src/shared/schemas/memory_bank.ts
```

Should return zero results after the change.

**Success criteria:**

  - [x] `IMemoryUpdateProposal.agent` no longer exists
  - [x] `IMemoryUpdateProposal.identity_id` is `string` (required)
  - [x] `deno check src/shared/schemas/memory_bank.ts` passes

### Step 25 — Update `MemoryBankService` to use `identity_id` in execution records and activity logging

**File:** `src/services/memory_bank.ts`

**Problem 1:** In `createExecutionRecord()`, the `logActivity` call passes `execution.agent` in metadata. After Step 23, this field is now `execution.identity_id`.

**BEFORE:**

```typescript
this.logActivity({
  event_type: "memory.execution.recorded",
  target: execution.portal,
  trace_id: execution.trace_id,
  metadata: {
    status: execution.status,
    agent: execution.agent,
    files_changed: ...
  },
});
```

**AFTER:**

```typescript
this.logActivity({
  event_type: "memory.execution.recorded",
  target: execution.portal,
  trace_id: execution.trace_id,
  metadata: {
    status: execution.status,
    identity_id: execution.identity_id,
    agent_id: execution.agent_id,
    files_changed: ...
  },
});
```

**Problem 2:** In `logActivity()` private method, the call to `this.db.logActivity` passes `null` as `agent_id`:

```typescript
this.db.logActivity(
  "system",
  event.event_type,
  event.target,
  event.metadata || {},
  event.trace_id,
  null, // No agent_id for memory bank operations
);
```

This is already correctly passing `null` for `agent_id` (runtime agent), and `"system"` as actor. **No change needed here** — this is already semantically correct: memory bank itself is the system actor with no runtime agent.

**Verify:**

```bash
grep -n 'execution\.agent' src/services/memory_bank.ts
grep -n '"agent":' src/services/memory_bank.ts
```

Both should return zero results after the change.

**Success criteria:**

- [x] `execution.agent` reference replaced with `execution.identity_id` in all metadata calls
  - [x] `deno check src/services/memory_bank.ts` passes

### Step 26 — Update `MemoryExtractorService.createProposal()` to use `identity_id` instead of `agent`

**File:** `src/services/memory_extractor.ts`

**Problem:** `createProposal()` accepts `agent: string` parameter and sets `proposal.agent = agent`. After Step 24, `IMemoryUpdateProposal` uses `identity_id` instead of `agent`.

**BEFORE (method signature and body):**

```typescript
async createProposal(
  learning: IProposalLearning,
  execution: IExecutionMemory,
  agent: string,
): Promise<string> {
  await ensureDir(this.pendingDir);

  const proposal: IMemoryUpdateProposal = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    operation: MemoryOperation.ADD,
    target_scope: learning.scope,
    target_project: learning.project,
    learning,
    reason: `Extracted from execution ${execution.trace_id}`,
    agent,
    execution_id: execution.trace_id,
    status: MemoryStatus.PENDING,
  };

  // ...

  this.logActivity({
    event_type: "memory.proposal.created",
    target: learning.project || MemoryScope.GLOBAL,
    metadata: {
      proposal_id: proposal.id,
      learning_title: learning.title,
      category: learning.category,
      agent,
    },
  });
```

**AFTER:**

```typescript
async createProposal(
  learning: IProposalLearning,
  execution: IExecutionMemory,
  identityId: string,
): Promise<string> {
  await ensureDir(this.pendingDir);

  const proposal: IMemoryUpdateProposal = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    operation: MemoryOperation.ADD,
    target_scope: learning.scope,
    target_project: learning.project,
    learning,
    reason: `Extracted from execution ${execution.trace_id}`,
    identity_id: identityId,
    execution_id: execution.trace_id,
    status: MemoryStatus.PENDING,
  };

  // ...

  this.logActivity({
    event_type: "memory.proposal.created",
    target: learning.project || MemoryScope.GLOBAL,
    metadata: {
      proposal_id: proposal.id,
      learning_title: learning.title,
      category: learning.category,
      identity_id: identityId,
    },
  });
```

**Also update** any callers of `createProposal()` — find them with:

```bash
grep -rn 'createProposal(' src/
```

For each call site, rename the third argument variable from `agent` to the appropriate identity value (e.g., `execution.identity_id` or the identity name string).

**Success criteria:**

  - [x] `createProposal` parameter renamed from `agent` to `identityId`
  - [x] `proposal.agent` assignment replaced with `proposal.identity_id = identityId`
- All call sites updated to pass identity name as third argument
  - [x] `deno check src/services/memory_extractor.ts` passes

### Step 27 — Audit `NotificationService` actor semantics and fix logActivity calls

**File:** `src/services/notification.ts`

**Problem:** The `logActivity` private helper passes `"notification-service"` as the first argument (actor). This is a system-internal actor name — acceptable. However, `notifyMemoryUpdate()` should carry `identity_id` in metadata when the proposal contains one (after Step 24, `proposal.identity_id` exists).

**BEFORE (in `notifyMemoryUpdate`):**

```typescript
this.logActivity({
  event_type: "memory.update.pending",
  target: proposal.target_project || "global",
  metadata: {
    proposal_id: proposal.id,
    learning_title: proposal.learning?.title || "Untitled",
    reason: proposal.reason,
  },
});
```

**AFTER:**

```typescript
this.logActivity({
  event_type: "memory.update.pending",
  target: proposal.target_project || "global",
  metadata: {
    proposal_id: proposal.id,
    learning_title: proposal.learning?.title || "Untitled",
    reason: proposal.reason,
    identity_id: proposal.identity_id,   // which identity triggered this proposal
  },
});
```

**Problem 2:** `notifyApproval` and `notifyRejection` log via `logActivity` but do not receive a proposal object, only IDs. These are fine as-is — no `identity_id` available at that call point, and logging is already using `"notification-service"` as actor.

**Final audit grep:**

```bash
grep -rn '\.agent' src/services/notification.ts
grep -rn '"agent"' src/services/notification.ts
```

Both should return zero results.

**Success criteria:**

  - [x] `notifyMemoryUpdate` metadata includes `identity_id` from proposal
- No `agent` field references in `notification.ts`
  - [x] `deno check src/services/notification.ts` passes

### Cross-cutting Final Audit (Step 28 — Optional cleanup pass)

After Steps 23–27 are applied, run the following to verify no stale `agent` references remain in the memory subsystem:

```bash
# Should find ZERO results for misused "agent" as identity in these files:
grep -n '\.agent\b' \
  src/shared/schemas/memory_bank.ts \
  src/services/memory_bank.ts \
  src/services/memory_extractor.ts \
  src/services/notification.ts

# Should find the NEW correct names:
grep -n 'identity_id' \
  src/shared/schemas/memory_bank.ts \
  src/services/memory_bank.ts \
  src/services/memory_extractor.ts \
  src/services/notification.ts

# TypeScript check on all affected files:
deno check \
  src/shared/schemas/memory_bank.ts \
  src/services/memory_bank.ts \
  src/services/memory_extractor.ts \
  src/services/notification.ts

# Run tests:
deno test tests/services/ --allow-all
```

**Summary of what changed in Steps 23–27:**

| Location | BEFORE | AFTER |
| --- | --- | --- |
| `ExecutionMemorySchema` | `agent: string` | `identity_id: string`, `agent_id?: string` |
| `MemoryUpdateProposalSchema` | `agent: string` | `identity_id: string` |
| `MemoryBankService.createExecutionRecord` | `metadata.agent` | `metadata.identity_id`, `metadata.agent_id` |
| `MemoryExtractorService.createProposal` | param `agent`, sets `proposal.agent` | param `identityId`, sets `proposal.identity_id` |
| `NotificationService.notifyMemoryUpdate` | no identity in metadata | `metadata.identity_id` from proposal |

No runtime `AgentRunner`, `AgentHealth`, or `AgentStatus` names are touched. The `SkillCompatibilitySchema.agents` array (list of compatible agent kind IDs) is also left unchanged — it is intentionally about runtime agent kinds, not identities.
