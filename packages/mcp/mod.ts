/**
 * @module McpPackage
 * @path packages/mcp/mod.ts
 * @ungrounded
 * @related-files []
 * @architectural-layer MCP
 * @description Package entrypoint for @exaix/mcp. This package exports MCP-specific enums,
 * defaults, and the canonical tool manifest.
 */

export * from "./src/constants.ts";
export * from "./src/enums.ts";
export * from "./src/tool_result_metadata.ts";
export * from "./src/tool_result_converter.ts";
export { DYNAMIC_MODE_APPROVAL_TOOLS, DYNAMIC_MODE_TOOLS, TOOL_MANIFEST } from "./src/manifest.ts";
export type { IJsonSchemaDescriptor, IToolManifestEntry } from "./src/manifest.ts";
export type { IMcpClient } from "./src/i_mcp_client.ts";
