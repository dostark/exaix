/**
 * @module ErrorsPackage
 * @path packages/core/src/errors/mod.ts
 * @description Barrel export for shared error types and safe error classes in @exaix/core.
 * @architectural-layer Core
 * @ungrounded
 * @related-files ["packages/core/src/errors/context_error.ts", "packages/core/src/errors/safe_error.ts"]
 */

export * from "./context_error.ts";
export * from "./safe_error.ts";
export * from "./context_budget_error.ts";
