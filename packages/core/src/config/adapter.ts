/**
 * @module CoreConfigAdapter
 * @path packages/core/src/config/adapter.ts
 * @description IConfigAdapter interface, DirectConfigAdapter implementation, helper types,
 *   resolution algorithm, and createConfigAdapter factory function.
 * @architectural-layer Core
 * @dependencies ["@exaix/core/config/errors", "@exaix/core/types/enums", "@exaix/core/config/db", "@exaix/core/config/registry"]
 * @related-files ["packages/core/src/config/registry.ts", "packages/core/src/config/db.ts", "packages/core/src/config/errors.ts"]
 */

import { Database } from "@db/sqlite";
import { ConfigAdapterMode, ConfigProvenanceSource, ConfigValueType } from "../types/enums.ts";
import type { ConfigValue, IConfigOverrideEntry } from "./db.ts";
import { getAllEffectiveValues, getEffectiveValue, getOverrideHistory, insertOverride } from "./db.ts";
import { getRegisteredDefaults } from "./registry.ts";
import type { IConfigurableOpts } from "./registry.ts";
import { ConfigKeyNotFoundError, ConfigValidationError, EDITION_GATED_PATHS } from "./errors.ts";

/**
 * Report returned by validate() and validateAtPath().
 */
export interface IConfigValidationReport {
  valid: boolean;
  issues: Array<{ path: string; message: string; code: string }>;
}

/**
 * Report returned by diff() — compares effective values against registry defaults.
 */
export interface IConfigDiffReport {
  overridden: Array<{ path: string; current: ConfigValue; default: ConfigValue }>;
  added: Array<{ path: string; value: ConfigValue }>;
  missing: Array<{ path: string; default: ConfigValue }>;
}

/**
 * Provenance entry for a config value — where it was resolved from.
 */
export interface IConfigProvenanceEntry {
  value: ConfigValue;
  source: ConfigProvenanceSource;
  sourceDetail?: string;
}

/**
 * A single override entry returned by listOverrides().
 */
export interface IOverrideEntry {
  key: string;
  value: ConfigValue;
  swap_class: string;
}

/**
 * Config adapter that wraps the Config DB and registry.
 *
 * Resolution order (get):
 * 1. Config DB: SELECT value FROM config_overrides WHERE key=? ORDER BY id DESC LIMIT 1
 *    If non-NULL → return
 * 2. Registry: getRegisteredDefaults().get(key)
 *    If found → return resolved default
 * 3. Schema: resolveSchemaDefault(ConfigSchema, key)
 *    If found → return schema default
 * 4. Return undefined
 *
 * Set algorithm (set):
 * 1. Validate: check key exists in registry or schema
 * 2. Validate: check value against registry metadata (type, min, max, enum)
 *    or ConfigSchema sub-schema
 * 3. Validate: check edition gate (EDITION_GATED_PATHS)
 * 4. INSERT INTO config_overrides (key, value, source, swap_class)
 * 5. If mode="daemon" and swap=="hot": apply to in-memory store (no-op in Phase 0)
 * 6. Log DomainEventType.ConfigUpdated
 *
 * Unset algorithm (unset):
 * 1. INSERT INTO config_overrides (key, value=NULL, source='cli', swap_class='hot')
 *    The next get() resolves through to registry/schema default.
 */
export interface IConfigAdapter {
  /** Get the effective value at path (DB → registry → schema → undefined). */
  get<T = ConfigValue>(key: string): T | undefined;

  /** Validate then append an override row. */
  set(key: string, value: ConfigValue, options?: { swap_class?: string }): Promise<void>;

  /** Revert to default by inserting a NULL row. */
  unset(key: string): Promise<void>;

  /** Return all keys where the latest row has a non-NULL value. */
  listOverrides(): IOverrideEntry[];

  /** Validate all registered keys against their constraints. */
  validate(): IConfigValidationReport;

  /** Validate a single path against registry metadata and/or ConfigSchema. */
  validateAtPath(path: string, value: ConfigValue): IConfigValidationReport;

  /** Compare effective values against registry defaults. */
  diff(): IConfigDiffReport;

  /** Trace a value's origin (db → registry → schema → bootstrap). */
  getProvenance(path: string): IConfigProvenanceEntry;

  /** Full override history for a key (append-only log, DESC by id). */
  getHistory(key: string): IConfigOverrideEntry[];

  /** Whether the adapter is in direct (offline) or daemon mode. */
  readonly mode: ConfigAdapterMode;
}

/**
 * Coerce a DB string value to the native type expected by registry metadata.
 */
function coerceDbValue(
  rawValue: ConfigValue,
  registeredOpts: IConfigurableOpts | undefined,
): ConfigValue {
  if (rawValue === null) return null;
  if (typeof rawValue !== "string") return rawValue;
  if (!registeredOpts) return rawValue;
  if (registeredOpts.type === ConfigValueType.NUMBER) {
    const n = Number(rawValue);
    return Number.isNaN(n) ? rawValue : n;
  }
  if (registeredOpts.type === ConfigValueType.BOOLEAN) {
    return rawValue === "true";
  }
  return rawValue;
}

function checkType(
  path: string,
  value: ConfigValue,
  type: ConfigValueType,
): { path: string; message: string; code: string } | null {
  switch (type) {
    case ConfigValueType.NUMBER:
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { path, message: `Expected number, got ${typeof value}`, code: "TYPE_MISMATCH" };
      }
      break;
    case ConfigValueType.BOOLEAN:
      if (typeof value !== "boolean") {
        return { path, message: `Expected boolean, got ${typeof value}`, code: "TYPE_MISMATCH" };
      }
      break;
    case ConfigValueType.STRING:
      if (typeof value !== "string") {
        return { path, message: `Expected string, got ${typeof value}`, code: "TYPE_MISMATCH" };
      }
      break;
  }
  return null;
}

function checkEditionGate(path: string): { path: string; message: string; code: string } | null {
  for (const gatePrefix of EDITION_GATED_PATHS) {
    if (path.startsWith(gatePrefix)) {
      return {
        path,
        message: `Key "${path}" is edition-gated by path prefix "${gatePrefix}"`,
        code: "EDITION_GATED",
      };
    }
  }
  return null;
}

/**
 * Validate a single value against registry metadata.
 */
function validateAgainstMetadata(
  path: string,
  value: ConfigValue,
  opts: IConfigurableOpts,
): IConfigValidationReport {
  const issues: Array<{ path: string; message: string; code: string }> = [];

  const typeIssue = checkType(path, value, opts.type);
  if (typeIssue) {
    issues.push(typeIssue);
    return { valid: false, issues };
  }

  if (typeof value === "number") {
    if (opts.min !== undefined && value < opts.min) {
      issues.push({ path, message: `Value ${value} is below minimum ${opts.min}`, code: "BELOW_MINIMUM" });
    }
    if (opts.max !== undefined && value > opts.max) {
      issues.push({ path, message: `Value ${value} exceeds maximum ${opts.max}`, code: "ABOVE_MAXIMUM" });
    }
  }

  if (opts.enum && opts.enum.length > 0) {
    if (!opts.enum.includes(value as string | number)) {
      issues.push({
        path,
        message: `Value "${value}" is not in allowed values: [${opts.enum.join(", ")}]`,
        code: "NOT_IN_ENUM",
      });
    }
  }

  const gateIssue = checkEditionGate(path);
  if (gateIssue) issues.push(gateIssue);

  return { valid: issues.length === 0, issues };
}

/**
 * DirectConfigAdapter — reads/writes Config DB directly (offline mode).
 * Opens its own @db/sqlite connection to .exa/config.db.
 */
export class DirectConfigAdapter implements IConfigAdapter {
  private db: Database;
  readonly mode: ConfigAdapterMode;

  constructor(
    dbPath: string,
    mode?: ConfigAdapterMode,
  ) {
    this.db = new Database(dbPath);
    this.mode = mode ?? ConfigAdapterMode.DIRECT;
  }

  get<T = ConfigValue>(key: string): T | undefined {
    // 1. Check DB for override
    const dbValue = getEffectiveValue(this.db, key);
    if (dbValue !== null) {
      const registered = getRegisteredDefaults().get(key);
      return coerceDbValue(dbValue, registered?.opts) as T;
    }

    // 2. Check registry for default
    const registered = getRegisteredDefaults().get(key);
    if (registered) {
      return registered.opts.default as T;
    }

    // 3. Schema check (not yet implemented)
    // 4. Return undefined
    return undefined;
  }

  set(
    key: string,
    value: ConfigValue,
    options: { swap_class?: string } = {},
  ): Promise<void> {
    // Validate key exists in registry
    const registered = getRegisteredDefaults().get(key);
    if (!registered) {
      throw new ConfigKeyNotFoundError(key);
    }

    // Validate value against metadata
    const report = this.validateAtPath(key, value);
    if (!report.valid) {
      throw new ConfigValidationError(
        key,
        report.issues.map((i) => i.message).join("; "),
      );
    }

    const swapClass = options?.swap_class ?? "hot";
    insertOverride(this.db, key, value, "cli", swapClass);
    return Promise.resolve();
  }

  unset(key: string): Promise<void> {
    insertOverride(this.db, key, null, "cli", "hot");
    return Promise.resolve();
  }

  listOverrides(): IOverrideEntry[] {
    const allValues = getAllEffectiveValues(this.db);
    const result: IOverrideEntry[] = [];
    for (const [key, rawValue] of allValues) {
      if (rawValue !== null) {
        const registered = getRegisteredDefaults().get(key);
        const coerced = coerceDbValue(rawValue, registered?.opts);
        result.push({ key, value: coerced, swap_class: "hot" });
      }
    }
    return result;
  }

  validate(): IConfigValidationReport {
    const allIssues: Array<{
      path: string;
      message: string;
      code: string;
    }> = [];

    for (const [key] of getRegisteredDefaults()) {
      const value = this.get(key);
      if (value !== undefined) {
        const report = this.validateAtPath(key, value as ConfigValue);
        if (!report.valid) {
          allIssues.push(...report.issues);
        }
      }
    }

    return { valid: allIssues.length === 0, issues: allIssues };
  }

  validateAtPath(
    path: string,
    value: ConfigValue,
  ): IConfigValidationReport {
    const registered = getRegisteredDefaults().get(path);
    if (registered) {
      return validateAgainstMetadata(path, value, registered.opts);
    }

    return {
      valid: true,
      issues: [],
    };
  }

  diff(): IConfigDiffReport {
    const overridden: Array<{
      path: string;
      current: ConfigValue;
      default: ConfigValue;
    }> = [];
    const added: Array<{ path: string; value: ConfigValue }> = [];
    const missing: Array<{ path: string; default: ConfigValue }> = [];

    for (const [key, registered] of getRegisteredDefaults()) {
      const effective = this.get(key);
      const defaultValue = registered.opts.default;
      if (effective !== defaultValue) {
        overridden.push({
          path: key,
          current: effective as ConfigValue,
          default: defaultValue as ConfigValue,
        });
      }
    }

    return { overridden, added, missing };
  }

  getProvenance(path: string): IConfigProvenanceEntry {
    // 1. Check DB for override
    const dbValue = getEffectiveValue(this.db, path);
    if (dbValue !== null) {
      return {
        value: dbValue,
        source: ConfigProvenanceSource.DB,
      };
    }

    // 2. Check registry
    const registered = getRegisteredDefaults().get(path);
    if (registered) {
      return {
        value: registered.opts.default as ConfigValue,
        source: ConfigProvenanceSource.REGISTRY,
      };
    }

    // 3. Bootstrap path detection
    if (path.startsWith("system.")) {
      return {
        value: null,
        source: ConfigProvenanceSource.BOOTSTRAP,
      };
    }

    return {
      value: null,
      source: ConfigProvenanceSource.SCHEMA_DEFAULT,
    };
  }

  getHistory(key: string): IConfigOverrideEntry[] {
    return getOverrideHistory(this.db, key);
  }
}

/**
 * Factory function — creates a DirectConfigAdapter from a config DB path.
 * In Phase 1, this will detect whether the daemon is running and return the
 * appropriate adapter.
 */
export function createConfigAdapter(
  configDbPath: string,
  mode: ConfigAdapterMode = ConfigAdapterMode.DIRECT,
): IConfigAdapter {
  return new DirectConfigAdapter(configDbPath, mode);
}
