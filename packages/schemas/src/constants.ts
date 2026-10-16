/**
 * @module SchemasConstants
 * @path packages/schemas/src/constants.ts
 * @related-files []
 * @architectural-layer Schemas
 * @ungrounded
 * @description Package-local schema constants for @exaix/schemas.
 */

export const DEFAULT_AGENT_MAX_ITERATIONS = 10;
export const DEFAULT_REFLEXIVE_CONVERGENCE_QUALITY_EXIT_THRESHOLD = 85;
export const DEFAULT_REFLEXIVE_CONVERGENCE_OSCILLATION_WINDOW = 2;
export const DEFAULT_REFLEXIVE_CONVERGENCE_SCORE_EVERY_N_ITERATIONS = 1;

export const DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED = true;
export const DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED = true;

export const DEFAULT_QUICK_SCAN_LIMIT = 200;
export const DEFAULT_MAX_FILES_TO_READ = 50;
export const DEFAULT_KNOWLEDGE_STALENESS_HOURS = 168;
export const DEFAULT_PORTAL_KNOWLEDGE_MODE = "quick";

export const LOCAL_PROVIDER_PREFIXES = ["ollama:", "lmstudio:", "local:"] as const;
export const SECTION_FLOORS = {
  system: 1_000,
  plan: 2_000,
} as const;

export const DEFAULT_QG_MINIMUM_THRESHOLD = 20;
export const DEFAULT_QG_ENRICHMENT_THRESHOLD = 50;
export const DEFAULT_QG_PROCEED_THRESHOLD = 70;
export const DEFAULT_MAX_CLARIFICATION_ROUNDS = 5;
