/**
 * @module McpToolManifest
 * @path packages/mcp/src/manifest.ts
 * @description Canonical tool manifest for all Exaix tools — live MCP tools and internal-only
 * tools. This is the single source of truth for registration, classification, docs visibility,
 * dynamic-execution policy, and agent-quality metadata.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/tools.ts, packages/mcp/server/server.ts, packages/core/src/types/enums.ts]
 */

import { JsonSchemaType, McpToolName, ToolCategory, ToolKind, ToolSideEffectScope } from "@exaix/core";
import { REMEDIATION_MODE_FAIL_CLOSED, REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE } from "@exaix/schemas";

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
  /** Current source ownership reference used by docs generation. This is an ownership hint, not a permanence guarantee. */
  source_ref?: string;
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
  /**
   * References the remediation policy mode applied when this tool's result payload
   * fails schema validation. One of: fail_closed, normalize_then_validate,
   * retry_once, retry_with_backoff, escalate_only.
   * Read-only/idempotent tools → normalize_then_validate; mutating tools → fail_closed.
   */
  remediationPolicyRef?: string;
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
    source_ref: "packages/mcp/server/handlers/read_file_tool.ts",
    description:
      "Return the full text content of a file inside a portal. Use when you need to read or analyze file contents. For searching within files use grep_search; for checking whether a file exists use list_directory. Returns the raw file text as a string.",
    output_schema: {
      type: "string",
      description: "Raw text content of the file.",
    },
    error_types: ["PERMISSION_DENIED", "NOT_FOUND", "PATH_TRAVERSAL", "INVALID_ARGS"],
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
    remediationPolicyRef: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
  },
  {
    name: McpToolName.WRITE_FILE,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/write_file_tool.ts",
    description:
      "Write or overwrite the full content of a file inside a portal. Use when you need to create a new file or completely replace an existing file. For partial edits use patch_file. Returns a success confirmation message.",
    output_schema: {
      type: "string",
      description: "Success confirmation message.",
    },
    error_types: ["PERMISSION_DENIED", "PATH_TRAVERSAL", "INVALID_ARGS"],
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
  {
    name: McpToolName.PATCH_FILE,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/patch_file_tool.ts",
    description:
      "Apply a targeted patch to replace a specific substring in a file without rewriting the whole file. Use when you need to make a minimal change. For full rewrites use write_file. Returns a success confirmation message.",
    output_schema: {
      type: "string",
      description: "Success confirmation message including the patched path.",
    },
    error_types: ["PERMISSION_DENIED", "NOT_FOUND", "PATH_TRAVERSAL", "INVALID_ARGS"],
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
  {
    name: McpToolName.DELETE_FILE,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/delete_file_tool.ts",
    description:
      "Permanently delete a file inside a portal. Use only when you are certain the file is no longer needed; the operation is irreversible unless the portal is under git version control. Returns a success confirmation message.",
    output_schema: {
      type: "string",
      description: "Success confirmation message.",
    },
    error_types: ["PERMISSION_DENIED", "NOT_FOUND", "PATH_TRAVERSAL", "INVALID_ARGS"],
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
  {
    name: McpToolName.MOVE_FILE,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/move_file_tool.ts",
    description:
      "Move or rename a file within a portal. The source path is removed after the move. Use for file reorganization or renaming; not for copying (use copy_file for that). Returns a success confirmation message.",
    output_schema: {
      type: "string",
      description: "Success confirmation message.",
    },
    error_types: ["PERMISSION_DENIED", "NOT_FOUND", "PATH_TRAVERSAL", "INVALID_ARGS"],
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
  {
    name: McpToolName.CREATE_DIRECTORY,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.WRITE,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/create_directory_tool.ts",
    description:
      "Create a directory (and any missing parent directories) inside a portal. Use before writing files into a directory that may not exist yet. Safe to call if the directory already exists. Returns a success confirmation message.",
    output_schema: {
      type: "string",
      description: "Success confirmation message.",
    },
    error_types: ["PERMISSION_DENIED", "PATH_TRAVERSAL", "INVALID_ARGS"],
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
  {
    name: McpToolName.LIST_DIRECTORY,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.READ,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/list_directory_tool.ts",
    description:
      "List the files and subdirectories at a path inside a portal. Use to check whether a file exists, explore directory structure, or enumerate files before processing. Returns an array of entry names.",
    output_schema: {
      type: JsonSchemaType.ARRAY,
      description: "Array of file and directory names at the specified path.",
      items: { type: "string" },
    },
    error_types: ["PERMISSION_DENIED", "NOT_FOUND", "PATH_TRAVERSAL", "INVALID_ARGS"],
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
    remediationPolicyRef: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
  },
  {
    name: McpToolName.SEARCH_FILES,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.READ,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/search_files_tool.ts",
    description:
      "Search for files matching a name or glob pattern inside a portal. Use to locate files when you don't know the exact path. For content search within files use grep_search. Returns an array of matching relative file paths.",
    output_schema: {
      type: JsonSchemaType.ARRAY,
      description: "Array of relative file paths matching the search pattern.",
      items: { type: "string" },
    },
    error_types: ["PERMISSION_DENIED", "PATH_TRAVERSAL", "INVALID_ARGS", "EXECUTION_FAILED"],
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
    delegates_to_registry: true,
    remediationPolicyRef: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
  },
  // ── Git tools (MCP handlers) ────────────────────────────────────────────
  {
    name: McpToolName.GIT_CREATE_BRANCH,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.GIT,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/git_create_branch_tool.ts",
    description:
      "Create a new git branch in the portal repository. Use before making changes that should be isolated on a branch. Returns the new branch name on success.",
    output_schema: {
      type: "string",
      description: "Newly created branch name.",
    },
    error_types: ["PERMISSION_DENIED", "PATH_TRAVERSAL", "INVALID_ARGS", "EXECUTION_FAILED"],
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.GIT,
    parallel_safe: false,
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
  {
    name: McpToolName.GIT_COMMIT,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.GIT,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/git_commit_tool.ts",
    description:
      "Stage all changes and create a git commit in the portal repository. Use after writing or modifying files to record the change. Returns the commit hash of the newly created commit.",
    output_schema: {
      type: "string",
      description: "Git commit hash of the created commit.",
    },
    error_types: ["PERMISSION_DENIED", "PATH_TRAVERSAL", "INVALID_ARGS", "EXECUTION_FAILED"],
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.GIT,
    parallel_safe: false,
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
  {
    name: McpToolName.GIT_STATUS,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.GIT,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/git_status_tool.ts",
    description:
      "Show the working tree status (modified, staged, untracked files) of the portal git repository. Use to inspect pending changes before committing. Returns the git status output as a formatted string.",
    output_schema: {
      type: "string",
      description: "Git working tree status output showing modified, staged, and untracked files.",
    },
    error_types: ["PERMISSION_DENIED", "PATH_TRAVERSAL", "EXECUTION_FAILED"],
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
    remediationPolicyRef: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
  },
  {
    name: McpToolName.RUN_COMMAND,
    kind: ToolKind.MCP_HANDLER,
    category: ToolCategory.META,
    dynamic_mode_allowed: false,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/handlers/run_command_tool.ts",
    description:
      "Execute a shell command inside the portal working directory. Use for build tasks, test runners, or any operation not covered by dedicated tools. Returns combined stdout/stderr output and exit code.",
    output_schema: {
      type: "object",
      description: "Command execution result with stdout, stderr, and exitCode.",
      properties: {
        stdout: { type: "string", description: "Standard output of the command." },
        stderr: { type: "string", description: "Standard error output of the command." },
        exitCode: { type: "number", description: "Process exit code (0 = success)." },
      },
    },
    error_types: ["PERMISSION_DENIED", "COMMAND_BLOCKED", "EXECUTION_FAILED", "INVALID_ARGS"],
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.SYSTEM,
    parallel_safe: false,
    delegates_to_registry: true,
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
  // ── Domain tools (MCP domain) ────────────────────────────────────────────
  {
    name: McpToolName.CREATE_REQUEST,
    kind: ToolKind.MCP_DOMAIN,
    category: ToolCategory.DOMAIN,
    dynamic_mode_allowed: true,
    requires_human_approval: true,
    docs_visible: true,
    source_ref: "packages/mcp/server/domain_tools.ts",
    description:
      "Create a new Exaix request record (a work item to be planned and executed by an agent). Use when a user describes a task that needs agent execution. Mutating — requires human confirmation in Phase 79. Returns the created request record with its assigned ID.",
    output_schema: {
      type: "object",
      description: "Created request record with id, title, and status fields.",
      properties: {
        id: { type: "string", description: "Unique request identifier." },
        title: { type: "string", description: "Request title." },
        status: { type: "string", description: "Initial request status." },
      },
    },
    error_types: ["INVALID_ARGS", "EXECUTION_FAILED"],
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
  {
    name: McpToolName.LIST_PLANS,
    kind: ToolKind.MCP_DOMAIN,
    category: ToolCategory.DOMAIN,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/domain_tools.ts",
    description:
      "List all execution plans (active, draft, or completed) tracked in the Exaix workspace. Read-only; safe for dynamic execution. Use to check plan status or find a plan ID before approving or querying. Returns an array of plan summary objects.",
    output_schema: {
      type: JsonSchemaType.ARRAY,
      description: "Array of plan summary objects with id, title, and status.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string" },
        },
      },
    },
    error_types: ["EXECUTION_FAILED"],
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
    remediationPolicyRef: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
  },
  {
    name: McpToolName.APPROVE_PLAN,
    kind: ToolKind.MCP_DOMAIN,
    category: ToolCategory.DOMAIN,
    dynamic_mode_allowed: true,
    requires_human_approval: true,
    docs_visible: true,
    source_ref: "packages/mcp/server/domain_tools.ts",
    description:
      "Approve or reject an execution plan, advancing it to the next state in the Exaix workflow. Use when a human has reviewed a plan and wants to authorize or cancel agent execution. Mutating — requires human confirmation in Phase 79. Returns the updated plan record.",
    output_schema: {
      type: "object",
      description: "Updated plan record with new approval status.",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
      },
    },
    error_types: ["NOT_FOUND", "INVALID_ARGS", "EXECUTION_FAILED"],
    idempotent: false,
    side_effect_scope: ToolSideEffectScope.PORTAL,
    parallel_safe: false,
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
  {
    name: McpToolName.QUERY_JOURNAL,
    kind: ToolKind.MCP_DOMAIN,
    category: ToolCategory.DOMAIN,
    dynamic_mode_allowed: true,
    requires_human_approval: false,
    docs_visible: true,
    source_ref: "packages/mcp/server/domain_tools.ts",
    description:
      "Query the Exaix activity journal for execution history, tool calls, or agent events. Read-only; safe for dynamic execution. Use to audit what happened or look up recent activity in a flow. Returns an array of matching journal entry records.",
    output_schema: {
      type: JsonSchemaType.ARRAY,
      description: "Array of journal entry records matching the query.",
      items: {
        type: "object",
        properties: {
          timestamp: { type: "string" },
          event: { type: "string" },
          payload: { type: "object" },
        },
      },
    },
    error_types: ["INVALID_ARGS", "EXECUTION_FAILED"],
    idempotent: true,
    side_effect_scope: ToolSideEffectScope.NONE,
    parallel_safe: true,
    remediationPolicyRef: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
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
    remediationPolicyRef: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
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
    remediationPolicyRef: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
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
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
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
    remediationPolicyRef: REMEDIATION_MODE_NORMALIZE_THEN_VALIDATE,
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
    remediationPolicyRef: REMEDIATION_MODE_FAIL_CLOSED,
  },
];

/**
 * Canonical set of tool names safe for dynamic (ReAct-style) execution
 * WITHOUT requiring human approval. Used by DynamicStepExecutor when no
 * confirmation interceptor is configured (Phase 77 fallback behavior).
 * Derived from TOOL_MANIFEST where dynamic_mode_allowed === true AND
 * requires_human_approval === false.
 *
 * Do NOT use READ_ONLY_TOOLS for this purpose — it can drift from the manifest.
 *
 * See also: DYNAMIC_MODE_APPROVAL_TOOLS for tools that require an interceptor.
 */
export const DYNAMIC_MODE_TOOLS: ReadonlySet<string> = new Set(
  TOOL_MANIFEST
    .filter((e) => e.dynamic_mode_allowed && !e.requires_human_approval)
    .map((e) => e.name),
);

/**
 * Tools that are allowed in dynamic (ReAct-style) execution but require
 * human approval via IToolConfirmationInterceptor before being called.
 * Derived from TOOL_MANIFEST where dynamic_mode_allowed === true AND
 * requires_human_approval === true.
 *
 * Phase 79 adds these to the DynamicStepExecutor tool surface when an
 * interceptor is injected. Without an interceptor they are excluded (same as
 * Phase 77 behavior) because DYNAMIC_MODE_TOOLS does not include them.
 */
export const DYNAMIC_MODE_APPROVAL_TOOLS: ReadonlySet<string> = new Set(
  TOOL_MANIFEST
    .filter((e) => e.dynamic_mode_allowed && e.requires_human_approval)
    .map((e) => e.name),
);
