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
import { createConfigAdapterAsync, getRegisteredDefaults } from "@exaix/core/config";
import type { IConfigAdapter, IConfigValidationReport } from "@exaix/core/config";
import { ConfigKeyNotFoundError } from "@exaix/core/config";
import type { ConfigValue } from "@exaix/core/config";
import { CONFIG_PROFILE_KEY_PREFIX, ConfigOutputFormat, type Opt, type Reason } from "@exaix/core/types";

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
    const parsed = parseValue(valueStr);
    await (await this.ensureAdapter()).set(this.scopeKey(path, profile), parsed);
  }

  async unset(path: string): Promise<void> {
    await (await this.ensureAdapter()).unset(path);
  }

  async validate(path?: string): Promise<IConfigValidationReport> {
    const adapter = await this.ensureAdapter();
    if (path) {
      const value = adapter.get(path);
      return adapter.validateAtPath(path, value as ConfigValue ?? null);
    }
    return adapter.validate();
  }

  async show(
    format: ConfigOutputFormat = ConfigOutputFormat.HUMAN,
    sources?: boolean,
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
