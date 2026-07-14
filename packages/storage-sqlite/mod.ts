/**
 * @module StorageSqlitePackage
 * @path packages/storage-sqlite/mod.ts
 * @ungrounded
 * @related-files []
 * @architectural-layer Infrastructure
 * @description Package entrypoint for @exaix/storage-sqlite. This package owns the concrete SQLite-backed database service.
 */

export type { IDatabaseService } from "@exaix/core/types";
export * from "./src/database_service.ts";
export { DatabaseConnectionPool, SQLiteConnection } from "./src/connection_pool.ts";
export type { IDatabaseConnection } from "./src/connection_pool.ts";
