/**
 * @module SchemasBaseConfigFixture
 * @path packages/schemas/tests/helpers/base_config.ts
 * @description The smallest valid config input, with only the required system and paths sections, for the config schema tests.
 * @architectural-layer Test
 * @related-files [packages/schemas/tests/config_planning_test.ts]
 */

import { ExaPathDefaults } from "@exaix/shared";
import { LogLevel } from "@exaix/core";

/** A config input that holds only the required sections. */
export interface IBaseConfig {
  system: { root: string; log_level: string };
  paths: typeof ExaPathDefaults;
}

/** Returns a fresh minimal config input, so a test can add its own section without touching another test. */
export function baseConfig(): IBaseConfig {
  return {
    system: { root: "/tmp/exa-test", log_level: LogLevel.INFO },
    paths: { ...ExaPathDefaults },
  };
}
