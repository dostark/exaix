/**
 * @module CommandsConstants
 * @path apps/exactl/src/commands/constants.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Shared constants for CLI command implementations.
 */

export const STDIO_INHERIT = "inherit";

/** Env var name `exactl mcp connect` reads for bearer-token machine auth. Never a CLI flag — secrets stay out of `ps`-visible argv. */
export const EXA_MCP_BEARER_TOKEN_ENV_VAR = "EXA_MCP_BEARER_TOKEN";
