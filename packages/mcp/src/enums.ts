/**
 * @module McpEnums
 * @path packages/mcp/src/enums.ts
 * @description MCP-specific enum definitions used by the MCP transport, tool registry, and schema validation.
 */

export enum McpTransportType {
  STDIO = "stdio",
  SSE = "sse",
}

export enum McpToolName {
  READ_FILE = "read_file",
  WRITE_FILE = "write_file",
  RUN_COMMAND = "run_command",
  LIST_DIRECTORY = "list_directory",
  SEARCH_FILES = "search_files",
  CREATE_DIRECTORY = "create_directory",
  PATCH_FILE = "patch_file",
  DELETE_FILE = "delete_file",
  MOVE_FILE = "move_file",
  GIT_CREATE_BRANCH = "git_create_branch",
  GIT_COMMIT = "git_commit",
  GIT_STATUS = "git_status",
  CREATE_REQUEST = "exaix_create_request",
  LIST_PLANS = "exaix_list_plans",
  APPROVE_PLAN = "exaix_approve_plan",
  QUERY_JOURNAL = "exaix_query_journal",
  FETCH_URL = "FETCH_URL",
  GIT = "git",
}
