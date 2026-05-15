/**
 * @module McpEnums
 * @path packages/mcp/src/enums.ts
 * @description MCP enums re-exported from @exaix/core.
 */

import { McpToolName as CoreMcpToolName, McpTransportType as CoreMcpTransportType } from "@exaix/core";
import type { McpToolName as CoreMcpToolNameType, McpTransportType as CoreMcpTransportTypeType } from "@exaix/core";

export const McpToolName = CoreMcpToolName;
export const McpTransportType = CoreMcpTransportType;
export type McpToolName = CoreMcpToolNameType;
export type McpTransportType = CoreMcpTransportTypeType;
