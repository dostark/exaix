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
import type { ConfigValue, IConfigOverrideEntry } from "./db.ts";
import { getAllEffectiveValues, getEffectiveValue, getOverrideHistory, insertOverride } from "./db.ts";
import { getRegisteredDefaults } from "./registry.ts";
import type { IConfigurableOpts } from "./registry.ts";
import type { InMemoryConfigStore } from "./store.ts";
import { ConfigKeyNotFoundError, ConfigValidationError, EDITION_GATED_PATHS } from "./errors.ts";
import type { IEventLogger } from "@exaix/core/logger";
import { DomainEventType } from "@exaix/core/events";
import type { Opt, Reason } from "../types/optional_marker.ts";
import { CONFIG_PATTERN_WILDCARD, CONFIG_PROFILE_KEY_PREFIX } from "../types/constants.ts";

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

  /**
   * Resolve the registry key whose metadata governs validation of `key`
   * (exact, `profile.<name>.<base>` → base, or a matching pattern key), or
   * undefined for genuinely unknown keys.
   */
  resolveValidationKey(key: string): string | undefined;

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

/**
 * Whether a concrete key matches a registered pattern key. A pattern key
 * contains the wildcard segment (`*`) which matches exactly one dot-delimited
 * segment — e.g. `models.*.model` matches `models.default.model` but not
 * `models.default.foo.model`.
 */
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

/**
 * DirectConfigAdapter — reads/writes Config DB directly (offline mode).
 * Opens its own @db/sqlite connection to .exa/config.db.
 */
export class DirectConfigAdapter implements IConfigAdapter {
  protected db: Database;
  protected daemonLogger?: IEventLogger;
  private adapterMode: ConfigAdapterMode;

  constructor(
    dbPath: string,
    mode?: ConfigAdapterMode,
    logger?: Opt<IEventLogger, Reason.OptionalDependency>,
  ) {
    this.db = new Database(dbPath);
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
    insertOverride(this.db, key, value, "cli", swapClass);
    await this.daemonLogger?.info(DomainEventType.ConfigUpdated, key, {
      value,
      source: "cli",
      swap_class: swapClass,
    });
  }

  /**
   * Resolve the registry key whose metadata governs validation of `key`:
   * 1. Exact registered key → itself.
   * 2. `profile.<name>.<base>` → `<base>` if registered.
   * 3. A concrete key matching a registered pattern key (`a.*.b` / `a.*`) →
   *    that pattern key.
   * 4. Otherwise `undefined` (caller rejects with ConfigKeyNotFoundError).
   */
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
    insertOverride(this.db, key, null, "cli", "hot");
    await this.daemonLogger?.info(DomainEventType.ConfigUpdated, key, {
      value: null,
      source: "cli",
      swap_class: "hot",
    });
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
}

/**
 * Read a PID from a file. Returns undefined if the file does not exist or
 * contains an invalid number.
 */
export function readPidFile(pidPath: string): number | undefined {
  try {
    const content = Deno.readTextFileSync(pidPath);
    const pid = Number.parseInt(content.trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * DaemonConfigAdapter — reads from InMemoryConfigStore (daemon's live cache)
 * and writes through to the Config DB. For hot-swappable keys the in-memory
 * store is updated immediately; restart-required keys are persisted to DB only.
 *
 * Construct with an existing @db/sqlite Database handle (the same one opened
 * by the daemon boot in Step 3) so all db.ts helpers share the connection.
 */
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

    const report = this.validateAtPath(key, value);
    if (!report.valid) {
      throw new ConfigValidationError(
        key,
        report.issues.map((i) => i.message).join("; "),
      );
    }

    const swapClass = options?.swap_class ?? SwapClass.HOT;
    const source = ConfigAdapterMode.DAEMON;
    insertOverride(this.db, key, value, source, swapClass);

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
    insertOverride(this.db, key, null, ConfigAdapterMode.DAEMON, "hot");
    this.configStore.delete(key);
    await this.daemonLogger?.info(DomainEventType.ConfigUpdated, key, {
      value: null,
      source: ConfigAdapterMode.DAEMON,
    });
  }

  override get mode(): ConfigAdapterMode {
    return ConfigAdapterMode.DAEMON;
  }

  /**
   * Access the underlying in-memory config store for direct manipulation
   * (e.g. population at daemon boot).
   */
  get store(): InMemoryConfigStore {
    return this.configStore;
  }
}

/**
 * Check whether a process is alive via `kill -0` (sends no signal, only checks
 * existence/permission). Core-local so the config layer does not depend on the
 * CLI package. Returns false on any error (dead pid, no permission, no `kill`).
 */
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

/**
 * Factory — creates a DirectConfigAdapter or DaemonConfigAdapter.
 *
 * SYNCHRONOUS contract (this function): the daemon branch is selected only when
 * the caller explicitly supplies both `store` and `db` AND a PID file EXISTS.
 * It does NOT verify the PID is alive (liveness needs an async `kill -0`); a stale
 * PID file therefore still selects the daemon adapter. Callers that need true
 * liveness (e.g. a CLI attaching to a possibly-dead daemon) must use the async
 * {@link createConfigAdapterAsync}. When `store`/`db` are omitted or no PID file
 * exists, a DirectConfigAdapter is returned. NOTE: the daemon process itself does
 * NOT use this factory for self-detection — it constructs DaemonConfigAdapter
 * directly at boot (apps/daemon/main.ts), so this path only serves external callers.
 */
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

/**
 * Async factory — like {@link createConfigAdapter} but VERIFIES the PID is a live
 * process (`kill -0`) before selecting the daemon adapter. A stale PID file falls
 * back to DirectConfigAdapter. Use this from external callers (CLI/MCP) that may be
 * attaching to a daemon that has since exited.
 */
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
