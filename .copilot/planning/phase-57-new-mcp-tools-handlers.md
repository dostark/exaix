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

- [ ] Add Zod schemas for all four new tools to `src/shared/schemas/mcp.ts`
- [ ] Implement `PatchFileTool` in `src/mcp/handlers/patch*file*tool.ts`
- [ ] Implement `DeleteFileTool` in `src/mcp/handlers/delete*file*tool.ts`
- [ ] Implement `MoveFileTool` in `src/mcp/handlers/move*file*tool.ts`
- [ ] Implement `CreateDirectoryTool` in `src/mcp/handlers/create*directory*tool.ts`
- [ ] Register all four tools in `src/mcp/tools.ts`
- [ ] Update `McpToolName` enum in `src/shared/enums.ts` with new tool names
- [ ] Write unit tests for all four handlers
- [ ] Update `WRITE_TOOLS` constant (Phase 55) to reflect accurate implemented set

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
```text

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
```text

Also update `MCPToolArgs` union type to include the four new schemas.

**Success Criteria:**

- [ ] All four schemas parse valid args correctly
- [ ] TypeScript compilation succeeds

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
```text

**Success Criteria:**

- [ ] Enum updated; existing references to `McpToolName` compile without changes

---

### Task 3: `PatchFileTool` Handler

**File:** `src/mcp/handlers/patch*file*tool.ts` (new)

```typescript
/**
 * @module PatchFileTool
 * @path src/mcp/handlers/patch*file*tool.ts
 * @description MCP tool handler for applying targeted string replacements to portal files.
 * Preferred over write_file for code edits — produces minimal, auditable changes.
 * @architectural-layer MCP
 * @dependencies [ToolHandler, PatchFileToolArgsSchema, Path, FS]
 * @related-files [src/mcp/tool*handler.ts, src/mcp/handlers/write*file_tool.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { type MCPToolResponse, PatchFileToolArgsSchema } from "../../shared/schemas/mcp.ts";
import { PortalOperation } from "../../shared/enums.ts";
import type { JSONValue } from "../../shared/types/json.ts";

/**
 * PatchFileTool — applies an exact string replacement within a portal file.
 *
 * Security:
 * - Validates portal exists
 * - Prevents path traversal
 * - Requires PortalOperation.WRITE permission
 * - Fails loudly if search string not found or is ambiguous (multiple matches)
 * - Logs all patch operations to Activity Journal
 */
export class PatchFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const { portal, path, search, replace, agent_id } =
      PatchFileToolArgsSchema.parse(args);

    this.validatePermission(portal, agent_id, PortalOperation.WRITE);

    const portalPath = this.validatePortalExists(portal);
    const absolutePath = this.resolvePortalPath(portalPath, path);

    // Read existing content
    let content: string;
    try {
      content = await Deno.readTextFile(absolutePath);
    } catch {
      throw new Error(`File not found: ${path}`);
    }

    // Count occurrences — must be exactly one
    const occurrences = content.split(search).length - 1;

    if (occurrences === 0) {
      throw new Error(
        `patch_file: search string not found in "${path}". ` +
        `Verify the exact text exists in the file (whitespace and indentation must match).`,
      );
    }

    if (occurrences > 1) {
      throw new Error(
        `patch_file: search string found ${occurrences} times in "${path}". ` +
        `Make the search string more specific to match exactly one location.`,
      );
    }

    // Apply replacement
    const patched = content.replace(search, replace);
    await Deno.writeTextFile(absolutePath, patched);

    return this.formatSuccess("patch_file", portal, {
      path,
      search_length: search.length,
      replace_length: replace.length,
      bytes_before: content.length,
      bytes_after: patched.length,
      agent*id: agent*id ?? null,
      success: true,
    });
  }

  getToolDefinition() {
    return {
      name: "patch_file",
      description:
        "Apply a targeted string replacement to a file in a portal. " +
        "Preferred over write_file for code edits — only the changed section is specified. " +
        "The search string must match exactly once; fails if not found or ambiguous.",
      inputSchema: {
        type: "object",
        properties: {
          portal: {
            type: "string",
            description: "Portal alias to operate on",
          },
          path: {
            type: "string",
            description: "File path relative to portal root",
          },
          search: {
            type: "string",
            description:
              "Exact string to find in the file (including whitespace/indentation). " +
              "Must match exactly once.",
          },
          replace: {
            type: "string",
            description:
              "Replacement string. Use empty string to delete the matched section.",
          },
          agent_id: {
            type: "string",
            description: "Identity identifier for permission checks",
          },
        },
        required: ["portal", "path", "search", "replace", "agent_id"],
      },
    };
  }
}
```text

**Success Criteria:**

- [ ] Replaces exactly one occurrence, writes back correctly
- [ ] Throws descriptive error on zero matches
- [ ] Throws descriptive error on multiple matches with the count
- [ ] Logs patch operation with byte delta to Activity Journal
- [ ] Path traversal blocked via `resolvePortalPath`

---

### Task 4: `DeleteFileTool` Handler

**File:** `src/mcp/handlers/delete*file*tool.ts` (new)

```typescript
/**
 * @module DeleteFileTool
 * @path src/mcp/handlers/delete*file*tool.ts
 * @description MCP tool handler for deleting a single file from a portal.
 * Destructive and irreversible at the filesystem level — git history preserves deleted files.
 * @architectural-layer MCP
 * @dependencies [ToolHandler, DeleteFileToolArgsSchema]
 * @related-files [src/mcp/tool_handler.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { DeleteFileToolArgsSchema, type MCPToolResponse } from "../../shared/schemas/mcp.ts";
import { PortalOperation } from "../../shared/enums.ts";
import type { JSONValue } from "../../shared/types/json.ts";

/**
 * DeleteFileTool — removes a single file from a portal.
 *
 * Security:
 * - Validates portal exists
 * - Prevents path traversal
 * - Requires PortalOperation.WRITE permission
 * - Only removes regular files — refuses directories (use delete_directory when implemented)
 * - Logs deletion to Activity Journal
 *
 * Note: File is deleted at the filesystem level. If the portal is a git repository,
 * the deletion is recoverable via git history after a subsequent git_commit.
 * Agents should follow delete*file with git*commit to register the deletion.
 */
export class DeleteFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const { portal, path, agent_id } = DeleteFileToolArgsSchema.parse(args);

    this.validatePermission(portal, agent_id, PortalOperation.WRITE);

    const portalPath = this.validatePortalExists(portal);
    const absolutePath = this.resolvePortalPath(portalPath, path);

    // Verify target exists and is a regular file (not a directory)
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(absolutePath);
    } catch {
      throw new Error(`File not found: ${path}`);
    }

    if (!stat.isFile) {
      throw new Error(
        `"${path}" is a directory, not a file. ` +
        `Use delete_directory to remove directories (when available).`,
      );
    }

    await Deno.remove(absolutePath);

    return this.formatSuccess("delete_file", portal, {
      path,
      bytes_deleted: stat.size,
      agent*id: agent*id ?? null,
      success: true,
    });
  }

  getToolDefinition() {
    return {
      name: "delete_file",
      description:
        "Delete a single file from a portal. " +
        "Irreversible at the filesystem level, but recoverable from git history " +
        "if the portal is a git repository. " +
        "Does not accept directory paths — only regular files.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal alias" },
          path: { type: "string", description: "File path relative to portal root" },
          agent_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "path", "agent_id"],
      },
    };
  }
}
```text

**Success Criteria:**

- [ ] Deletes regular files successfully


***

```markdown

- [ ] Deletes regular files successfully
- [ ] Throws error if path not found
- [ ] Throws error if path is a directory (not a file)
- [ ] Logs file size and path to Activity Journal
- [ ] Path traversal blocked via `resolvePortalPath`

---

### Task 5: `MoveFileTool` Handler

**File:** `src/mcp/handlers/move*file*tool.ts` (new)

```typescript
/**
 * @module MoveFileTool
 * @path src/mcp/handlers/move*file*tool.ts
 * @description MCP tool handler for moving or renaming a file within a portal.
 * Used for rename/restructure tasks. Both source and destination must be within portal bounds.
 * @architectural-layer MCP
 * @dependencies [ToolHandler, MoveFileToolArgsSchema, Path, FS]
 * @related-files [src/mcp/tool_handler.ts]
 */
import { dirname } from "@std/path";
import { ToolHandler } from "../tool_handler.ts";
import { MoveFileToolArgsSchema, type MCPToolResponse } from "../../shared/schemas/mcp.ts";
import { PortalOperation } from "../../shared/enums.ts";
import type { JSONValue } from "../../shared/types/json.ts";

/**
 * MoveFileTool — moves or renames a file within a portal.
 *
 * Security:
 * - Validates portal exists
 * - Prevents path traversal on BOTH source and destination
 * - Both paths must stay within portal bounds
 * - Requires PortalOperation.WRITE permission
 * - Only moves regular files — refuses directories
 * - Creates destination parent directories if needed
 * - Logs move to Activity Journal
 *
 * Note: This is a filesystem rename. In git repositories, agents should follow
 * move*file with git*commit so git tracks it as a rename (preserving history).
 */
export class MoveFileTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const { portal, from, to, agent_id } = MoveFileToolArgsSchema.parse(args);

    this.validatePermission(portal, agent_id, PortalOperation.WRITE);

    const portalPath = this.validatePortalExists(portal);

    // Validate both paths independently
    const absoluteFrom = this.resolvePortalPath(portalPath, from);
    const absoluteTo = this.resolvePortalPath(portalPath, to);

    // Verify source exists and is a regular file
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(absoluteFrom);
    } catch {
      throw new Error(`Source file not found: ${from}`);
    }

    if (!stat.isFile) {
      throw new Error(
        `"${from}" is a directory, not a file. MoveFileTool only moves regular files.`,
      );
    }

    // Check destination doesn't already exist (prevent silent overwrites)
    try {
      await Deno.stat(absoluteTo);
      throw new Error(
        `Destination already exists: "${to}". ` +
        `Delete it first or choose a different destination path.`,
      );
    } catch (err) {
      // Only re-throw if it's our "already exists" error, not the "not found" error
      if (err instanceof Error && err.message.startsWith("Destination already exists")) {
        throw err;
      }
      // Not found — safe to proceed
    }

    // Create destination parent directories if needed
    await Deno.mkdir(dirname(absoluteTo), { recursive: true });

    // Perform the move
    await Deno.rename(absoluteFrom, absoluteTo);

    return this.formatSuccess("move_file", portal, {
      from,
      to,
      bytes: stat.size,
      agent*id: agent*id ?? null,
      success: true,
    });
  }

  getToolDefinition() {
    return {
      name: "move_file",
      description:
        "Move or rename a file within a portal. " +
        "Both source and destination must be within the portal bounds. " +
        "Destination must not already exist. " +
        "In git portals, follow with git_commit to register the rename in history.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal alias" },
          from: { type: "string", description: "Source file path relative to portal root" },
          to: { type: "string", description: "Destination file path relative to portal root" },
          agent_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "from", "to", "agent_id"],
      },
    };
  }
}
```text

**Success Criteria:**

- [ ] Moves file from source to destination correctly
- [ ] Throws error if source not found
- [ ] Throws error if source is a directory
- [ ] Throws error if destination already exists (no silent overwrites)
- [ ] Creates destination parent directories automatically
- [ ] Path traversal blocked on both `from` and `to` paths independently
- [ ] Logs source, destination, and byte size to Activity Journal

---

### Task 6: `CreateDirectoryTool` Handler

**File:** `src/mcp/handlers/create*directory*tool.ts` (new)

```typescript
/**
 * @module CreateDirectoryTool
 * @path src/mcp/handlers/create*directory*tool.ts
 * @description MCP tool handler for creating a directory tree within a portal.
 * Low-risk altering operation — creates parent directories recursively.
 * @architectural-layer MCP
 * @dependencies [ToolHandler, CreateDirectoryToolArgsSchema]
 * @related-files [src/mcp/tool_handler.ts]
 */
import { ToolHandler } from "../tool_handler.ts";
import { CreateDirectoryToolArgsSchema, type MCPToolResponse } from "../../shared/schemas/mcp.ts";
import { PortalOperation } from "../../shared/enums.ts";
import type { JSONValue } from "../../shared/types/json.ts";

/**
 * CreateDirectoryTool — creates a directory (and all parent directories) within a portal.
 *
 * Security:
 * - Validates portal exists
 * - Prevents path traversal
 * - Requires PortalOperation.WRITE permission
 * - Idempotent: succeeds silently if directory already exists
 * - Logs to Activity Journal
 */
export class CreateDirectoryTool extends ToolHandler {
  async execute(args: Record<string, JSONValue>): Promise<MCPToolResponse> {
    const { portal, path, agent_id } = CreateDirectoryToolArgsSchema.parse(args);

    this.validatePermission(portal, agent_id, PortalOperation.WRITE);

    const portalPath = this.validatePortalExists(portal);
    const absolutePath = this.resolvePortalPath(portalPath, path);

    await Deno.mkdir(absolutePath, { recursive: true });

    return this.formatSuccess("create_directory", portal, {
      path,
      agent*id: agent*id ?? null,
      success: true,
    });
  }

  getToolDefinition() {
    return {
      name: "create_directory",
      description:
        "Create a directory (and all required parent directories) within a portal. " +
        "Idempotent — succeeds silently if the directory already exists.",
      inputSchema: {
        type: "object",
        properties: {
          portal: { type: "string", description: "Portal alias" },
          path: { type: "string", description: "Directory path relative to portal root" },
          agent_id: { type: "string", description: "Identity identifier for permission checks" },
        },
        required: ["portal", "path", "agent_id"],
      },
    };
  }
}
```text

**Success Criteria:**

- [ ] Creates single and nested directory paths
- [ ] Succeeds silently if directory already exists (idempotent)
- [ ] Path traversal blocked via `resolvePortalPath`
- [ ] Logs path to Activity Journal

---

### Task 7: Tool Registration

**File:** `src/mcp/tools.ts`

Add the four new handler imports and include them in the exported tools aggregator:

```typescript
// Existing imports
import { ReadFileTool } from "./handlers/read*file*tool.ts";
import { WriteFileTool } from "./handlers/write*file*tool.ts";
import { ListDirectoryTool } from "./handlers/list*directory*tool.ts";
import { GitCreateBranchTool } from "./handlers/git*create*branch_tool.ts";
import { GitCommitTool } from "./handlers/git*commit*tool.ts";
import { GitStatusTool } from "./handlers/git*status*tool.ts";

// New in Phase 56:
import { PatchFileTool } from "./handlers/patch*file*tool.ts";
import { DeleteFileTool } from "./handlers/delete*file*tool.ts";
import { MoveFileTool } from "./handlers/move*file*tool.ts";
import { CreateDirectoryTool } from "./handlers/create*directory*tool.ts";

export function createToolHandlers(
  context: ICliApplicationContext,
  permissions?: PortalPermissionsService,
) {
  return [
    new ReadFileTool(context, permissions),
    new WriteFileTool(context, permissions),
    new ListDirectoryTool(context, permissions),
    new GitCreateBranchTool(context, permissions),
    new GitCommitTool(context, permissions),
    new GitStatusTool(context, permissions),
    // Phase 56:
    new PatchFileTool(context, permissions),
    new DeleteFileTool(context, permissions),
    new MoveFileTool(context, permissions),
    new CreateDirectoryTool(context, permissions),
  ];
}
```text

**Success Criteria:**

- [ ] All four tools appear in MCP `tools/list` response
- [ ] Tool names match `McpToolName` enum values exactly

---

### Task 8: Tests

**File:** `tests/mcp/handlers/patch*file*tool_test.ts` (new)

```typescript
it("replaces exactly one occurrence", async () => {
  const { tool, portalPath } = await setupToolTest();
  await writeTestFile(portalPath, "src/main.ts", "function foo() {\n  return 1;\n}\n");

  const result = await tool.execute({
    portal: TEST_PORTAL,
    path: "src/main.ts",
    search: "function foo()",
    replace: "function bar()",
    agent_id: "test-identity",
  });

  const content = await Deno.readTextFile(join(portalPath, "src/main.ts"));
  expect(content).toContain("function bar()");
  expect(content).not.toContain("function foo()");
  expect(result.content.text).toContain("success");
});

it("throws when search string not found", async () => {
  const { tool, portalPath } = await setupToolTest();
  await writeTestFile(portalPath, "src/main.ts", "function foo() {}");

  await expect(
    tool.execute({
      portal: TEST_PORTAL,
      path: "src/main.ts",
      search: "function notHere()",
      replace: "function bar()",
      agent_id: "test-identity",
    }),
  ).rejects.toThrow("search string not found");
});

it("throws when search string matches multiple times", async () => {
  const { tool, portalPath } = await setupToolTest();
  await writeTestFile(portalPath, "src/main.ts", "foo()\nfoo()\n");

  await expect(
    tool.execute({
      portal: TEST_PORTAL,
      path: "src/main.ts",
      search: "foo()",
      replace: "bar()",
      agent_id: "test-identity",
    }),
  ).rejects.toThrow("found 2 times");
});

it("supports empty replace string (deletion)", async () => {
  const { tool, portalPath } = await setupToolTest();
  await writeTestFile(portalPath, "src/main.ts", "// TODO: remove this\nconst x = 1;\n");

  await tool.execute({
    portal: TEST_PORTAL,
    path: "src/main.ts",
    search: "// TODO: remove this\n",
    replace: "",
    agent_id: "test-identity",
  });

  const content = await Deno.readTextFile(join(portalPath, "src/main.ts"));
  expect(content).toBe("const x = 1;\n");
});
```text

**File:** `tests/mcp/handlers/delete*file*tool_test.ts` (new)

```typescript
it("deletes an existing file", async () => {
  const { tool, portalPath } = await setupToolTest();
  await writeTestFile(portalPath, "src/old.ts", "// old content");

  await tool.execute({ portal: TEST*PORTAL, path: "src/old.ts", agent*id: "test-identity" });

  await expect(Deno.stat(join(portalPath, "src/old.ts"))).rejects.toThrow();
});

it("throws when file not found", async () => {
  const { tool } = await setupToolTest();
  await expect(
    tool.execute({ portal: TEST*PORTAL, path: "src/ghost.ts", agent*id: "test-identity" }),
  ).rejects.toThrow("File not found");
});

it("refuses to delete a directory", async () => {
  const { tool, portalPath } = await setupToolTest();
  await Deno.mkdir(join(portalPath, "src/somedir"), { recursive: true });

  await expect(
    tool.execute({ portal: TEST*PORTAL, path: "src/somedir", agent*id: "test-identity" }),
  ).rejects.toThrow("is a directory");
});
```text

**File:** `tests/mcp/handlers/move*file*tool_test.ts` (new)

```typescript
it("moves a file to a new path", async () => {
  const { tool, portalPath } = await setupToolTest();
  await writeTestFile(portalPath, "src/old.ts", "const x = 1;");

  await tool.execute({
    portal: TEST*PORTAL, from: "src/old.ts", to: "src/new.ts", agent*id: "test-identity",
  });

  await expect(Deno.stat(join(portalPath, "src/old.ts"))).rejects.toThrow();
  const content = await Deno.readTextFile(join(portalPath, "src/new.ts"));
  expect(content).toBe("const x = 1;");
});

it("throws if destination already exists", async () => {
  const { tool, portalPath } = await setupToolTest();
  await writeTestFile(portalPath, "src/a.ts", "a");
  await writeTestFile(portalPath, "src/b.ts", "b");

  await expect(
    tool.execute({
      portal: TEST*PORTAL, from: "src/a.ts", to: "src/b.ts", agent*id: "test-identity",
    }),
  ).rejects.toThrow("Destination already exists");
});

it("creates destination parent directories", async () => {
  const { tool, portalPath } = await setupToolTest();
  await writeTestFile(portalPath, "src/a.ts", "a");

  await tool.execute({
    portal:

  it("creates destination parent directories", async () => {
  const { tool, portalPath } = await setupToolTest();
  await writeTestFile(portalPath, "src/a.ts", "a");

  await tool.execute({
    portal: TEST_PORTAL,
    from: "src/a.ts",
    to: "src/subdir/nested/a.ts",
    agent_id: "test-identity",
  });

  const content = await Deno.readTextFile(join(portalPath, "src/subdir/nested/a.ts"));
  expect(content).toBe("a");
});

it("blocks path traversal on destination", async () => {
  const { tool, portalPath } = await setupToolTest();
  await writeTestFile(portalPath, "src/a.ts", "a");

  await expect(
    tool.execute({
      portal: TEST_PORTAL,
      from: "src/a.ts",
      to: "../../outside.ts",
      agent_id: "test-identity",
    }),
  ).rejects.toThrow();
});
```text

**File:** `tests/mcp/handlers/create*directory*tool_test.ts` (new)

```typescript
it("creates a single directory", async () => {
  const { tool, portalPath } = await setupToolTest();

  await tool.execute({ portal: TEST*PORTAL, path: "src/newdir", agent*id: "test-identity" });

  const stat = await Deno.stat(join(portalPath, "src/newdir"));
  expect(stat.isDirectory).toBe(true);
});

it("creates nested directories recursively", async () => {
  const { tool, portalPath } = await setupToolTest();

  await tool.execute({ portal: TEST*PORTAL, path: "src/a/b/c", agent*id: "test-identity" });

  const stat = await Deno.stat(join(portalPath, "src/a/b/c"));
  expect(stat.isDirectory).toBe(true);
});

it("is idempotent — succeeds if directory already exists", async () => {
  const { tool, portalPath } = await setupToolTest();
  await Deno.mkdir(join(portalPath, "src/existing"), { recursive: true });

  await expect(
    tool.execute({ portal: TEST*PORTAL, path: "src/existing", agent*id: "test-identity" }),
  ).resolves.toBeDefined();
});

it("blocks path traversal", async () => {
  const { tool } = await setupToolTest();

  await expect(
    tool.execute({ portal: TEST*PORTAL, path: "../../outside", agent*id: "test-identity" }),
  ).rejects.toThrow();
});
```text

**Test Summary:**

| Test File | Cases |
| ---------------------------------------------- | ----- |
| `patch*file*tool_test.ts` | 4 |
| `delete*file*tool_test.ts` | 3 |
| `move*file*tool_test.ts` | 4 |
| `create*directory*tool_test.ts` | 4 |
| **Total new tests** | **15** |

**Success Criteria:**

- [ ] All 15 tests pass
- [ ] All existing MCP handler tests continue to pass (no regressions)

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
```text

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
1.
1.
1.

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

- [ ] `patch_file` applies exact single-occurrence string replacements; fails loudly on zero or multiple matches
- [ ] `delete_file` removes regular files only; refuses directories with descriptive error
- [ ] `move_file` renames/moves files within portal bounds; refuses to overwrite existing destination
- [ ] `create_directory` creates directory trees idempotently within portal bounds
- [ ] All four tools enforce `PortalOperation.WRITE` permission check
- [ ] All four tools log to Activity Journal via `logToolExecution`
- [ ] All four tools block path traversal via `resolvePortalPath`

### Quality Requirements

- [ ] TypeScript compilation: zero errors
- [ ] All 15 new tests pass
- [ ] All existing MCP handler tests pass (no regressions)
- [ ] All four tools appear in MCP `tools/list` response with correct names
- [ ] `McpToolName` enum contains all four new names
- [ ] `WRITE_TOOLS` constant in `src/shared/constants.ts` updated to include all four new tools

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

```
