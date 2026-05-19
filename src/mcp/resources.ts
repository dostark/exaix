/**
 * @module McpResources
 * @path src/mcp/resources.ts
 * @description Compatibility shim for the package-owned MCP resource layer.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import {
  buildPortalURI as buildPortalURIBase,
  discoverAllResources as discoverAllResourcesBase,
  discoverPortalResources as discoverPortalResourcesBase,
  getResourceTemplates as getResourceTemplatesBase,
  parsePortalURI as parsePortalURIBase,
} from "@exaix/mcp/server";
import type {
  IMCPResource as IMCPResourceBase,
  MCPResourceTemplate as MCPResourceTemplateBase,
} from "@exaix/mcp/server";

export type IMCPResource = IMCPResourceBase;
export type MCPResourceTemplate = MCPResourceTemplateBase;

export function parsePortalURI(...args: Parameters<typeof parsePortalURIBase>): ReturnType<typeof parsePortalURIBase> {
  return parsePortalURIBase(...args);
}

export function buildPortalURI(...args: Parameters<typeof buildPortalURIBase>): ReturnType<typeof buildPortalURIBase> {
  return buildPortalURIBase(...args);
}

export function discoverPortalResources(
  ...args: Parameters<typeof discoverPortalResourcesBase>
): ReturnType<typeof discoverPortalResourcesBase> {
  return discoverPortalResourcesBase(...args);
}

export function discoverAllResources(
  ...args: Parameters<typeof discoverAllResourcesBase>
): ReturnType<typeof discoverAllResourcesBase> {
  return discoverAllResourcesBase(...args);
}

export function getResourceTemplates(
  ...args: Parameters<typeof getResourceTemplatesBase>
): ReturnType<typeof getResourceTemplatesBase> {
  return getResourceTemplatesBase(...args);
}
