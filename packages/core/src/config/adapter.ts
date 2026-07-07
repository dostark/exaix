/**
 * @module CoreConfigAdapter
 * @path packages/core/src/config/adapter.ts
 * @description IConfigAdapter interface, helper types, and resolution algorithm for the configurable() system.
 * @architectural-layer Core
 * @dependencies ["@exaix/core/config/errors", "@exaix/core/types/enums"]
 * @related-files ["packages/core/src/config/registry.ts", "packages/core/src/config/db.ts", "packages/core/src/config/errors.ts"]
 */

import type { ConfigAdapterMode, ConfigProvenanceSource } from "../types/enums.ts";
import type { ConfigValue, IConfigOverrideEntry } from "./db.ts";

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
