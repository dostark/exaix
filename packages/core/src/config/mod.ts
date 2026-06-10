/**
 * @module CoreConfigPackage
 * @path packages/core/src/config/mod.ts
 * @description Shared configuration helpers, service, and path defaults for @exaix/core.
 * @architectural-layer Core
 * @related-files ["packages/core/src/config/service.ts", "packages/core/src/config/paths.ts", "packages/core/src/config/env_schema.ts"]
 */

export * from "./service.ts";
export * from "./paths.ts";

export * from "./config_reload_handler.ts";
export * from "./env_schema.ts";
