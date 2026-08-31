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
import { ConfigAdapterMode, ConfigProvenanceSource, ConfigValueType, SwapClass } from "../types/enums.ts";
import type { ConfigValue, IBlocklistEntry, IConfigOverrideEntry, ILockedKeyEntry } from "./db.ts";
import {
  addBlocklistPattern,
  compactOverrides,
  CONFIG_SOURCE_INTEGRITY,
  CONFIG_SOURCE_ROLLBACK,
  countRecentCliWrites,
  getAllEffectiveValues,
  getEffectiveValue,
  getOverrideById,
  getOverrideHistory,
  globMatches,
  insertOverride,
  isKeyLocked as dbIsKeyLocked,
  isPathBlocked as dbIsPathBlocked,
  listBlocklistPatterns,
  listLockedKeys,
  lockKey,
  migrateConfigDb,
  removeBlocklistPattern,
  unlockKey,
} from "./db.ts";
import { encodeHex } from "@std/encoding/hex";
import { crypto } from "@std/crypto";
import { getRegisteredDefaults } from "./registry.ts";
import type { IConfigurableOpts } from "./registry.ts";
import type { InMemoryConfigStore } from "./store.ts";
import { ConfigKeyLockedError, ConfigKeyNotFoundError, ConfigValidationError, EDITION_GATED_PATHS } from "./errors.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { Opt, Reason } from "../types/optional_marker.ts";
import { CONFIG_CHECKSUM_KEY, CONFIG_PATTERN_WILDCARD, CONFIG_PROFILE_KEY_PREFIX } from "../types/constants.ts";

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

// Typed config event payloads
// Unlike ConfigUpdated (which passes inline literals), these are named interfaces so
// consumers can assert on payload fields by type.

/** Payload for DomainEventType.ConfigRolledBack. */
export interface IConfigRollbackPayload {
  key: string;
  to_id: number;
  restored_value: ConfigValue;
}

/** Payload for DomainEventType.ConfigKeyLocked / ConfigKeyUnlocked. */
export interface IConfigLockPayload {
  key: string;
  locked_by: string;
  reason?: string | null;
}

/** Payload for DomainEventType.ConfigIntegrityVerified / ConfigIntegrityMismatch. */
export interface IConfigIntegrityPayload {
  /** Present on a verified match (the confirmed checksum). */
  checksum?: string;
  /** Present on a mismatch (the previously stored value). */
  stored?: string;
  /** Present on a mismatch (the freshly computed value). */
  computed?: string;
}

/** Result of verifyIntegrity(). */
export interface IIntegrityResult {
  /** True when the stored checksum matches a fresh compute (or on first-run seed). */
  ok: boolean;
  /** The previously stored checksum (undefined on first-run seed). */
  stored?: string;
  /** The freshly computed checksum. */
  computed: string;
}

/** Config adapter wrapping the Config DB and registry: get() resolves DB override → registry
 * default → schema default → undefined; set() validates against registry/schema metadata and
 * edition gates before inserting a row; unset() reverts to default via a NULL row. */
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

  /** Resolves the registry key whose metadata governs validation of `key` (exact,
   * `profile.<name>.<base>` → base, or a matching pattern key); undefined for unknown keys. */
  resolveValidationKey(key: string): string | undefined;

  /** Compare effective values against registry defaults. */
  diff(): IConfigDiffReport;

  /** Trace a value's origin (db → registry → schema → bootstrap). */
  getProvenance(path: string): IConfigProvenanceEntry;

  /** Full override history for a key (append-only log, DESC by id). */
  getHistory(key: string): IConfigOverrideEntry[];

  /** Appends a row reverting `key` to the value at history row `id` (source="rollback"),
   * emitting ConfigRolledBack. Throws ConfigKeyNotFoundError if the (key, id) pair is absent. */
  rollback(key: string, id: number): Promise<ConfigValue>;

  /** Lock a key against all writes (CLI/MCP/daemon). Idempotent. */
  lock(key: string, lockedBy: string, reason?: Opt<string, Reason.OptionalInput>): void;

  /** Unlock a previously locked key. Idempotent. Takes the caller-supplied actor, mirroring
   *  lock(), instead of a hardcoded internal value. */
  unlock(key: string, unlockedBy: string): void;

  /** True if `key` is in config_locked_keys — checked inside set(). */
  isLocked(key: string): boolean;

  /** List all locked keys, newest first. */
  listLocks(): ILockedKeyEntry[];

  /** SHA-256 over the sorted effective config (DB-sourced, excluding the synthetic `_checksum`
   * key); deterministic for a given config state. */
  computeIntegrityChecksum(): string;

  /** Compares the stored `_checksum` to a fresh compute; seeds and returns `ok:true` on first
   * run, emits ConfigIntegrityVerified on match and ConfigIntegrityMismatch on an out-of-band edit. */
  verifyIntegrity(): Promise<IIntegrityResult>;

  /** True if `key` is in the MCP deny-permanently blocklist for `agentId`; a NULL-agent
   * block applies to all agents. */
  isPathBlocked(key: string, agentId?: Opt<string, Reason.QueryFilter>): boolean;

  /** The block reason for a blocked `key`, if any (undefined when not blocked). */
  getBlockReason(key: string, agentId?: Opt<string, Reason.QueryFilter>): string | undefined;

  /** Add a deny-permanently blocklist pattern (admin/CLI). */
  addBlock(
    pattern: string,
    reason?: Opt<string, Reason.OptionalInput>,
    agentId?: Opt<string, Reason.QueryFilter>,
  ): void;

  /** Remove a blocklist pattern (admin/CLI). */
  removeBlock(pattern: string, agentId?: Opt<string, Reason.QueryFilter>): void;

  /** List all blocklist patterns, newest first. */
  listBlocks(): IBlocklistEntry[];

  /** Counts `cli`-source writes within the last `windowMs` ms; DB-backed so the debounce
   * survives across separate CLI processes. */
  countRecentWrites(windowMs: number): number;

  /** Compacts config_overrides to one row per key (latest), preserving effective values —
   * a hard-limit escape hatch for unbounded override-history growth. Returns rows removed. */
  compact(): number;

  /** Whether the adapter is in direct (offline) or daemon mode. */
  readonly mode: ConfigAdapterMode;
}

/**
 * Coerce a DB string value to the native type expected by registry metadata.
 */
function coerceDbValue(
  rawValue: ConfigValue,
  registeredOpts: Opt<IConfigurableOpts, Reason.OptionalInput>,
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

/** Whether a concrete key matches a registered pattern key. A pattern key contains the
 *  wildcard segment (`*`) which matches exactly one dot-delimited segment — e.g.
 *  `models.*.model` matches `models.default.model` but not `models.default.foo.model`. */
function matchesPatternKey(patternKey: string, key: string): boolean {
  const patternParts = patternKey.split(".");
  const keyParts = key.split(".");
  if (patternParts.length !== keyParts.length) return false;
  return patternParts.every(
    (part, i) => part === CONFIG_PATTERN_WILDCARD || part === keyParts[i],
  );
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

/** DirectConfigAdapter — reads/writes Config DB directly (offline mode); opens its own
 *  @db/sqlite connection to .exa/config.db. */
export class DirectConfigAdapter implements IConfigAdapter {
  protected db: Database;
  protected daemonLogger?: IEventLogger;
  private adapterMode: ConfigAdapterMode;

  constructor(
    dbPath: string,
    mode?: Opt<ConfigAdapterMode, Reason.SensibleDefault>,
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    this.db = new Database(dbPath);
    // The daemon migrates the Config DB at boot, but external callers (e.g. `exactl config
    // get|diff|validate`) may open a root it never touched. Idempotent (CREATE TABLE IF NOT
    // EXISTS), so this turns a raw "no such table" error into the registry-default fallback.
    migrateConfigDb(this.db);
    this.adapterMode = mode ?? ConfigAdapterMode.DIRECT;
    this.daemonLogger = logger;
  }

  get mode(): ConfigAdapterMode {
    return this.adapterMode;
  }

  get<T = ConfigValue>(key: string): T | undefined {
    // 1. Check DB for override. Coerce using the key that owns the type metadata
    //    — for profile/pattern keys that is the resolved base/pattern key.
    const dbValue = getEffectiveValue(this.db, key);
    if (dbValue !== null) {
      const metadataKey = this.resolveValidationKey(key) ?? key;
      const registered = getRegisteredDefaults().get(metadataKey);
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

  async set(
    key: string,
    value: ConfigValue,
    options: Opt<{ swap_class?: string }, Reason.SensibleDefault> = {},
  ): Promise<void> {
    // Resolve the key that owns the validation metadata: the exact key if
    // registered, the base key for a profile-scoped key, or a matching pattern
    // key. Genuinely unknown keys resolve to undefined → reject.
    const validationKey = this.resolveValidationKey(key);
    if (validationKey === undefined) {
      throw new ConfigKeyNotFoundError(key);
    }

    // Refuse writes to a locked key (shared guard, no blocklist dependency). Uses the
    // resolved validation key so a lock on the base key also covers profile-scoped and
    // pattern-keyed writes.
    this.assertWritable(validationKey);

    // Validate value against the resolved key's metadata.
    const report = this.validateAtPath(key, value);
    if (!report.valid) {
      throw new ConfigValidationError(
        key,
        report.issues.map((i) => i.message).join("; "),
      );
    }

    // Persist under the ORIGINAL key (profile/per-name keys keep their full path).
    const swapClass = options?.swap_class ?? SwapClass.HOT;
    insertOverride(this.db, key, value, "cli", swapClass, { logger: this.daemonLogger });
    this.persistChecksum();
    await this.daemonLogger?.info(DomainEventType.ConfigUpdated, key, {
      value,
      source: "cli",
      swap_class: swapClass,
    });
  }

  /** Resolves the registry key whose metadata governs validation of `key`: an exact
   *  registered key maps to itself; `profile.<name>.<base>` maps to `<base>` if
   *  registered; a key matching a registered pattern key (`a.*.b`/`a.*`) maps to that pattern key; otherwise `undefined` (caller rejects with ConfigKeyNotFoundError). */
  resolveValidationKey(key: string): string | undefined {
    const registry = getRegisteredDefaults();

    // 1. Exact match.
    if (registry.has(key)) return key;

    // 2. profile.<name>.<base> → base key.
    if (key.startsWith(CONFIG_PROFILE_KEY_PREFIX)) {
      const rest = key.slice(CONFIG_PROFILE_KEY_PREFIX.length);
      const dotIdx = rest.indexOf(".");
      if (dotIdx > 0) {
        const baseKey = rest.slice(dotIdx + 1);
        if (registry.has(baseKey)) return baseKey;
      }
      return undefined;
    }

    // 3. Pattern key match (registered key contains the wildcard segment).
    for (const [registeredKey] of registry) {
      if (registeredKey.includes(CONFIG_PATTERN_WILDCARD) && matchesPatternKey(registeredKey, key)) {
        return registeredKey;
      }
    }

    return undefined;
  }

  async unset(key: string): Promise<void> {
    // Enforce the same registry-existence contract as set()
    if (!getRegisteredDefaults().has(key)) {
      throw new ConfigKeyNotFoundError(key);
    }
    insertOverride(this.db, key, null, "cli", SwapClass.HOT, { logger: this.daemonLogger });
    this.persistChecksum();
    await this.daemonLogger?.info(DomainEventType.ConfigUpdated, key, {
      value: null,
      source: "cli",
      swap_class: SwapClass.HOT,
    });
  }

  listOverrides(): IOverrideEntry[] {
    const allValues = getAllEffectiveValues(this.db);
    const result: IOverrideEntry[] = [];
    for (const [key, rawValue] of allValues) {
      // The synthetic integrity checksum is never a user override.
      if (key === CONFIG_CHECKSUM_KEY) continue;
      if (rawValue !== null) {
        const registered = getRegisteredDefaults().get(key);
        const coerced = coerceDbValue(rawValue, registered?.opts);
        result.push({ key, value: coerced, swap_class: SwapClass.HOT });
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
      // Skip edition-gated keys during validation — the gate is a write-time
      // authorization check, not a schema validity concern.
      const rootSegment = key.split(".")[0];
      if (rootSegment && EDITION_GATED_PATHS.has(rootSegment)) continue;

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
    // Resolve namespaced keys (profile.*, pattern keys) to the key that owns
    // the validation metadata; genuinely unknown keys have no metadata.
    const validationKey = this.resolveValidationKey(path);
    if (validationKey !== undefined) {
      const registered = getRegisteredDefaults().get(validationKey);
      if (registered) {
        // Report issues against the caller's original path, not the metadata key.
        return validateAgainstMetadata(path, value, registered.opts);
      }
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

    // Iterates registered keys only; the synthetic `_checksum` is unregistered so it is
    // structurally excluded from diff — no filter needed.
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
      const registered = getRegisteredDefaults().get(path);
      return {
        value: coerceDbValue(dbValue, registered?.opts),
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

  async rollback(key: string, id: number): Promise<ConfigValue> {
    const row = getOverrideById(this.db, key, id);
    if (row === undefined) {
      throw new ConfigKeyNotFoundError(`${key}#${id}`);
    }
    // Append a new row restoring the historical value (append-only, not a
    // mutation). Preserve the historical swap_class so a restart-key rollback
    // stays a restart key.
    insertOverride(this.db, key, row.value, CONFIG_SOURCE_ROLLBACK, row.swap_class, {
      logger: this.daemonLogger,
    });
    this.persistChecksum();
    const payload: IConfigRollbackPayload = { key, to_id: id, restored_value: row.value };
    await this.daemonLogger?.info(DomainEventType.ConfigRolledBack, key, { ...payload });
    return row.value;
  }

  /** Shared pre-write guard, called at the top of BOTH DirectConfigAdapter.set() and the
   *  DaemonConfigAdapter.set() override so a locked key is un-writable through every
   *  surface — CLI, MCP, and the live daemon. Throws ConfigKeyLockedError. */
  protected assertWritable(key: string): void {
    if (dbIsKeyLocked(this.db, key)) {
      throw new ConfigKeyLockedError(key);
    }
  }

  lock(key: string, lockedBy: string, reason?: Opt<string, Reason.OptionalInput>): void {
    lockKey(this.db, key, lockedBy, reason);
    this.daemonLogger?.info(DomainEventType.ConfigKeyLocked, key, { key, locked_by: lockedBy, reason });
  }

  unlock(key: string, unlockedBy: string): void {
    unlockKey(this.db, key);
    this.daemonLogger?.info(DomainEventType.ConfigKeyUnlocked, key, { key, locked_by: unlockedBy });
  }

  isLocked(key: string): boolean {
    return dbIsKeyLocked(this.db, key);
  }

  listLocks(): ILockedKeyEntry[] {
    return listLockedKeys(this.db);
  }

  // Integrity checksum

  /** SHA-256 over the sorted effective config. DB-sourced via getAllEffectiveValues, never the in-memory store, so
   *  on a DaemonConfigAdapter the checksum still reflects the persisted DB an out-of-band edit mutates. The synthetic
   *  `_checksum` key is excluded so the checksum never hashes its own previous value (a fixed-point/instability bug). */
  computeIntegrityChecksum(): string {
    const effective = getAllEffectiveValues(this.db);
    const keys = [...effective.keys()].filter((k) => k !== CONFIG_CHECKSUM_KEY).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const value = effective.get(key);
      if (value === null || value === undefined) continue;
      parts.push(`${key}||${String(value)}`);
    }
    const data = new TextEncoder().encode(parts.join("\n"));
    return encodeHex(crypto.subtle.digestSync("SHA-256", data));
  }

  /** Refreshes the stored `_checksum` row from the current DB state. Called at the end of
   *  every adapter write path so legitimate writes never trip a mismatch. */
  protected persistChecksum(): void {
    insertOverride(
      this.db,
      CONFIG_CHECKSUM_KEY,
      this.computeIntegrityChecksum(),
      CONFIG_SOURCE_INTEGRITY,
      SwapClass.HOT,
    );
  }

  async verifyIntegrity(): Promise<IIntegrityResult> {
    const computed = this.computeIntegrityChecksum();
    const stored = getEffectiveValue(this.db, CONFIG_CHECKSUM_KEY);
    // First run: no stored checksum yet — seed it and report ok.
    if (stored === null) {
      this.persistChecksum();
      const payload: IConfigIntegrityPayload = { checksum: computed };
      await this.daemonLogger?.info(DomainEventType.ConfigIntegrityVerified, CONFIG_CHECKSUM_KEY, { ...payload });
      return { ok: true, computed };
    }
    const ok = stored === computed;
    if (ok) {
      const payload: IConfigIntegrityPayload = { checksum: computed };
      await this.daemonLogger?.info(DomainEventType.ConfigIntegrityVerified, CONFIG_CHECKSUM_KEY, { ...payload });
    } else {
      const payload: IConfigIntegrityPayload = { stored: String(stored), computed };
      await this.daemonLogger?.warn(DomainEventType.ConfigIntegrityMismatch, CONFIG_CHECKSUM_KEY, { ...payload });
    }
    return { ok, stored: String(stored), computed };
  }

  isPathBlocked(key: string, agentId?: Opt<string, Reason.QueryFilter>): boolean {
    return dbIsPathBlocked(this.db, key, agentId);
  }

  getBlockReason(
    key: string,
    agentId?: Opt<string, Reason.QueryFilter>,
  ): string | undefined {
    if (!dbIsPathBlocked(this.db, key, agentId)) return undefined;
    // Return the reason of the first matching pattern (NULL-agent or this agent).
    for (const entry of listBlocklistPatterns(this.db)) {
      if (entry.agent_id !== null && entry.agent_id !== agentId) continue;
      if (globMatches(entry.key_pattern, key)) return entry.reason ?? undefined;
    }
    return undefined;
  }

  addBlock(
    pattern: string,
    reason?: Opt<string, Reason.OptionalInput>,
    agentId?: Opt<string, Reason.QueryFilter>,
  ): void {
    addBlocklistPattern(this.db, pattern, reason, agentId);
  }

  removeBlock(pattern: string, agentId?: Opt<string, Reason.QueryFilter>): void {
    removeBlocklistPattern(this.db, pattern, agentId);
  }

  listBlocks(): IBlocklistEntry[] {
    return listBlocklistPatterns(this.db);
  }

  countRecentWrites(windowMs: number): number {
    return countRecentCliWrites(this.db, windowMs);
  }

  compact(): number {
    return compactOverrides(this.db);
  }
}

/** Reads a PID from a file. Returns undefined if the file does not exist or contains an
 *  invalid number. */
export function readPidFile(pidPath: string): number | undefined {
  try {
    const content = Deno.readTextFileSync(pidPath);
    const pid = Number.parseInt(content.trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** DaemonConfigAdapter — reads from InMemoryConfigStore (daemon's live cache) and writes through to the Config DB.
 *  For hot-swappable keys the in-memory store is updated immediately; restart-required keys are persisted to DB
 *  only. Construct with an existing @db/sqlite Database handle (the one opened at daemon boot) so db.ts helpers share it. */
export class DaemonConfigAdapter extends DirectConfigAdapter {
  constructor(
    private configStore: InMemoryConfigStore,
    db: Database,
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    // Pass a dummy path — super's db will be replaced by the injected one.
    super("", ConfigAdapterMode.DAEMON, logger);
    this.db = db;
  }

  override get<T = ConfigValue>(key: string): T | undefined {
    // 1. Check in-memory store first (authoritative for the daemon's lifetime)
    const stored = this.configStore.get(key) as T | undefined;
    if (stored !== undefined) return stored;

    // 2. Fall through to registry default
    const registered = getRegisteredDefaults().get(key);
    if (registered) {
      return registered.opts.default as T;
    }

    // 3. Schema check (not yet implemented)
    return undefined;
  }

  override async set(
    key: string,
    value: ConfigValue,
    options: Opt<{ swap_class?: string }, Reason.SensibleDefault> = {},
  ): Promise<void> {
    const validationKey = this.resolveValidationKey(key);
    if (validationKey === undefined) {
      throw new ConfigKeyNotFoundError(key);
    }

    // The daemon's set() is a full override, so the shared lock guard must run here too —
    // inheriting DirectConfigAdapter.set() does NOT cover this path. Use validationKey so
    // profile-scoped writes are also covered.
    this.assertWritable(validationKey);

    const report = this.validateAtPath(key, value);
    if (!report.valid) {
      throw new ConfigValidationError(
        key,
        report.issues.map((i) => i.message).join("; "),
      );
    }

    const swapClass = options?.swap_class ?? SwapClass.HOT;
    const source = ConfigAdapterMode.DAEMON;
    insertOverride(this.db, key, value, source, swapClass, { logger: this.daemonLogger });
    this.persistChecksum();

    // If hot-swappable, apply to in-memory store immediately
    if (swapClass === SwapClass.HOT) {
      this.configStore.set(key, value, SwapClass.HOT);
    }

    // Warn about auth secrets
    if (/api_key|secret|token/i.test(key)) {
      this.daemonLogger?.warn(
        DomainEventType.ConfigUpdated,
        key,
        { value, source, swap_class: swapClass, warn: "auth_secret_plaintext" },
      );
    }

    await this.daemonLogger?.info(DomainEventType.ConfigUpdated, key, {
      value,
      source,
      swap_class: swapClass,
    });
  }

  override async unset(key: string): Promise<void> {
    if (!getRegisteredDefaults().has(key)) {
      throw new ConfigKeyNotFoundError(key);
    }
    insertOverride(this.db, key, null, ConfigAdapterMode.DAEMON, SwapClass.HOT, { logger: this.daemonLogger });
    this.persistChecksum();
    this.configStore.delete(key);
    await this.daemonLogger?.info(DomainEventType.ConfigUpdated, key, {
      value: null,
      source: ConfigAdapterMode.DAEMON,
    });
  }

  override get mode(): ConfigAdapterMode {
    return ConfigAdapterMode.DAEMON;
  }

  /** Access the underlying in-memory config store for direct manipulation (e.g.
   *  population at daemon boot). */
  get store(): InMemoryConfigStore {
    return this.configStore;
  }
}

/** Checks whether a process is alive via `kill -0` (sends no signal, only checks
 *  existence/permission). Core-local so the config layer does not depend on the CLI
 *  package. Returns false on any error (dead pid, no permission, no `kill`). */
export async function isPidAlive(pid: number): Promise<boolean> {
  try {
    const result = await new Deno.Command("kill", {
      args: ["-0", pid.toString()],
      stdout: "null",
      stderr: "null",
    }).output();
    return result.success;
  } catch {
    return false;
  }
}

const DEFAULT_DAEMON_PID_PATH = ".exa/daemon.pid";

/** Factory — creates a DirectConfigAdapter or DaemonConfigAdapter. SYNCHRONOUS: the daemon branch is selected only
 *  when the caller supplies both `store` and `db` AND a PID file EXISTS — it does NOT verify the PID is alive, so a
 *  stale PID file still selects it. Callers needing true liveness must use the async {@link createConfigAdapterAsync}. */
export function createConfigAdapter(
  configDbPath: string,
  mode: Opt<ConfigAdapterMode, Reason.SensibleDefault> = ConfigAdapterMode.DIRECT,
  logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  options?: Opt<{
    daemonPidPath?: string;
    store?: InMemoryConfigStore;
    db?: Database;
  }, Reason.ExecutionConfig>,
): IConfigAdapter {
  if (options?.store && options?.db) {
    const pid = readPidFile(options.daemonPidPath ?? DEFAULT_DAEMON_PID_PATH);
    if (pid !== undefined) {
      return new DaemonConfigAdapter(options.store, options.db, logger);
    }
  }
  return new DirectConfigAdapter(configDbPath, mode, logger);
}

/** Async factory — like {@link createConfigAdapter} but VERIFIES the PID is a live process (`kill -0`) before
 *  selecting the daemon adapter. A stale PID file falls back to DirectConfigAdapter. Use this from external
 *  callers (CLI/MCP) that may be attaching to a daemon that has since exited. */
export async function createConfigAdapterAsync(
  configDbPath: string,
  options?: Opt<{
    daemonPidPath?: string;
    store?: InMemoryConfigStore;
    db?: Database;
    mode?: ConfigAdapterMode;
    logger?: Opt<IEventLogger, Reason.OptionalDependency>;
  }, Reason.ExecutionConfig>,
): Promise<IConfigAdapter> {
  if (options?.store && options?.db) {
    const pid = readPidFile(options.daemonPidPath ?? DEFAULT_DAEMON_PID_PATH);
    if (pid !== undefined && await isPidAlive(pid)) {
      return new DaemonConfigAdapter(options.store, options.db, options.logger);
    }
  }
  return new DirectConfigAdapter(configDbPath, options?.mode ?? ConfigAdapterMode.DIRECT, options?.logger);
}
