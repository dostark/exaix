/**
 * @module ScenarioFrameworkVersion
 * @path tests/scenario_framework/schema/version.ts
 * @description Centralized version constants for the scenario framework
 * schema to avoid hard-coded version strings throughout the codebase.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/schema/scenario_schema.ts, tests/scenario_framework/schema/step_schema.ts]
 */

/**
 * The current schema version for scenario definitions.
 * This version is used in:
 * - scenario_schema.ts for validation
 * - step_schema.ts for version pattern matching
 * - test fixtures and synthetic scenarios
 * - scenario templates
 *
 * Version format: MAJOR.MINOR.PATCH
 * - MAJOR: Breaking changes to schema structure
 * - MINOR: Backward-compatible additions
 * - PATCH: Backward-compatible fixes
 */
export const SCHEMA_VERSION = "1.0.0" as const;

/** Matches semantic versioning format X.Y.Z (non-negative integers). */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export function isValidVersion(version: string): boolean {
  return VERSION_PATTERN.test(version);
}

/** Standard comparator semantics: -1 if a < b, 0 if equal, 1 if a > b. */
export function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (aParts[i] < bParts[i]) return -1;
    if (aParts[i] > bParts[i]) return 1;
  }

  return 0;
}

/** Compatible means same major version as SCHEMA_VERSION, regardless of minor/patch. */
export function isCompatibleVersion(version: string): boolean {
  if (!isValidVersion(version)) return false;

  const comparison = compareVersions(version, SCHEMA_VERSION);

  // Same version is always compatible
  if (comparison === 0) return true;

  // Older versions with same major are compatible (backward compatibility)
  if (comparison < 0) {
    const aParts = version.split(".").map(Number);
    const bParts = SCHEMA_VERSION.split(".").map(Number);
    return aParts[0] === bParts[0];
  }

  // Newer versions with same major might be compatible (forward compatibility)
  if (comparison > 0) {
    const aParts = version.split(".").map(Number);
    const bParts = SCHEMA_VERSION.split(".").map(Number);
    return aParts[0] === bParts[0];
  }

  return false;
}
