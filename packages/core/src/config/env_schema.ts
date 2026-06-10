/**
 * @module EnvSchema
 * @path packages/core/src/config/env_schema.ts
 * @description Environment helpers for CI/test detection.
 * @architectural-layer Config
 * @related-files []
 */

/**
 * Safe environment getter that returns undefined when env access is not permitted
 */
function safeEnvGet(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

/**
 * Helper to check if a value represents a truthy boolean
 */
function isTruthyValue(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

/**
 * Check if code is running in test mode
 */
export function isTestMode(): boolean {
  if (isTruthyValue(safeEnvGet("EXA_TEST_MODE"))) {
    return true;
  }
  return safeEnvGet("EXA_TEST_CLI_MODE") === "1";
}

/**
 * Check if code is running in CI mode
 */
export function isCIMode(): boolean {
  const exaCiMode = safeEnvGet("EXA_CI_MODE");
  if (exaCiMode !== undefined) {
    return isTruthyValue(exaCiMode);
  }
  return isTruthyValue(safeEnvGet("CI"));
}
