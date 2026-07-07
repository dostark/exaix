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

export const EDITION_GATED_PATHS: ReadonlySet<string> = new Set(["guardrail", "hitl", "voting"]);
