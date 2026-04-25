/**
 * @module MCPSchema
 * @path src/shared/schemas/mcp.ts
 * @description Provides Zod validation schemas for Model Context Protocol (MCP) types, including tool arguments, responses, resources, and prompts.
 * @architectural-layer Schemas
 * * @related-files [src/mcp/server.ts, src/mcp/tool_handler.ts]
 */

import { z } from "zod";
import { McpTransportType } from "@exaix/mcp";
import { PLAN_STATUS_VALUES } from "@exaix/core";
import { DEFAULT_AGENT_MODEL, DEFAULT_QUERY_LIMIT } from "@exaix/core";
import { DEFAULT_MCP_IDENTITY_ID, DEFAULT_MCP_VERSION } from "@exaix/mcp";

// ============================================================================
// MCP Configuration Schema
// ============================================================================

export const MCPConfigSchema = z.object({
  enabled: z.boolean().default(true),
  transport: z.nativeEnum(McpTransportType).default(McpTransportType.STDIO),
  server_name: z.string().default("exaix"),
  version: z.string().default(DEFAULT_MCP_VERSION),
});

export type MCPConfig = z.infer<typeof MCPConfigSchema>;

// ============================================================================
// MCP Tool Schemas
// ============================================================================

const MCP_ERR_PORTAL_REQUIRED = "Portal name required";
const MCP_ERR_IDENTITY_REQUIRED = "Identity ID required";
const MCP_ERR_PATH_REQUIRED = "File path required";

export const ReadFileToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  path: z.string().min(1, MCP_ERR_PATH_REQUIRED),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const WriteFileToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  path: z.string().min(1, MCP_ERR_PATH_REQUIRED),
  content: z.string(),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const ListDirectoryToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  path: z.string().optional().default(""),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const GitCreateBranchToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  branch: z.string().min(1, "Branch name required")
    .regex(/^(feat|fix|docs|chore|refactor|test)\//, "Branch must start with feat/, fix/, docs/, etc."),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const GitCommitToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  message: z.string().min(1, "Commit message required"),
  files: z.array(z.string()).optional(),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const GitStatusToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const PatchFileToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  path: z.string().min(1, MCP_ERR_PATH_REQUIRED),
  /** Exact string to search for in the file. Must match exactly once. */
  search: z.string().min(1, "Search string required"),
  /** Replacement string. May be empty to delete the matched section. */
  replace: z.string(),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const DeleteFileToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  path: z.string().min(1, MCP_ERR_PATH_REQUIRED),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const MoveFileToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  from: z.string().min(1, "Source path required"),
  to: z.string().min(1, "Destination path required"),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const CreateDirectoryToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  path: z.string().min(1, "Directory path required"),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const CreateRequestToolArgsSchema = z.object({
  description: z.string().min(1, "Description required"),
  /** @deprecated Use identity instead */
  agent: z.string().default(DEFAULT_AGENT_MODEL),
  /** Identity to assign (Phase 54 canonical field) */
  identity: z.string().default(DEFAULT_AGENT_MODEL),
  context: z.array(z.string()).optional(),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const ListPlansToolArgsSchema = z.object({
  status: z.enum(PLAN_STATUS_VALUES).optional(),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const ApprovePlanToolArgsSchema = z.object({
  plan_id: z.string().min(1, "Plan ID required"),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const QueryJournalToolArgsSchema = z.object({
  trace_id: z.string().optional(),
  limit: z.number().int().positive().default(DEFAULT_QUERY_LIMIT),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const RunCommandToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  command: z.string().min(1, "Command required"),
  args: z.array(z.string()).optional(),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

export const SearchFilesToolArgsSchema = z.object({
  portal: z.string().min(1, MCP_ERR_PORTAL_REQUIRED),
  pattern: z.string().min(1, "Pattern required"),
  path: z.string().optional().default(""),
  identity_id: z.string().min(1, MCP_ERR_IDENTITY_REQUIRED).default(DEFAULT_MCP_IDENTITY_ID),
});

// Union type for all tool arguments
export type MCPToolArgs =
  | z.infer<typeof ReadFileToolArgsSchema>
  | z.infer<typeof WriteFileToolArgsSchema>
  | z.infer<typeof ListDirectoryToolArgsSchema>
  | z.infer<typeof GitCreateBranchToolArgsSchema>
  | z.infer<typeof GitCommitToolArgsSchema>
  | z.infer<typeof GitStatusToolArgsSchema>
  | z.infer<typeof CreateRequestToolArgsSchema>
  | z.infer<typeof ListPlansToolArgsSchema>
  | z.infer<typeof ApprovePlanToolArgsSchema>
  | z.infer<typeof QueryJournalToolArgsSchema>
  | z.infer<typeof PatchFileToolArgsSchema>
  | z.infer<typeof DeleteFileToolArgsSchema>
  | z.infer<typeof MoveFileToolArgsSchema>
  | z.infer<typeof CreateDirectoryToolArgsSchema>
  | z.infer<typeof RunCommandToolArgsSchema>
  | z.infer<typeof SearchFilesToolArgsSchema>;

// ============================================================================
// MCP Response Schemas
// ============================================================================

export const MCPContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const MCPToolResponseSchema = z.object({
  content: z.array(MCPContentSchema),
});

export const MCPErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

export type MCPToolResponse = z.infer<typeof MCPToolResponseSchema>;
export type MCPError = z.infer<typeof MCPErrorSchema>;

// ============================================================================
// MCP Resource Schemas
// ============================================================================

export const MCPResourceSchema = z.object({
  uri: z.string().startsWith("portal://", "URI must start with portal://"),
  name: z.string(),
  mimeType: z.string().optional(),
  description: z.string().optional(),
});

export type IMCPResource = z.infer<typeof MCPResourceSchema>;

// ============================================================================
// MCP Prompt Schemas
// ============================================================================

export const MCPPromptArgumentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

export const MCPPromptSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  arguments: z.array(MCPPromptArgumentSchema).optional(),
});

export type IMCPPrompt = z.infer<typeof MCPPromptSchema>;

// ============================================================================
// MCP Tool Definition Schema
// ============================================================================

export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }),
});

export type MCPTool = z.infer<typeof MCPToolSchema>;
