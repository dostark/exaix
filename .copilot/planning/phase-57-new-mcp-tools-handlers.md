---
agent: claude
scope: dev
title: "Phase 57: New MCP Tool Handlers — File and Directory Operations"
short*summary: "Implement patch*file, delete*file, move*file, and create_directory MCP tool handlers to close critical gaps in Exaix's file operation toolset, enabling agents to perform refactoring, targeted edits, and directory management within portals."
version: "1.0"
topics: ["mcp", "tools", "file-operations", "handlers", "schemas", "security", "portal"]
---

> [!NOTE]
> **Status: ⏳ Pending**
> This phase adds four new MCP tool handlers following the established `ToolHandler` base class pattern.
> All tools operate within portal bounds, check `PortalOperation.WRITE` permissions, and log every
> execution to the Activity Journal.
>
> **`run*command` / `run*script` are intentionally excluded** from this phase. Their power and risk
> profile require separate design consideration. See [Future Enhancements](#future-enhancements) below.
>
> **Prerequisite:** None. Builds on the existing MCP handler infrastructure established in prior phases.

## Executive Summary

Exaix currently has `write_file` as its only file mutation tool. This is insufficient for real software
engineering tasks: refactoring requires targeted edits (not full rewrites), renaming modules requires
moving files, and removing dead code requires deletion. This phase implements the minimum viable file
operation toolset for a coding agent, using the exact same handler pattern as existing tools.

### **Tool Inventory: This Phase**

| Tool | MCP Name | Priority | Operation Type |
| -------------- | -------------------- | -------- | -------------- |
| `patch*file` | `patch*file` | P0 | Write (targeted) |
| `delete*file` | `delete*file` | P1 | Write (destructive) |
| `move*file` | `move*file` | P1 | Write (destructive) |
| `create*directory` | `create*directory` | P1 | Write (safe) |

> **Not in this phase:** `delete*directory`, `run*command`, `run_script`.
> `delete_directory` is deferred — recursive deletion is too destructive for the current
> supervised model without additional confirmation gates.

---

## Goals

- [x] Add Zod schemas for all four new tools to `src/shared/schemas/mcp.ts`
- [x] Implement `PatchFileTool` in `src/mcp/handlers/patch*file*tool.ts`
- [x] Implement `DeleteFileTool` in `src/mcp/handlers/delete*file*tool.ts`
- [x] Implement `MoveFileTool` in `src/mcp/handlers/move*file*tool.ts`
- [x] Implement `CreateDirectoryTool` in `src/mcp/handlers/create*directory*tool.ts`
- [x] Register all four tools in `src/mcp/tools.ts`
- [x] Update `McpToolName` enum in `src/shared/enums.ts` with new tool names
- [x] Write unit tests for all four handlers
- [x] Update `WRITE_TOOLS` constant (Phase 55) to reflect accurate implemented set

---

## Design: `patch_file` in Depth

`patch*file` is the most important tool in this phase and deserves careful design. Unlike `write*file`
which replaces entire file content, `patch_file` applies a targeted replacement — making it:

- **More auditable** — the diff between before/after is small and meaningful
- **Token-efficient** — the model only needs to emit the changed section, not the entire file
- **Safer** — less risk of accidentally clobbering unrelated file content
- **Preferred** by all mature coding agents (Cursor, Claude Code, Copilot Workspace, SWE-agent)

### Patch Strategy: String Replacement

Rather than implementing full unified diff parsing (complex, fragile), the practical approach used
by most production coding agents is **exact string replacement**: the model provides a `search` string
(the exact text to find) and a `replace` string (what to put in its place). This is:

- Simple to implement and test
- Deterministic — fails loudly if the search string isn't found (no silent misapplication)
- What Claude Code and Cursor's edit tool use internally

```text
patch_file args:
  portal: "my-project"
  path: "src/main.ts"
  search: "export function oldName("
  replace: "export function newName("
```

If `search` appears zero times → error (tool fails loudly, model must reconsider).
If `search` appears more than once → error with count (ambiguous; model must make search more specific).
If `search` appears exactly once → replacement applied, result written back.

---

## Implementation Plan

### Task 1: Zod Schemas

**File:** `src/shared/schemas/mcp.ts`

Add after existing tool schemas:

```typescript
export const PatchFileToolArgsSchema = z.object({
  portal: z.string().min(1, "Portal name required"),
  path: z.string().min(1, "File path required"),
  /** Exact string to search for in the file. Must match exactly once. */
  search: z.string().min(1, "Search string required"),
  /** Replacement string. May be empty to delete the matched section. */
  replace: z.string(),
  agent_id: z.string().min(1, "Agent ID required").default("system"),
});

export const DeleteFileToolArgsSchema = z.object({
  portal: z.string().min(1, "Portal name required"),
  path: z.string().min(1, "File path required"),
  agent_id: z.string().min(1, "Agent ID required").default("system"),
});

export const MoveFileToolArgsSchema = z.object({
  portal: z.string().min(1, "Portal name required"),
  from: z.string().min(1, "Source path required"),
  to: z.string().min(1, "Destination path required"),
  agent_id: z.string().min(1, "Agent ID required").default("system"),
});

export const CreateDirectoryToolArgsSchema = z.object({
  portal: z.string().min(1, "Portal name required"),
  path: z.string().min(1, "Directory path required"),
  agent_id: z.string().min(1, "Agent ID required").default("system"),
});
```

Also update `MCPToolArgs` union type to include the four new schemas.

**Success Criteria:**

- [x] All four schemas parse valid args correctly
- [x] TypeScript compilation succeeds

---

### Task 2: `McpToolName` Enum Update

**File:** `src/shared/enums.ts`

```typescript
export enum McpToolName {
  READ*FILE = "read*file",
  WRITE*FILE = "write*file",
  LIST*DIRECTORY = "list*directory",
  SEARCH*FILES = "search*files",
  // New in Phase 56:
  PATCH*FILE = "patch*file",
  DELETE*FILE = "delete*file",
  MOVE*FILE = "move*file",
  CREATE*DIRECTORY = "create*directory",
  // Reserved — not yet implemented (see Future Enhancements):
  // RUN*COMMAND = "run*command",
  // RUN*SCRIPT = "run*script",
  // DELETE*DIRECTORY = "delete*directory",
}
```

**Success Criteria:**

- [x] Enum updated; existing references to `McpToolName` compile without changes

---

### Task 3: `PatchFileTool` Handler

**File:** `src/mcp/handlers/patch*file*tool.ts` (new)

```typescript
interface PatchFileToolArgs {
  portal: string;
  path: string;
  search: string;
  replace: string;
  agent_id: string;
}

// Implements targeted string replacement. Fails if search string is not found exactly once.
```

**Success Criteria:**

- [x] Replaces exactly one occurrence, writes back correctly
- [x] Throws descriptive error on zero matches
- [x] Throws descriptive error on multiple matches with the count
- [x] Logs patch operation with byte delta to Activity Journal
- [x] Path traversal blocked via `resolvePortalPath`

---

### Task 4: `DeleteFileTool` Handler

**File:** `src/mcp/handlers/delete*file*tool.ts` (new)

```typescript
interface DeleteFileToolArgs {
  portal: string;
  path: string;
  agent_id: string;
}

// Implements deletion of a single file from a portal. Refuses to delete directories.
```

**Success Criteria:**

- [x] Deletes regular files successfully
- [x] Throws error if path not found
- [x] Throws error if path is a directory (not a file)
- [x] Logs file size and path to Activity Journal
- [x] Path traversal blocked via `resolvePortalPath`

---

### Task 5: `MoveFileTool` Handler

**File:** `src/mcp/handlers/move*file*tool.ts` (new)

```typescript
interface MoveFileToolArgs {
  portal: string;
  from: string;
  to: string;
  agent_id: string;
}

// Implements moving or renaming a file within a portal. Both paths must be within portal bounds.
```

**Success Criteria:**

- [x] Moves file from source to destination correctly
- [x] Throws error if source not found
- [x] Throws error if source is a directory
- [x] Throws error if destination already exists (no silent overwrites)
- [x] Creates destination parent directories automatically
- [x] Path traversal blocked on both `from` and `to` paths independently
- [x] Logs source, destination, and byte size to Activity Journal

---

### Task 6: `CreateDirectoryTool` Handler

**File:** `src/mcp/handlers/create*directory*tool.ts` (new)

```typescript
interface CreateDirectoryToolArgs {
  portal: string;
  path: string;
  agent_id: string;
}

// Implements idempotent recursive directory creation within a portal.
```

**Success Criteria:**

- [x] Creates single and nested directory paths
- [x] Succeeds silently if directory already exists (idempotent)
- [x] Path traversal blocked via `resolvePortalPath`
- [x] Logs path to Activity Journal

---

### Task 7: Tool Registration

**File:** `src/mcp/tools.ts`

Add the four new handler imports and include them in the exported tools aggregator:

```typescript
// Imports the four new handlers and includes them in the exported createToolHandlers aggregator.
// PatchFileTool, DeleteFileTool, MoveFileTool, CreateDirectoryTool
```

**Success Criteria:**

- [x] All four tools appear in MCP `tools/list` response
- [x] Tool names match `McpToolName` enum values exactly

---

### Task 8: Tests

**File:** `tests/mcp/handlers/patch*file*tool_test.ts` (new)

```typescript
// 4 tests:
// 1. replaces exactly one occurrence
// 2. throws when search string not found
// 3. throws when search string matches multiple times
// 4. supports empty replace string (deletion)
```

**✅ IMPLEMENTED** — `src/mcp/handlers/patch_file_tool.ts`, 4/4 tests passing

**File:** `tests/mcp/handlers/delete*file*tool_test.ts` (new)

```typescript
// 3 tests:
// 1. deletes an existing file
// 2. throws when file not found
// 3. refuses to delete a directory
```

**✅ IMPLEMENTED** — `src/mcp/handlers/delete_file_tool.ts`, 3/3 tests passing

**File:** `tests/mcp/handlers/move*file*tool_test.ts` (new)

```typescript
// 4 tests:
// 1. moves a file to a new path
// 2. throws if destination already exists
// 3. creates destination parent directories
// 4. blocks path traversal on destination
```

**✅ IMPLEMENTED** — `src/mcp/handlers/move_file_tool.ts`, 4/4 tests passing

**File:** `tests/mcp/handlers/create*directory*tool_test.ts` (new)

```typescript
// 4 tests:
// 1. creates a single directory
// 2. creates nested directories recursively
// 3. is idempotent — succeeds if directory already exists
// 4. blocks path traversal
```

**✅ IMPLEMENTED** — `src/mcp/handlers/create_directory_tool.ts`, 5/5 tests passing

**Test Summary:**

| Test File | Cases |
| ---------------------------------------------- | ----- |
| `patch*file*tool_test.ts` | 4 |
| `delete*file*tool_test.ts` | 3 |
| `move*file*tool_test.ts` | 4 |
| `create*directory*tool_test.ts` | 4 |
| **Total new tests** | **15** |

**Success Criteria:**

- [x] All 15 tests pass
- [x] All existing MCP handler tests continue to pass (no regressions)

***

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
| ------------------------------------------------ | -------- | ---------- | -------------------------------------------------------------------- |
| **R1:** `patch_file` silently succeeds on wrong location | High | Medium | Exact-match-once invariant: zero or multiple matches both throw |
| **R2:** `delete*file` used without prior `git*commit` | High | Medium | Tool description explicitly states "recoverable from git history"; agents instructed to commit after delete |
| **R3:** `move_file` destination silently overwrites | High | Low | Pre-existence check throws before any rename is executed |
| **R4:** `create_directory` used outside portal bounds | Low | Low | `resolvePortalPath` enforces portal bounds; traversal throws |
| **R5:** `delete*directory` requested via `delete*file` | Low | Medium | Handler checks `stat.isFile` and throws descriptive error with guidance |

***

## Update: `WRITE_TOOLS` Constant (Phase 55 Alignment)

Phase 55 proposed `WRITE_TOOLS` to classify tools for dynamic step permission enforcement.
Update the constant to reflect the accurate implemented set after this phase:

**File:** `src/shared/constants.ts`

```typescript
/**
 * Write MCP tools — require declared execution_mode and human plan approval.
 * Cannot be listed in permitted_tools for a dynamic flow step.
 * Updated in Phase 56 to reflect all implemented write handlers.
 */
export const WRITE_TOOLS: ReadonlySet<McpToolName> = new Set([
  McpToolName.WRITE_FILE,
  McpToolName.PATCH_FILE,        // Phase 56
  McpToolName.DELETE_FILE,       // Phase 56
  McpToolName.MOVE_FILE,         // Phase 56
  McpToolName.CREATE_DIRECTORY,  // Phase 56 — low-risk but state-altering
  McpToolName.GIT*CREATE*BRANCH,
  McpToolName.GIT_COMMIT,
]);

/**
 * Read-only MCP tools — safe for dynamic step execution.
 * Unchanged from Phase 55.
 */
export const READ*ONLY*TOOLS: ReadonlySet<McpToolName> = new Set([
  McpToolName.READ_FILE,
  McpToolName.LIST_DIRECTORY,
  McpToolName.SEARCH_FILES,
  McpToolName.GIT_STATUS,
]);
```

***

## Future Enhancements

> The following tools are explicitly **not implemented in this phase**. They are documented here
> to preserve design intent for future consideration.

### `run*command` / `run*script`

**Capability:** Execute shell commands or named scripts within a portal working directory.

**Why deferred:** `run_command` is the most powerful tool available to a coding agent — it enables
build verification, test execution, linting, and package installation. It is also the highest-risk
tool: an unrestricted shell invocation can exfiltrate data, corrupt state outside the portal, or
trigger irreversible side effects that extend beyond the filesystem.

**Design tensions to resolve before implementation:**

- **Allowlist vs. arbitrary** — should the tool accept arbitrary command strings (`run_command: "npm install"`)
  or only named scripts declared per portal in config (`run_script: "test"` → maps to `deno test`)?
  `run_script` with a per-portal named-script registry is significantly safer and the recommended
  starting point.
- **Sandboxing** — Deno's permission system (`--allow-run`) provides containment at the process level
  but a subprocess can still spawn child processes or make network calls unless further restricted.
- **Output capture** — stdout/stderr must be captured and returned as the tool result; long-running
  commands require timeout enforcement and streaming or truncation of large outputs.
- **Portal scope enforcement** — the working directory must be locked to the portal path; commands
  that attempt to `cd` outside it must be blocked or flagged.
- **New permission type** — both tools would require `PortalOperation.EXECUTE`, a new enum value
  distinct from `PortalOperation.WRITE`, allowing portals to grant execution rights independently.

**Recommended implementation sequence when the time comes:**

1. Add `PortalOperation.EXECUTE` to the `PortalOperation` enum
### `delete_directory`

**Capability:** Recursively remove a directory and all its contents from a portal.

**Why deferred:** Recursive deletion is irreversible at the filesystem level with a risk surface
proportional to the directory tree size. A single path construction error can delete a significant
portion of a portal codebase.

**Design considerations before implementation:**

- Require explicit `recursive: true` parameter — no default — to make destructive intent unambiguous in the plan step
- Consider requiring the directory to be non-empty only when `recursive: true` is set (empty directories allowed unconditionally)
- The portal should ideally have an active git tracking state (at least one committed file in the target directory) so deletion is recoverable from history
- May benefit from a gate step in the review workflow before execution is permitted

***

## Success Criteria

### Functional Requirements

- [x] `patch_file` applies exact single-occurrence string replacements; fails loudly on zero or multiple matches
- [x] `delete_file` removes regular files only; refuses directories with descriptive error
- [x] `move_file` renames/moves files within portal bounds; refuses to overwrite existing destination
- [x] `create_directory` creates directory trees idempotently within portal bounds
- [x] All four tools enforce `PortalOperation.WRITE` permission check
- [x] All four tools log to Activity Journal via `logToolExecution`
- [x] All four tools block path traversal via `resolvePortalPath`

### Quality Requirements

- [x] TypeScript compilation: zero errors
- [x] All 15 new tests pass
- [x] All existing MCP handler tests pass (no regressions)
- [x] All four tools appear in MCP `tools/list` response with correct names
- [x] `McpToolName` enum contains all four new names
- [x] `WRITE_TOOLS` constant in `src/shared/constants.ts` updated to include all four new tools

***

## Implementation Timeline

| Task | Description | Duration |
| ------------ | --------------------------------------- | -------- |
| **Task 1** | Zod schemas in `src/shared/schemas/mcp.ts` | 0.5 days |
| **Task 2** | `McpToolName` enum update | 0.5 days |
| **Task 3** | `PatchFileTool` handler | 1 day |
| **Task 4** | `DeleteFileTool` handler | 0.5 days |
| **Task 5** | `MoveFileTool` handler | 0.5 days |
| **Task 6** | `CreateDirectoryTool` handler | 0.5 days |
| **Task 7** | Tool registration in `src/mcp/tools.ts` | 0.5 days |
| **Task 8** | Tests (15 cases across 4 files) | 1 day |

**Estimated Total:** 5 days

***

## Related Work

- **Phase 55:** Hybrid Dynamic Tool Selection — defines `WRITE*TOOLS` / `READ*ONLY*TOOLS` constants and `permitted*tools` step enforcement; updated by this phase to reflect accurate tool inventory
- **Phase 53:** Identity rename — `agent_id` field naming conventions used by all tool handlers remain unchanged per Phase 53 decision

***

## References

- [`src/mcp/tool*handler.ts`](../../src/mcp/tool*handler.ts) — base class with `validatePermission`, `resolvePortalPath`, `formatSuccess`, `logToolExecution`
- [`src/mcp/handlers/write*file*tool.ts`](../../src/mcp/handlers/write*file*tool.ts) — canonical reference pattern for write tool handlers
- [`src/shared/schemas/mcp.ts`](../../src/shared/schemas/mcp.ts) — Zod schemas for all tool args
- [`src/shared/enums.ts`](../../src/shared/enums.ts) — `McpToolName`, `PortalOperation`
- [`src/shared/constants.ts`](../../src/shared/constants.ts) — `WRITE*TOOLS`, `READ*ONLY_TOOLS`
