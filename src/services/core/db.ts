/**
 * @module DatabaseServiceShim
 * @path src/services/core/db.ts
 * @description Compatibility shim that re-exports the package-owned SQLite database service from @exaix/storage-sqlite.
 * @architectural-layer Services
 * @related-files ["packages/storage-sqlite/src/database_service.ts", "src/services/core/database_connection_pool.ts"]
 */

export * from "@exaix/storage-sqlite";
