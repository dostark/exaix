/**
 * @module TestingPackage
 * @path packages/testing/mod.ts
 * @description Package entrypoint for @exaix/testing. This package houses shared test helpers, mocks, and fixtures.
 */
export { createLoggingTestDb } from "./src/helpers/db.ts";
export type { ILoggedActivity, TestDatabaseService } from "./src/helpers/db.ts";
