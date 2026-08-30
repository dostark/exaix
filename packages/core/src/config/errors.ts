/**
 * @module ConfigErrors
 * @path packages/core/src/config/errors.ts
 * @description Error classes and constants for the config system — ConfigKeyNotFoundError,
 *   ConfigValidationError, ConfigWriteError, and EDITION_GATED_PATHS set.
 * @architectural-layer Core
 * @related-files ["packages/core/src/config/registry.ts"]
 */
import type { Opt, Reason } from "../types/optional_marker.ts";
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
  constructor(key: string, cause?: Opt<IConfigWriteCause, Reason.OptionalContext>) {
    const msg = `Failed to write configuration key '${key}'`;
    super(cause ? `${msg}: ${cause.message}` : msg);
    this.name = "ConfigWriteError";
    if (cause instanceof Error) this.cause = cause;
  }
}

/** Thrown when an MCP config write targets a path in config_mcp_blocklist. */
export class ConfigPathBlockedError extends Error {
  constructor(key: string, reason?: Opt<string, Reason.OptionalContext>) {
    super(`Config path "${key}" is blocked from MCP writes${reason ? `: ${reason}` : ""}`);
    this.name = "ConfigPathBlockedError";
  }
}

/** Thrown when a config write exceeds a rate limit: CLI debounce, MCP pending cap, or DB page hard-limit. */
export class ConfigRateLimitedError extends Error {
  constructor(surface: string, limit: string) {
    super(`Config rate limit exceeded on ${surface}: ${limit}`);
    this.name = "ConfigRateLimitedError";
  }
}

/**
 * Thrown by adapter.set() (via assertWritable) for a write to a key in config_locked_keys.
 * A locked key is refused by every write surface — CLI, MCP, daemon — until `config unlock`.
 */
export class ConfigKeyLockedError extends Error {
  constructor(key: string, reason?: Opt<string, Reason.OptionalContext>) {
    super(`Config key "${key}" is locked${reason ? `: ${reason}` : ""}`);
    this.name = "ConfigKeyLockedError";
  }
}

export const EDITION_GATED_PATHS: ReadonlySet<string> = new Set(["guardrail", "hitl", "voting"]);
