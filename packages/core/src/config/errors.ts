/**
 * @module ConfigErrors
 * @path packages/core/src/config/errors.ts
 * @description Error classes and constants for the config system — ConfigKeyNotFoundError,
 *   ConfigValidationError, ConfigWriteError, and EDITION_GATED_PATHS set.
 * @architectural-layer Core
 * @related-files ["packages/core/src/config/registry.ts"]
 */
export interface IConfigWriteCause {
  message: string;
}

export class ConfigKeyNotFoundError extends Error {
  constructor(key: string) {
    super(`Configuration key not found: ${key}`);
    this.name = "ConfigKeyNotFoundError";
  }
}

export class ConfigValidationError extends Error {
  constructor(key: string, message: string) {
    super(`Invalid value for configuration key '${key}': ${message}`);
    this.name = "ConfigValidationError";
  }
}

export class ConfigWriteError extends Error {
  constructor(key: string, cause?: IConfigWriteCause) {
    const msg = `Failed to write configuration key '${key}'`;
    super(cause ? `${msg}: ${cause.message}` : msg);
    this.name = "ConfigWriteError";
    if (cause instanceof Error) this.cause = cause;
  }
}

/**
 * Thrown / surfaced when an MCP config write targets a path in the
 * config_mcp_blocklist (Phase 138 Step 2).
 */
export class ConfigPathBlockedError extends Error {
  constructor(key: string, reason?: string) {
    super(`Config path "${key}" is blocked from MCP writes${reason ? `: ${reason}` : ""}`);
    this.name = "ConfigPathBlockedError";
  }
}

/**
 * Thrown / surfaced when a config write exceeds a rate limit (Phase 138 Step 3):
 * CLI debounce, MCP pending cap, or DB page hard-limit.
 */
export class ConfigRateLimitedError extends Error {
  constructor(surface: string, limit: string) {
    super(`Config rate limit exceeded on ${surface}: ${limit}`);
    this.name = "ConfigRateLimitedError";
  }
}

export const EDITION_GATED_PATHS: ReadonlySet<string> = new Set(["guardrail", "hitl", "voting"]);
