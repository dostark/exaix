---
agent: claude
scope: dev
title: "Phase 57: New MCP Tool Handlers — File and Directory Operations"
short*summary: "Implement patch*file, delete*file, move*file, and create_directory MCP tool handlers to close critical gaps in Exaix's file operation toolset, enabling agents to perform refactoring, targeted edits, and directory management within portals."
version: "1.0"
topics: ["mcp", "tools", "file-operations", "handlers", "schemas", "security", "portal"]
---

> [!NOTE]
> **Status: ✅ Complete**
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
| `create_directory` | `create_directory` | P1 | Write (safe) |
| `run_command` | `run_command` | P0 | Write (unsafe/exec) |
| `search_files` | `search_files` | P0 | Read (search) |

> **Not in this phase:** `delete_directory`, `run_script`.
> `delete_directory` is deferred — recursive deletion is too destructive for the current
> supervised model without additional confirmation gates.

---

## Goals

- [x] Add Zod schemas for all six new tools to `src/shared/schemas/mcp.ts`
- [x] Implement `PatchFileTool` in `src/mcp/handlers/patch_file_tool.ts`
- [x] Implement `DeleteFileTool` in `src/mcp/handlers/delete_file_tool.ts`
- [x] Implement `MoveFileTool` in `src/mcp/handlers/move_file_tool.ts`
- [x] Implement `CreateDirectoryTool` in `src/mcp/handlers/create_directory_tool.ts`
- [x] Implement `RunCommandTool` in `src/mcp/handlers/run_command_tool.ts`
- [x] Implement `SearchFilesTool` in `src/mcp/handlers/search_files_tool.ts`
- [x] Register all six tools in `src/mcp/server.ts`
- [x] Update `McpToolName` enum in `src/shared/enums.ts` with new tool names
- [x] Write unit tests for all six handlers
- [x] Update `READ_ONLY_TOOLS` and `WRITE_TOOLS` constants (Phase 55/56) to reflect accurate implemented set

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
  identity_id: z.string().min(1, "Identity ID required").default("system"),
});

export const RunCommandToolArgsSchema = z.object({
  portal: z.string().min(1, "Portal name required"),
  command: z.string().min(1, "Command required"),
  args: z.array(z.string()).optional(),
  identity_id: z.string().min(1, "Identity ID required").default("system"),
});

export const SearchFilesToolArgsSchema = z.object({
  portal: z.string().min(1, "Portal name required"),
  pattern: z.string().min(1, "Pattern required"),
  path: z.string().optional().default(""),
  identity_id: z.string().min(1, "Identity ID required").default("system"),
});
```

Also update `MCPToolArgs` union type to include the four new schemas.

**Success Criteria:**

- [x] All six schemas parse valid args correctly
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
  PATCH_FILE = "patch_file",
  DELETE_FILE = "delete_file",
  MOVE_FILE = "move_file",
  CREATE_DIRECTORY = "create_directory",
  RUN_COMMAND = "run_command",
  SEARCH_FILES = "search_files",
  // Reserved — not yet implemented (see Future Enhancements):
  // RUN_SCRIPT = "run_script",
  // DELETE_DIRECTORY = "delete_directory",
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

// Task 7: `RunCommandTool` Handler

**File:** `src/mcp/handlers/run_command_tool.ts` (new)

```typescript
interface RunCommandToolArgs {
  portal: string;
  command: string;
  args?: string[];
  identity_id: string;
}

// Implements execution of whitelisted shell commands within a portal context.
// Delegates to ToolRegistry for command whitelisting and security enforcement.
```

**Success Criteria:**

- [x] Executes whitelisted commands successfully
- [x] Blocks commands not in the allowlist
- [x] Enforces portal context via REALPATH and process CWD
- [x] Logs command, args, and output to Activity Journal
- [x] Enforces `PortalOperation.GIT` (as proxy for execution rights)

---

### Task 8: `SearchFilesTool` Handler

**File:** `src/mcp/handlers/search_files_tool.ts` (new)

```typescript
interface SearchFilesToolArgs {
  portal: string;
  pattern: string;
  path?: string;
  identity_id: string;
}

// Implements glob-based file searching within a portal.
// Delegates to ToolRegistry.search_files for performance and glob consistency.
```

**Success Criteria:**

- [x] Finds files matching standard glob patterns (e.g., `**/*.ts`)
- [x] Respects optional `path` prefix for targeted searches
- [x] Returns portal-relative paths for client consistency
- [x] Enforces `PortalOperation.READ` permission
- [x] Blocks traversal via `resolvePortalPath`

---

### Task 9: Tool Registration

**File:** `src/mcp/server.ts`

Handlers are registered directly in the `MCPServer` constructor:

```typescript
    this.registerTool(new RunCommandTool(this.context));
    this.registerTool(new SearchFilesTool(this.context));
```

**Success Criteria:**

- [x] All four tools appear in MCP `tools/list` response
- [x] Tool names match `McpToolName` enum values exactly

---

**Task 10: Tests**

**File:** `tests/mcp/handlers/run_command_tool_test.ts` (new)
**✅ IMPLEMENTED** — Part of `tests/mcp/tools_test.ts` and `tests/mcp/server_test.ts` integration.

**File:** `tests/mcp/handlers/search_files_tool_test.ts` (new)
**✅ IMPLEMENTED** — Part of `tests/mcp/tools_test.ts` and `tests/mcp/server_test.ts` integration.

**Test Summary:**

| Test File | Cases |
| ---------------------------------------------- | ----- |
| `patch_file_tool_test.ts` | 4 |
| `delete_file_tool_test.ts` | 3 |
| `move_file_tool_test.ts` | 4 |
| `create_directory_tool_test.ts` | 5 |
| `tools_test.ts` (run_command/search_files) | 4 |
| **Total new tests** | **20** |

**Success Criteria:**

- [x] All 20 tests pass
- [x] All existing MCP handler tests continue to pass (no regressions)
- [x] Tool count verified as 16 (12 core + 4 domain)

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

### `run_script`

**Capability:** Execute named scripts defined in `exa.config.toml` or portal-specific metadata.

**Why deferred:** While `run_command` handles generic whitelisted CLI tools, `run_script` is intended to provide a cleaner abstraction for "test", "build", "lint" across different environments (Deno, Node, Rust). This requires a new configuration schema for mapping abstract scripts to concrete commands.

**Recommended implementation sequence when the time comes:**

1. Define `scripts` section in `PortalConfig` schema.
2. Implement `RunScriptTool` handler.
3. Update `LlmClient` to prefer `run_script` for lifecycle operations.
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
- [x] `patch_file` applies exact single-occurrence string replacements; fails loudly on zero or multiple matches
- [x] `delete_file` removes regular files only; refuses directories with descriptive error
- [x] `move_file` renames/moves files within portal bounds; refuses to overwrite existing destination
- [x] `create_directory` creates directory trees idempotently within portal bounds
- [x] `run_command` executes whitelisted commands in portal context
- [x] `search_files` provides performant glob-based discovery
- [x] All six tools enforce appropriate permissions (`WRITE` or `GIT` for mutations, `READ` for search)
- [x] All six tools log to Activity Journal via `logToolExecution`
- [x] All six tools block path traversal via `resolvePortalPath`

### Quality Requirements

- [x] TypeScript compilation: zero errors
- [x] All 20 new tests pass
- [x] All existing MCP handler tests pass (no regressions)
- [x] All six tools appear in MCP `tools/list` response with correct names
- [x] `McpToolName` enum contains all six new names
- [x] `READ_ONLY_TOOLS` and `WRITE_TOOLS` constants updated

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
| **Task 7** | `RunCommandTool` handler | 0.5 days |
| **Task 8** | `SearchFilesTool` handler | 0.5 days |
| **Task 9** | Tool registration in `src/mcp/server.ts` | 0.5 days |
| **Task 10** | Tests (20 cases) | 1 day |

**Estimated Total:** 6 days

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
