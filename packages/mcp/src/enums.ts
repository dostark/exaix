/**
 * @module McpEnums
 * @path packages/mcp/src/enums.ts
 * @description MCP enums re-exported from @exaix/core.
 */

import {
  McpToolName as CoreMcpToolName,
  McpTransportType as CoreMcpTransportType,
  ToolCategory as CoreToolCategory,
  ToolKind as CoreToolKind,
  ToolSideEffectScope as CoreToolSideEffectScope,
} from "@exaix/core";
import type {
  McpToolName as CoreMcpToolNameType,
  McpTransportType as CoreMcpTransportTypeType,
  ToolCategory as CoreToolCategoryType,
  ToolKind as CoreToolKindType,
  ToolSideEffectScope as CoreToolSideEffectScopeType,
} from "@exaix/core";

export const McpToolName = CoreMcpToolName;
export const McpTransportType = CoreMcpTransportType;
export const ToolKind = CoreToolKind;
export const ToolCategory = CoreToolCategory;
export const ToolSideEffectScope = CoreToolSideEffectScope;

export type McpToolName = CoreMcpToolNameType;
export type McpTransportType = CoreMcpTransportTypeType;
export type ToolKind = CoreToolKindType;
export type ToolCategory = CoreToolCategoryType;
export type ToolSideEffectScope = CoreToolSideEffectScopeType;
