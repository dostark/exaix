/**
 * @module AIPackage
 * @path packages/ai/mod.ts
 * @description Package entrypoint for @exaix/ai. This package exports shared AI constants and facades for AI provider utilities.
 */

export * from "./src/constants.ts";
export * from "./src/provider_registry.ts";
export { initializeRegistry } from "../../src/ai/provider_factory.ts";
