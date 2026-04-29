/**
 * @module ConfigService
 * @path src/config/service.ts
 * @description Central service for managing system configuration, loading from TOML files,
 * and providing validated access to settings for all components.
 * @architectural-layer Core System
 * @related-files [src/config/schema.ts, src/main.ts]
 */
import { parse } from "@std/toml";
import { dirname, isAbsolute, join } from "@std/path";
import { crypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { type Config, ConfigSchema } from "@exaix/schemas/config.ts";
import type { PortalExecutionStrategy } from "@exaix/core";
import { logInfo } from "../services/logger/structured_logger.ts";
import type { IPortalConfigEntry } from "@exaix/core/types";
import { ExaPathDefaults } from "@exaix/core";

export class ConfigService {
  private readonly configPath: string;
  private config: Config;
  private checksum: string = "";

  constructor(configPath?: string) {
    const envConfigPath = Deno.env.get("EXA_CONFIG_PATH");

    if (configPath) {
      this.configPath = isAbsolute(configPath) ? configPath : join(Deno.cwd(), configPath);
    } else if (envConfigPath) {
      this.configPath = isAbsolute(envConfigPath) ? envConfigPath : join(Deno.cwd(), envConfigPath);
    } else {
      this.configPath = join(Deno.cwd(), "exa.config.toml");
    }
    // Never mutate configPath in test mode; always use the explicit path
    this.config = this.load();
  }

  private load(): Config {
    try {
      const content = Deno.readTextFileSync(this.configPath);
      this.checksum = this.computeChecksum(content);

      const rawConfig = parse(content);

      // Ensure system.root is set and resolved relative to the config file if it's relative
      const systemConfig = rawConfig.system as { root?: string } | undefined;
      if (systemConfig && !systemConfig.root) {
        systemConfig.root = dirname(this.configPath);
      } else if (systemConfig?.root && !isAbsolute(systemConfig.root)) {
        systemConfig.root = join(dirname(this.configPath), systemConfig.root);
      }

      const result = ConfigSchema.safeParse(rawConfig);

      if (!result.success) {
        let errorMessage = "❌ Invalid configuration in exa.config.toml:\n";
        for (const issue of result.error.issues) {
          errorMessage += `  - ${issue.path.join(".")}: ${issue.message}\n`;
        }
        throw new Error(errorMessage);
      }

      return result.data;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // In non-test mode, fallback to default config
        console.warn("⚠️  Configuration file not found. Using defaults.");
        this.createDefaultConfig();
        return this.load();
      }
      throw error;
    }
  }

  private createDefaultConfig(): void {
    const defaultConfig = `
[system]
root = "."
version = "1.0.0"
log_level = "info"

[paths]
memory = "${ExaPathDefaults.memory}"
blueprints = "${ExaPathDefaults.blueprints}"
runtime = "${ExaPathDefaults.runtime}"
workspace = "${ExaPathDefaults.workspace}"
portals = "${ExaPathDefaults.portals}"
active = "${ExaPathDefaults.active}"
archive = "${ExaPathDefaults.archive}"
plans = "${ExaPathDefaults.plans}"
requests = "${ExaPathDefaults.requests}"
rejected = "${ExaPathDefaults.rejected}"
identities = "${ExaPathDefaults.identities}"
flows = "${ExaPathDefaults.flows}"
memoryProjects = "${ExaPathDefaults.memoryProjects}"
memoryExecution = "${ExaPathDefaults.memoryExecution}"
memoryIndex = "${ExaPathDefaults.memoryIndex}"
memorySkills = "${ExaPathDefaults.memorySkills}"
memoryPending = "${ExaPathDefaults.memoryPending}"
memoryTasks = "${ExaPathDefaults.memoryTasks}"
memoryGlobal = "${ExaPathDefaults.memoryGlobal}"

[watcher]
debounce_ms = 200
stability_check = true

[skills]
max_per_request = 5
match_threshold = 0.3
inject_in_prompt = true

[agents.convergence]
quality_exit_threshold = 85
min_improvement_delta = 3
oscillation_window = 2
base_max_iterations = 10
complexity_scale_factor = 1.0
absolute_max_iterations = 12
score_every_n_iterations = 1
`;
    Deno.writeTextFileSync(this.configPath, defaultConfig.trim());
    try {
      logInfo("Created default configuration file", {
        audit_event: true,
        event_type: "config_created",
        config_path: this.configPath,
        service: "config-service",
      });
    } catch {
      // Logger may not be initialized yet in early CLI startup and tests.
    }
  }

  private computeChecksum(content: string): string {
    const data = new TextEncoder().encode(content);
    const hash = crypto.subtle.digestSync("SHA-256", data);
    return encodeHex(hash);
  }

  public get(): Config {
    return this.config;
  }

  /**
   * Alias for get() to satisfy some consumers.
   */
  public getAll(): Config {
    return this.get();
  }

  public getConfigPath(): string {
    return this.configPath;
  }

  public getChecksum(): string {
    return this.checksum;
  }

  public reload(): Config {
    this.config = this.load();
    return this.config;
  }

  public async addPortal(
    alias: string,
    targetPath: string,
    options?: { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy },
  ): Promise<void> {
    const created = new Date().toISOString();

    // Read current config
    const content = await Deno.readTextFile(this.configPath);

    // Add portal entry
    const defaultBranchLine = options?.defaultBranch ? `default_branch = "${options.defaultBranch}"\n` : "";
    const executionStrategyLine = options?.executionStrategy
      ? `execution_strategy = "${options.executionStrategy}"\n`
      : "";

    const portalEntry =
      `\n[[portals]]\nalias = "${alias}"\ntarget_path = "${targetPath}"\ncreated = "${created}"\n${defaultBranchLine}${executionStrategyLine}`;

    // Append to config
    await Deno.writeTextFile(this.configPath, content + portalEntry);

    // Reload config
    this.config = this.load();
  }

  public async removePortal(alias: string): Promise<void> {
    // Read current config
    let content = await Deno.readTextFile(this.configPath);

    // Remove portal section using regex
    const portalRegex = new RegExp(
      `\\[\\[portals\\]\\][\\s\\S]*?alias\\s*=\\s*["']${alias}["'][\\s\\S]*?(?=\\[\\[portals\\]\\]|\\[\\w+\\]|$)`,
      "g",
    );

    content = content.replace(portalRegex, "");

    // Clean up extra blank lines
    content = content.replace(/\n{3,}/g, "\n\n");

    await Deno.writeTextFile(this.configPath, content);

    // Reload config
    this.config = this.load();
  }

  public getPortals(): IPortalConfigEntry[] {
    return this.config.portals || [];
  }

  public getPortal(alias: string): IPortalConfigEntry | undefined {
    return (this.config.portals || []).find((p: IPortalConfigEntry) => p.alias === alias);
  }

  public async updatePortalVerification(_alias: string): Promise<void> {
    // This would update last_verified timestamp if we add it to schema
    // For now, this is a placeholder for future enhancement
  }

  /** Returns the workspace schema version recorded in the loaded config. */
  public getSchemaVersion(): string {
    return this.config.system.schema_version;
  }
}
