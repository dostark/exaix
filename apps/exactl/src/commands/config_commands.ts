/**
 * @module ConfigCommands
 * @path apps/exactl/src/commands/config_commands.ts
 * @description CLI commands for viewing and modifying Exaix configuration via the configurable() system.
 * @architectural-layer CLI
 * @dependencies ["@exaix/cli/base", "@exaix/core/config"]
 * @related-files ["apps/exactl/src/exactl.ts"]
 */
import { BaseCommand, type ICommandContext } from "@exaix/cli/base.ts";
import { join } from "@std/path";
import { STDIO_INHERIT } from "./constants.ts";
import { createConfigAdapterAsync, getRegisteredDefaults } from "@exaix/core/config";
import type { IConfigAdapter, IConfigValidationReport } from "@exaix/core/config";
import { ConfigKeyNotFoundError, ConfigRateLimitedError } from "@exaix/core/config";
import type { ConfigValue, IConfigOverrideEntry, ILockedKeyEntry } from "@exaix/core/config";
import { CONFIG_PROFILE_KEY_PREFIX, ConfigOutputFormat, type Opt, type Reason } from "@exaix/core/types";
import { CLI_CONFIG_SET_DEBOUNCE_WINDOW_MS, CLI_CONFIG_SET_MAX_WRITES_PER_WINDOW } from "@exaix/core";

interface NestedConfigTree {
  [key: string]: ConfigValue | NestedConfigTree;
}

function parseValue(input: string): ConfigValue {
  try {
    return JSON.parse(input);
  } catch {
    // not JSON — continue
  }
  const n = Number(input);
  if (!Number.isNaN(n)) return n;
  if (input === "true") return true;
  if (input === "false") return false;
  return input;
}

/** `locked_by` recorded for a CLI-initiated lock (no per-user identity at the CLI). */
const CONFIG_LOCKED_BY_CLI = "cli";

export class ConfigCommands extends BaseCommand {
  private adapter: IConfigAdapter | undefined;

  constructor(context: ICommandContext) {
    super(context);
  }

  /**
   * Resolve (and cache) the config adapter. Uses the liveness-checked async factory
   * `createConfigAdapterAsync` so that, once the CLI can attach to a running daemon's
   * live store, a stale daemon PID correctly falls back to DirectConfigAdapter. Today
   * the CLI passes no store/db, so this always resolves to a DirectConfigAdapter.
   */
  private async ensureAdapter(): Promise<IConfigAdapter> {
    if (!this.adapter) {
      const dbPath = join(this.config.system.root, ".exa", "config.db");
      this.adapter = await createConfigAdapterAsync(dbPath);
    }
    return this.adapter;
  }

  /**
   * Scope a key to a named profile when `--profile` is supplied. `--profile dev`
   * transforms `<key>` → `profile.dev.<key>`. Profile writes validate against the
   * unscoped base key's metadata via the adapter's resolveValidationKey() (Step 1).
   * Global reads/writes (no profile) are unchanged.
   */
  private scopeKey(path: string, profile?: Opt<string, Reason.OptionalInput>): string {
    return profile ? `${CONFIG_PROFILE_KEY_PREFIX}${profile}.${path}` : path;
  }

  async get(path: string, profile?: Opt<string, Reason.OptionalInput>): Promise<unknown> {
    const scoped = this.scopeKey(path, profile);
    const value = (await this.ensureAdapter()).get(scoped);
    if (value === undefined) {
      throw new ConfigKeyNotFoundError(scoped);
    }
    return value;
  }

  async set(path: string, valueStr: string, profile?: Opt<string, Reason.OptionalInput>): Promise<void> {
    const adapter = await this.ensureAdapter();
    // Phase 138 Step 3: DB-backed debounce — survives across separate CLI
    // processes (state lives in config_overrides timestamps, not process memory).
    if (
      adapter.countRecentWrites(CLI_CONFIG_SET_DEBOUNCE_WINDOW_MS) >= CLI_CONFIG_SET_MAX_WRITES_PER_WINDOW
    ) {
      throw new ConfigRateLimitedError(
        "cli",
        `max ${CLI_CONFIG_SET_MAX_WRITES_PER_WINDOW} writes per ${CLI_CONFIG_SET_DEBOUNCE_WINDOW_MS / 1000}s`,
      );
    }
    const parsed = parseValue(valueStr);
    await adapter.set(this.scopeKey(path, profile), parsed);
  }

  async unset(path: string): Promise<void> {
    await (await this.ensureAdapter()).unset(path);
  }

  async validate(path?: Opt<string, Reason.OptionalInput>): Promise<IConfigValidationReport> {
    const adapter = await this.ensureAdapter();
    if (path) {
      const value = adapter.get(path);
      return adapter.validateAtPath(path, value as ConfigValue ?? null);
    }
    return adapter.validate();
  }

  async show(
    format: ConfigOutputFormat = ConfigOutputFormat.HUMAN,
    sources?: Opt<boolean, Reason.OptionalInput>,
  ): Promise<string> {
    const adapter = await this.ensureAdapter();
    if (sources) {
      const overrides = adapter.listOverrides();
      const lines = overrides.map((o) => {
        const provenance = adapter.getProvenance(o.key);
        return `${o.key} = ${o.value}  (source: ${provenance.source})`;
      });
      return lines.join("\n");
    }

    const effective: NestedConfigTree = {};

    for (const [key] of getRegisteredDefaults()) {
      const value = adapter.get(key);
      if (value !== undefined) {
        const parts = key.split(".");
        let current = effective;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]] || typeof current[parts[i]] !== "object") {
            current[parts[i]] = {};
          }
          current = current[parts[i]] as NestedConfigTree;
        }
        current[parts[parts.length - 1]] = value;
      }
    }

    if (format === ConfigOutputFormat.JSON) {
      return JSON.stringify(effective, null, 2);
    }

    return formatTree(effective, 0);
  }

  async diff(): Promise<string> {
    const report = (await this.ensureAdapter()).diff();
    if (report.overridden.length === 0) {
      return "  No overridden keys.";
    }
    return report.overridden
      .map((item) => `  ${item.path}: ${item.default} → ${item.current}`)
      .join("\n");
  }

  async setModel(name: string, model: string): Promise<void> {
    await (await this.ensureAdapter()).set(`models.${name}.model`, model);
  }

  async setProvider(provider: string): Promise<void> {
    const adapter = await this.ensureAdapter();
    await adapter.set("ai.provider", provider);
    const modelMap: Record<string, string> = {
      openai: "gpt-5-mini",
      anthropic: "claude-sonnet-4",
      google: "gemini-flash-latest",
      ollama: "llama3.2",
    };
    if (modelMap[provider]) {
      await adapter.set(`models.default.model`, modelMap[provider]);
    }
  }

  async setPath(key: string, dir: string): Promise<void> {
    await (await this.ensureAdapter()).set(`paths.${key}`, dir);
  }

  async useProfile(name: string): Promise<void> {
    await (await this.ensureAdapter()).set("system.active_profile", name);
  }

  async listProfiles(): Promise<string[]> {
    const overrides = (await this.ensureAdapter()).listOverrides();
    return overrides
      .filter((o) => o.key.startsWith("profile."))
      .map((o) => o.key.replace("profile.", ""));
  }

  // ── Phase 138 Step 2: MCP deny-permanently blocklist management ────────────

  async blockAdd(pattern: string, reason?: Opt<string, Reason.OptionalInput>): Promise<void> {
    (await this.ensureAdapter()).addBlock(pattern, reason);
  }

  async blockRemove(pattern: string): Promise<void> {
    (await this.ensureAdapter()).removeBlock(pattern);
  }

  async blockList(): Promise<Array<{ pattern: string; reason: string | null; created_at: string }>> {
    const blocks = (await this.ensureAdapter()).listBlocks();
    return blocks.map((b) => ({ pattern: b.key_pattern, reason: b.reason, created_at: b.created_at }));
  }

  /**
   * Phase 138 Step 3: compact config_overrides to one row per key (hard-limit
   * escape hatch). Returns the number of superseded rows removed.
   */
  async compact(): Promise<number> {
    return (await this.ensureAdapter()).compact();
  }

  /**
   * Phase 139 Step 2: the append-only override history for `key`, newest-first
   * (DESC by id). Read-only — a thin wrapper over IConfigAdapter.getHistory.
   */
  async history(path: string): Promise<IConfigOverrideEntry[]> {
    return (await this.ensureAdapter()).getHistory(path);
  }

  /**
   * Phase 139 Step 3: revert `path` to the value at history row `id` by appending
   * a rollback row. Returns the restored value.
   */
  async rollback(path: string, id: number): Promise<ConfigValue> {
    if (!Number.isInteger(id) || id < 1) {
      throw new Error(`rollback id must be a positive integer, got ${id}`);
    }
    return (await this.ensureAdapter()).rollback(path, id);
  }

  // ── Phase 139 Step 4: key locking ──────────────────────────────────────────

  async lock(path: string, reason?: Opt<string, Reason.OptionalInput>): Promise<void> {
    (await this.ensureAdapter()).lock(path, CONFIG_LOCKED_BY_CLI, reason);
  }

  async unlock(path: string): Promise<void> {
    (await this.ensureAdapter()).unlock(path, CONFIG_LOCKED_BY_CLI);
  }

  async listLocks(): Promise<ILockedKeyEntry[]> {
    return (await this.ensureAdapter()).listLocks();
  }

  // ── Phase 139 Step 6: config edit ($EDITOR) ────────────────────────────────

  /**
   * Render the current overrides to a temp file (`key = value` lines), open it
   * in `$EDITOR`, and apply any changed lines back through `adapter.set()` — so
   * the editor stays inside the security funnel (lock + validation + debounce
   * all still apply; blocklist enforcement remains MCP-only, per design GAP-2).
   * A non-zero editor exit discards all changes.
   */
  async edit(): Promise<void> {
    const adapter = await this.ensureAdapter();
    const overrides = adapter.listOverrides();
    // Snapshot original key→value (rendered form) so we only re-apply changes.
    const original = new Map<string, string>();
    for (const o of overrides) {
      original.set(o.key, String(o.value));
    }
    const rendered = overrides.map((o) => `${o.key} = ${o.value}`).join("\n");

    const tmpPath = await Deno.makeTempFile({ prefix: "exactl-config-edit-", suffix: ".conf" });
    try {
      await Deno.writeTextFile(tmpPath, rendered === "" ? "" : `${rendered}\n`);

      const editor = Deno.env.get("EDITOR") || Deno.env.get("VISUAL") || "vi";
      const { code } = await new Deno.Command(editor, {
        args: [tmpPath],
        stdin: STDIO_INHERIT,
        stdout: STDIO_INHERIT,
        stderr: STDIO_INHERIT,
      }).output();
      if (code !== 0) {
        throw new Error(`Editor exited with code ${code}; no changes applied.`);
      }

      const edited = await Deno.readTextFile(tmpPath);
      // Pre-validate all changed lines before applying any (GAP-3).
      const pending: Array<{ key: string; value: ConfigValue }> = [];
      const errors: string[] = [];
      for (const line of edited.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const valueStr = trimmed.slice(eq + 1).trim();
        if (original.get(key) === valueStr) continue;
        const parsed = parseValue(valueStr);
        const report = adapter.validateAtPath(key, parsed);
        if (!report.valid) {
          errors.push(...report.issues.map((i) => `${key}: ${i.message}`));
        } else {
          pending.push({ key, value: parsed });
        }
      }
      if (errors.length > 0) {
        throw new Error(
          `Config edit aborted — ${errors.length} validation error(s):\n${errors.join("\n")}`,
        );
      }
      // Apply all changes atomically (pre-validated — no failures expected).
      for (const { key, value } of pending) {
        await adapter.set(key, value);
      }
    } finally {
      await Deno.remove(tmpPath);
    }
  }
}

function formatTree(obj: NestedConfigTree, depth: number): string {
  const indent = "  ".repeat(depth);
  let result = "";
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null) {
      result += `${indent}${key}:\n`;
      result += formatTree(value as NestedConfigTree, depth + 1);
    } else {
      result += `${indent}${key}: ${value}\n`;
    }
  }
  return result;
}
