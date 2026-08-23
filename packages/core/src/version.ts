/**
 * @module ExaixVersion
 * @path packages/core/src/version.ts
 * @description Canonical SemVer constants for Exaix binary and workspace schema.
 * Any MINOR or MAJOR bump to WORKSPACE_SCHEMA_VERSION requires workspace migration
 * before the new binary can run against an existing deployed workspace.
 * @architectural-layer Shared
 * @ungrounded
 * @related-files ["scripts/check_version.ts", "packages/schemas/src/config.ts"]
 */

/** SemVer of the exactl binary and Exaix daemon. */
export const BINARY_VERSION = "1.0.8";

/**
 * SemVer of the deployed workspace structure (config schema, SQLite tables, folder layout).
 * A MINOR or MAJOR bump means workspace migration is required before this binary runs.
 */
export const WORKSPACE_SCHEMA_VERSION = "1.5.0";
