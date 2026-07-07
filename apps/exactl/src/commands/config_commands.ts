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
import { createConfigAdapter, getRegisteredDefaults } from "@exaix/core/config";
import type { IConfigAdapter, IConfigValidationReport } from "@exaix/core/config";
import { ConfigKeyNotFoundError } from "@exaix/core/config";
import type { ConfigValue } from "@exaix/core/config";
import { ConfigOutputFormat } from "@exaix/core/types";

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

  private getAdapter(): IConfigAdapter {
    if (!this.adapter) {
      const dbPath = join(this.config.system.root, ".exa", "config.db");
      this.adapter = createConfigAdapter(dbPath);
    }
    return this.adapter;
  }

  get(path: string): Promise<unknown> {
    const value = this.getAdapter().get(path);
    if (value === undefined) {
      return Promise.reject(new ConfigKeyNotFoundError(path));
    }
    return Promise.resolve(value);
  }

  async set(path: string, valueStr: string): Promise<void> {
    const parsed = parseValue(valueStr);
    await this.getAdapter().set(path, parsed);
  }

  async unset(path: string): Promise<void> {
    await this.getAdapter().unset(path);
  }

  validate(path?: string): Promise<IConfigValidationReport> {
    if (path) {
      const value = this.getAdapter().get(path);
      return Promise.resolve(this.getAdapter().validateAtPath(path, value as ConfigValue ?? null));
    }
    return Promise.resolve(this.getAdapter().validate());
  }

  show(format: ConfigOutputFormat = ConfigOutputFormat.HUMAN): Promise<string> {
    const adapter = this.getAdapter();
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
      return Promise.resolve(JSON.stringify(effective, null, 2));
    }

    return Promise.resolve(formatTree(effective, 0));
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
