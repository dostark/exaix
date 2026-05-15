/**
 * @module IconfigService
 * @path src/shared/interfaces/i_config_service.ts
 * @description Module for IconfigService.
 * @architectural-layer Shared
 * @related-files ["packages/schemas/src/config.ts"]
 */

import type { Config } from "../config/config_schema.ts";
import type { PortalExecutionStrategy, PortalOperation } from "@exaix/core";

export interface IPortalConfigEntry {
  alias: string;
  target_path: string;
  created?: string;
  default_branch?: string;
  identities_allowed?: string[];
  operations?: PortalOperation[];
  execution_strategy?: PortalExecutionStrategy;
}

export interface IConfigService {
  /**
   * Get the current configuration object.
   */
  get(): Config;

  /**
   * Alias for get() to satisfy some consumers.
   */
  getAll(): Config;

  /**
   * Get the path to the configuration file.
   */
  getConfigPath(): string;

  /**
   * Reload configuration from disk.
   */
  reload(): Config;

  /**
   * Add a new portal to the configuration.
   */
  addPortal(
    alias: string,
    targetPath: string,
    options?: { defaultBranch?: string; executionStrategy?: PortalExecutionStrategy },
  ): Promise<void>;

  /**
   * Remove a portal from the configuration.
   */
  removePortal(alias: string): Promise<void>;

  /**
   * Get all configured portals.
   */
  getPortals(): IPortalConfigEntry[];

  /**
   * Get configuration for a specific portal.
   */
  getPortal(alias: string): IPortalConfigEntry | undefined;

  /**
   * Get the workspace schema version from the loaded config.
   */
  getSchemaVersion(): string;
}
