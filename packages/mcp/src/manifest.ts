/**
 * @module McpToolManifest
 * @path packages/mcp/src/manifest.ts
 * @description Canonical tool manifest for all Exaix tools — live MCP tools and internal-only
 * tools. This is the single source of truth for registration, classification, docs visibility,
 * dynamic-execution policy, and agent-quality metadata.
 * @architectural-layer MCP
 * @related-files [src/mcp/tools.ts, src/mcp/server.ts, packages/mcp/src/enums.ts]
 */

import { McpToolName, ToolCategory, ToolKind, ToolSideEffectScope } from "@exaix/core";

/**
 * Minimal JSON Schema draft-07 descriptor used in tool manifest output_schema fields.
 * Only the properties needed to describe tool return shapes are modelled here.
 * Phase 78 will validate these descriptors more strictly using Zod.
 */
export interface IJsonSchemaDescriptor {
  type?: string;
  description?: string;
  properties?: Record<string, IJsonSchemaDescriptor>;
  required?: string[];
  items?: IJsonSchemaDescriptor;
  enum?: string[];
}

/**
 * Canonical metadata record for one tool.
 * Registration fields drive server wiring, classification, and parity tests.
 * Agent-quality fields (description, output_schema, error_types, examples) drive
 * TOOLS.md generation and LLM tool selection. output_schema and error_types are
 * populated in full during Step 77.9; stubs are acceptable in Step 77.1.
 */
export interface IToolManifestEntry {
  /** Stable external tool name (matches enum value). */
  name: string;
  /** Exposure kind: live MCP handler, live MCP domain tool, or internal-only. */
  kind: ToolKind;
  /** Functional category for classification and routing. */
  category: ToolCategory;
  /** True if this tool may be selected by DynamicStepExecutor in ReAct mode. */
  dynamic_mode_allowed: boolean;
  /** True if the dynamic executor must pause for human confirmation before calling this tool.
   *  Phase 77: treated as a static exclusion from dynamic selection.
   *  Phase 79 upgrades this to a runtime confirmation interceptor. */
  requires_human_approval: boolean;
  /** True if this tool should appear in TOOLS.md and tools/list catalog. */
  docs_visible: boolean;
  /** Agent-facing description answering: what it does, when to prefer it, what it returns,
   *  and what can go wrong. Full quality audit in Step 77.9. */
  description: string;
  /** JSON Schema draft-07 descriptor for the tool's return shape (Decision D2). Populated fully in Step 77.9. */
  output_schema?: IJsonSchemaDescriptor;
  /** ToolErrorCode string values this tool may return (populated fully in Step 77.4/77.9). */
  error_types?: string[];
  /** True if repeated calls with the same inputs produce the same result. */
  idempotent: boolean;
  /** What state the tool may modify (used by executors for safe-execution decisions). */
  side_effect_scope: ToolSideEffectScope;
  /** True if this tool can be called concurrently with other tool calls without conflict. */
  parallel_safe: boolean;
  /** True if this MCP handler delegates execution to ToolRegistry (Decision D4).
   *  Only run_command and search_files. */
  delegates_to_registry?: boolean;
}

export const TOOL_MANIFEST: IToolManifestEntry[] = [
  // ── Portal / file tools (MCP handlers) ──────────────────────────────────
  {
    name: McpToolName.READ_FILE,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.READ,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Return the full text content of a file inside a portal. Use when you need to read or analyze file contents. For searching within files use grep_search; for checking whether a file exists use list_directory. Returns the raw file text as a string.",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
  },
  {
    name: McpToolName.WRITE_FILE,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Write or overwrite the full content of a file inside a portal. Use when you need to create a new file or completely replace an existing file. For partial edits use patch_file.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
  },
  {
    name: McpToolName.PATCH_FILE,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Apply a targeted patch to replace a specific substring in a file without rewriting the whole file. Use when you need to make a minimal change. For full rewrites use write_file.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
  },
  {
    name: McpToolName.DELETE_FILE,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Permanently delete a file inside a portal. Irreversible unless the portal is under git version control. Verify the path before calling.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
  },
  {
    name: McpToolName.MOVE_FILE,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Move or rename a file within a portal. The source path is removed after the move. Use for reorganization or renaming.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
  },
  {
    name: McpToolName.CREATE_DIRECTORY,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Create a directory (and any missing parent directories) inside a portal. Safe to call if the directory already exists.",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
  },
  {
    name: McpToolName.LIST_DIRECTORY,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.READ,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "List the files and subdirectories at a path inside a portal. Use to check whether a file exists, explore directory structure, or enumerate files before processing. Returns an array of entry names.",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
  },
  {
    name: McpToolName.SEARCH_FILES,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.READ,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Search for files matching a name or glob pattern inside a portal. Use to locate files when you don't know the exact path. For content search within files use grep_search.",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
    delegates_to_registry: true,
  },
  // ── Git tools (MCP handlers) ────────────────────────────────────────────
  {
    name: McpToolName.GIT_CREATE_BRANCH,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.GIT,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Create a new git branch in the portal repository. Use before making changes that should be isolated on a branch. Returns the new branch name.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.GIT,
    parallel_safe: false,
  },
  {
    name: McpToolName.GIT_COMMIT,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.GIT,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Stage all changes and create a git commit in the portal repository. Use after writing or modifying files to record the change.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.GIT,
    parallel_safe: false,
  },
  {
    name: McpToolName.GIT_STATUS,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.GIT,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Show the working tree status (modified, staged, untracked files) of the portal git repository. Use to inspect pending changes before committing.",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
  },
  {
    name: McpToolName.RUN_COMMAND,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.META,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Execute a shell command inside the portal working directory. Use for build tasks, test runners, or any operation not covered by dedicated tools. Returns combined stdout/stderr output and exit code.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.SYSTEM,
    parallel_safe: false,
    delegates_to_registry: true,
  },
  // ── Domain tools (MCP domain) ────────────────────────────────────────────
  {
    name: McpToolName.CREATE_REQUEST,
    kind: ToolKind.MCP_DOMAIN,
    category: ToolCategory.DOMAIN,
    dynamic_mode_allowed: false,
    requires_human_approval: true,
    docs_visible: true,
    description:
      "Create a new Exaix request record (a work item to be planned and executed by an agent). Use when a user describes a task that needs agent execution. Mutating — requires human confirmation in Phase 79.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
  },
  {
    name: McpToolName.LIST_PLANS,
    kind: ToolKind.MCP_DOMAIN,
    category: ToolCategory.DOMAIN,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "List all execution plans (active, draft, or completed) tracked in the Exaix workspace. Read-only; safe for dynamic execution. Use to check plan status or find a plan ID.",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
  },
  {
    name: McpToolName.APPROVE_PLAN,
    kind: ToolKind.MCP_DOMAIN,
    category: ToolCategory.DOMAIN,
    dynamic_mode_allowed: false,
    requires_human_approval: true,
    docs_visible: true,
    description:
      "Approve or reject an execution plan, advancing it to the next state in the Exaix workflow. Mutating — requires human confirmation in Phase 79.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
  },
  {
    name: McpToolName.QUERY_JOURNAL,
    kind: ToolKind.MCP_DOMAIN,
    category: ToolCategory.DOMAIN,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    description:
      "Query the Exaix activity journal for execution history, tool calls, or agent events. Read-only; safe for dynamic execution. Use to audit what happened or look up recent activity.",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
  },
  // ── Internal-only tools (ToolRegistry, not exposed via MCP) ─────────────
  {
    name: "fetch_url",
    kind: ToolKind.INTERNAL_ONLY,
    category: ToolCategory.NETWORK,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: false,
    description: "Fetch the content of a URL via HTTP GET. Internal agent strategy tool only.",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NETWORK,
    parallel_safe: true,
  },
  {
    name: "grep_search",
    kind: ToolKind.INTERNAL_ONLY,
    category: ToolCategory.READ,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: false,
    description:
      "Search for a regex pattern within file contents across a directory tree. Internal agent strategy tool only.",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
  },
  {
    name: "copy_file",
    kind: ToolKind.INTERNAL_ONLY,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: false,
    description: "Copy a file to a new destination path. Internal agent strategy tool only.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
  },
  {
    name: "git_info",
    kind: ToolKind.INTERNAL_ONLY,
    category: ToolCategory.GIT,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: false,
    description: "Return current branch, HEAD SHA, and repository metadata. Internal agent strategy tool only.",
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
  },
  {
    name: "deno_task",
    kind: ToolKind.INTERNAL_ONLY,
    category: ToolCategory.META,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: false,
    description: "Execute a named Deno task defined in deno.json. Internal agent strategy tool only.",
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.SYSTEM,
    parallel_safe: false,
  },
];
