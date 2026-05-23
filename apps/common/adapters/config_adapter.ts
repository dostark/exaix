/**
 * @module ConfigAdapter
 * @path apps/common/adapters/config_adapter.ts
 * @description Adapter for Config Service.
 * @architectural-layer Services
 * @ungrounded
 * @related-files [packages/core/src/config/service.ts, "packages/core/src/types/i_config_service.ts"]
 */

import type { IConfigService, IPortalConfigEntry } from "@exaix/core/types";
import type { ConfigService } from "@exaix/core/config";
import type { Config } from "@exaix/schemas/config.ts";
import type { PortalExecutionStrategy } from "@exaix/core";

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
