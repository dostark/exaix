/**
 * @module McpPackage
 * @path packages/mcp/mod.ts
 * @description Package entrypoint for @exaix/mcp. This package exports MCP-specific enums,
 * defaults, and the canonical tool manifest.
 */

export * from "./src/constants.ts";
export * from "./src/enums.ts";
export { TOOL_MANIFEST } from "./src/manifest.ts";
export type { IJsonSchemaDescriptor, IToolManifestEntry } from "./src/manifest.ts";
