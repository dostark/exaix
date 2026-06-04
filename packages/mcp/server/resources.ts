/**
 * @module McpResources
 * @path packages/mcp/server/resources.ts
 * @description Implements the MCP resource layer, exposing portal files via the portal:// URI scheme with dynamic discovery.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server/server.ts, "packages/portal/src/portal_permissions.ts"]
 */

import { relative } from "@std/path";
import { walk } from "@std/fs";
import type { Config } from "@exaix/schemas/config.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";

// ============================================================================
// Types
// ============================================================================

export interface IMCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

export interface MCPResourceTemplate {
  uriTemplate: string;
  name: string;
  mimeType?: string;
  description?: string;
}

// ============================================================================
// Resource Discovery
// ============================================================================

/**
 * Parse portal:// URI into portal name and path
 *
 * @example
 * parsePortalURI("portal://MyApp/src/auth.ts")
 * // => { portal: "MyApp", path: "src/auth.ts" }
 */
export function parsePortalURI(uri: string): { portal: string; path: string } | null {
  const match = uri.match(/^portal:\/\/([^/]+)\/(.*)$/);
  if (!match) {
    return null;
  }

  return {
    portal: match[1],
    path: match[2],
  };
}

/**
 * Build portal:// URI from portal name and path
 */
export function buildPortalURI(portal: string, path: string): string {
  return `portal://${portal}/${path}`;
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    // Code
    "ts": "text/x-typescript",
    "tsx": "text/x-typescript",
    "js": "text/javascript",
    "jsx": "text/javascript",
    "py": "text/x-python",
    "rs": "text/x-rust",
    "go": "text/x-go",
    "java": "text/x-java",
    "c": "text/x-c",
    "cpp": "text/x-c++",
    "h": "text/x-c",
    "hpp": "text/x-c++",

    // Markup
    "html": "text/html",
    "css": "text/css",
    "md": "text/markdown",
    "xml": "text/xml",
    "json": "application/json",
    "toml": "application/toml",
    "yaml": "text/yaml",
    "yml": "text/yaml",

    // Text
    "txt": "text/plain",
    "log": "text/plain",
  };

  return mimeTypes[ext || ""] || "application/octet-stream";
}

/**
 * Discover resources from a single portal
 */
export async function discoverPortalResources(
  portalName: string,
  portalPath: string,
  options: {
    maxDepth?: number;
    includeHidden?: boolean;
    extensions?: string[];
  } = {},
): Promise<IMCPResource[]> {
  const resources: IMCPResource[] = [];
  const maxDepth = options.maxDepth ?? 3;
  const includeHidden = options.includeHidden ?? false;

  try {
    for await (
      const entry of walk(portalPath, {
        maxDepth,
        includeFiles: true,
        includeDirs: false,
        includeSymlinks: false,
        followSymlinks: false,
      })
    ) {
      // Skip hidden files unless explicitly included
      if (!includeHidden && entry.name.startsWith(".")) {
        continue;
      }

      // Filter by extensions if specified
      if (options.extensions && options.extensions.length > 0) {
        const ext = entry.name.split(".").pop()?.toLowerCase();
        if (!ext || !options.extensions.includes(ext)) {
          continue;
        }
      }

      // Build relative path from portal root
      const relativePath = relative(portalPath, entry.path);

      // Build portal:// URI
      const uri = buildPortalURI(portalName, relativePath);

      resources.push({
        uri,
        name: `${portalName}: ${relativePath}`,
        mimeType: getMimeType(entry.path),
        description: `File in ${portalName} portal`,
      });
    }
  } catch (error) {
    // Portal directory doesn't exist or not accessible
    console.warn(`Failed to discover resources in portal '${portalName}':`, error);
  }

  return resources;
}

/**
 * Discover all resources from configured portals
 */
export async function discoverAllResources(
  config: Config,
  logger?: IEventLogger,
  options: {
    maxDepth?: number;
    includeHidden?: boolean;
    extensions?: string[];
  } = {},
): Promise<IMCPResource[]> {
  const allResources: IMCPResource[] = [];

  // Discover from each configured portal
  for (const portal of config.portals) {
    const resources = await discoverPortalResources(
      portal.alias,
      portal.target_path,
      options,
    );
    allResources.push(...resources);
  }

  // Log resource discovery
  if (logger) {
    logger.info(DomainEventType.McpResourcesDiscovered, null, {
      resource_count: allResources.length,
      portal_count: config.portals.length,
    });
  }

  return allResources;
}

/**
 * Get resource templates for portal patterns
 *
 * Resource templates describe URI patterns that can be read dynamically.
 */
export function getResourceTemplates(config: Config): MCPResourceTemplate[] {
  return config.portals.map((portal) => ({
    uriTemplate: `portal://${portal.alias}/{path}`,
    name: `${portal.alias} portal files`,
    mimeType: "text/plain",
    description: `Files in ${portal.alias} portal`,
  }));
}
