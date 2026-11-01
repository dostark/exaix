/**
 * @module McpPackage
 * @path packages/mcp/mod.ts
 * @ungrounded
 * @related-files []
 * @architectural-layer MCP
 * @description Package entrypoint for @exaix/mcp. This package exports MCP-specific enums,
 * defaults, and the canonical tool manifest.
 */

export {
  DEFAULT_MCP_AGENT_ROLE_ID,
  DEFAULT_MCP_ENABLED,
  DEFAULT_MCP_HTTP_PORT,
  DEFAULT_MCP_SERVER_NAME,
  DEFAULT_MCP_TRANSPORT,
  DEFAULT_MCP_VERSION,
} from "@exaix/core";
export * from "./src/constants.ts";
export * from "./src/enums.ts";
export * from "./src/tool_result_metadata.ts";
export * from "./src/tool_result_converter.ts";
export * from "./src/tool_catalog_parity.ts";
export { appendToolChoiceHint, TOOL_MANIFEST } from "./src/manifest.ts";
export { DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS } from "./src/manifest.ts";
export type { IToolManifestEntry } from "./src/manifest.ts";
export type { IMcpClient, IMcpToolCallContext } from "./src/i_mcp_client.ts";
export { ExternalMcpClient } from "./src/external_mcp_client.ts";
export type {
  ExternalMcpTransportKind,
  IExternalMcpCallResult,
  IExternalMcpClient,
  IExternalMcpConnectOptions,
  IExternalMcpToolDefinition,
} from "./src/i_external_mcp_client.ts";
