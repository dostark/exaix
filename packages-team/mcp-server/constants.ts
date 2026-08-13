/**
 * @module McpServerConstants
 * @path packages-team/mcp-server/constants.ts
 * @related-files [packages-team/mcp-server/server.ts]
 * @architectural-layer MCP
 * @description Module-scoped constants for the team-tier MCP server (Phase 163 Step 4):
 * spec-defined protocol values used by the config-gated Bearer-token auth composition.
 * Kept in a `constants.ts` file per CODE_STYLE.md §2 (internal constants live in a
 * module-scoped constants.ts within the package).
 */

/**
 * RFC 8414 `response_types_supported` value for the MCP resource-server metadata
 * document. `"none"` is the honest value for this deployment: Exaix's MCP auth is a
 * static shared-secret Bearer token, so the server issues no interactive authorization
 * responses (no `code`/`token` grant flows).
 */
export const MCP_OAUTH_RESPONSE_TYPE_NONE = "none";
