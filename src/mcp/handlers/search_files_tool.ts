/**
 * @module SearchFilesTool
 * @path src/mcp/handlers/search_files_tool.ts
 * @description Compatibility shim for the package-owned SearchFilesTool implementation.
 * @architectural-layer MCP
 * @related-files [packages/mcp/server]
 */

import { SearchFilesTool as SearchFilesToolBase } from "@exaix/mcp/server";

export class SearchFilesTool extends SearchFilesToolBase {}
