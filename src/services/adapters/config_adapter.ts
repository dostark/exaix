/**
 * @module ConfigAdapter
 * @path src/services/adapters/config_adapter.ts
 * @description Adapter for Config Service.
 * @architectural-layer Services
 * * @related-files [src/config/service.ts, src/shared/interfaces/i_config_service.ts]
 */

import type { IConfigService, IPortalConfigEntry } from "../../shared/interfaces/i_config_service.ts";
import type { ConfigService } from "../../config/service.ts";
import type { Config } from "../../shared/schemas/config.ts";
import type { PortalExecutionStrategy } from "../../shared/enums.ts";

/**
 * Adapter that implements the IConfigService interface
 * and delegates to the core ConfigService.
 */
export class ConfigAdapter implements IConfigService {
  constructor(private configService: ConfigService) {}

  /**
   * Get the current configuration object.
   */
  get(): Config {
    return this.configService.get();
  }

  /**
   * Alias for get() to satisfy some consumers.
   */
  getAll(): Config {
    return this.configService.get();
  }

  /**
   * Get the path to the configuration file.
   */
  getConfigPath(): string {
    return this.configService.getConfigPath();
  }

  /**
   * Reload configuration from disk.
   */
  reload(): Config {
    return this.configService.reload();
  }

  /**
   * Add a new portal to the configuration.
   */
  async addPortal(
    alias: string,
    targetPath: string,
    options?: { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy },
  ): Promise<void> {
    return await this.configService.addPortal(alias, targetPath, options);
  }

  /**
   * Remove a portal from the configuration.
   */
  async removePortal(alias: string): Promise<void> {
    return await this.configService.removePortal(alias);
  }

  /**
   * Get all configured portals.
   */
  getPortals(): IPortalConfigEntry[] {
    return this.configService.getPortals();
  }

  /**
   * Get configuration for a specific portal.
   */
  getPortal(alias: string): IPortalConfigEntry | undefined {
    return this.configService.getPortal(alias);
  }

  /**
   * Get the workspace schema version from the loaded config.
   */
  getSchemaVersion(): string {
    return this.configService.getSchemaVersion();
  }
}
