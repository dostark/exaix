/**
 * @module SchemasConstants
 * @path packages/schemas/src/constants.ts
 * @description Package-local schema constants for @exaix/schemas.
 */

export const DEFAULT_WORKSPACE_PATH = "Workspace";
export const DEFAULT_RUNTIME_PATH = ".exa";
export const DEFAULT_MEMORY_PATH = "Memory";
export const DEFAULT_PORTALS_PATH = "Portals";
export const DEFAULT_BLUEPRINTS_PATH = "Blueprints";
export const DEFAULT_ACTIVE_PATH = "Active";
export const DEFAULT_ARCHIVE_PATH = "Archive";
export const DEFAULT_PLANS_PATH = "Plans";
export const DEFAULT_REQUESTS_PATH = "Requests";
export const DEFAULT_REJECTED_PATH = "Rejected";

export const DEFAULT_IDENTITIES_PATH = "Identities";
export const DEFAULT_FLOWS_PATH = "Flows";
export const DEFAULT_PROJECTS_MEMORY_PATH = "Projects";
export const DEFAULT_EXECUTION_MEMORY_PATH = "Execution";
export const DEFAULT_INDEX_MEMORY_PATH = "Index";
export const DEFAULT_SKILLS_MEMORY_PATH = "Skills";
export const DEFAULT_PENDING_MEMORY_PATH = "Pending";
export const DEFAULT_TASKS_MEMORY_PATH = "Tasks";
export const DEFAULT_GLOBAL_MEMORY_PATH = "Global";

export const ExaPathDefaults = {
  workspace: DEFAULT_WORKSPACE_PATH,
  runtime: DEFAULT_RUNTIME_PATH,
  memory: DEFAULT_MEMORY_PATH,
  portals: DEFAULT_PORTALS_PATH,
  blueprints: DEFAULT_BLUEPRINTS_PATH,
  flows: `${DEFAULT_BLUEPRINTS_PATH}/${DEFAULT_FLOWS_PATH}`,
  requests: DEFAULT_REQUESTS_PATH,
  plans: DEFAULT_PLANS_PATH,
  active: DEFAULT_ACTIVE_PATH,
  archive: DEFAULT_ARCHIVE_PATH,
  rejected: DEFAULT_REJECTED_PATH,
  identities: DEFAULT_IDENTITIES_PATH,
  memoryProjects: `${DEFAULT_MEMORY_PATH}/${DEFAULT_PROJECTS_MEMORY_PATH}`,
  memoryExecution: `${DEFAULT_MEMORY_PATH}/${DEFAULT_EXECUTION_MEMORY_PATH}`,
  memoryIndex: `${DEFAULT_MEMORY_PATH}/${DEFAULT_INDEX_MEMORY_PATH}`,
  memorySkills: `${DEFAULT_MEMORY_PATH}/${DEFAULT_SKILLS_MEMORY_PATH}`,
  memoryPending: `${DEFAULT_MEMORY_PATH}/${DEFAULT_PENDING_MEMORY_PATH}`,
  memoryTasks: `${DEFAULT_MEMORY_PATH}/${DEFAULT_TASKS_MEMORY_PATH}`,
  memoryGlobal: `${DEFAULT_MEMORY_PATH}/${DEFAULT_GLOBAL_MEMORY_PATH}`,
};

export const DEFAULT_AGENT_MAX_ITERATIONS = 10;
export const DEFAULT_REFLEXIVE_CONVERGENCE_QUALITY_EXIT_THRESHOLD = 85;
export const DEFAULT_REFLEXIVE_CONVERGENCE_MIN_IMPROVEMENT_DELTA = 3;
export const DEFAULT_REFLEXIVE_CONVERGENCE_OSCILLATION_WINDOW = 2;
export const DEFAULT_REFLEXIVE_CONVERGENCE_ABSOLUTE_MAX_ITERATIONS = 12;
export const DEFAULT_REFLEXIVE_CONVERGENCE_SCORE_EVERY_N_ITERATIONS = 1;

export const DEFAULT_CLOUD_BUDGET_ENFORCEMENT_ENABLED = true;
export const DEFAULT_LOCAL_BUDGET_ENFORCEMENT_ENABLED = false;

export const DEFAULT_FLOW_VERSION = "1.0.0";
export const DEFAULT_NAMESPACE_MAX_BYTES = 65536;
export const DEFAULT_QUICK_SCAN_LIMIT = 200;
export const DEFAULT_MAX_FILES_TO_READ = 50;
export const DEFAULT_KNOWLEDGE_STALENESS_HOURS = 168;
export const DEFAULT_PORTAL_KNOWLEDGE_MODE = "quick";

export const TOKEN_ESTIMATION_CHARS_PER_TOKEN = 4;
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "openai:gpt-4o-mini": 128_000,
  "openai:gpt-4o": 128_000,
  "anthropic:claude-3-5-sonnet": 200_000,
  "anthropic:claude-3-7-sonnet": 200_000,
  "google:gemini-2.5-flash": 1_000_000,
};
export const LOCAL_PROVIDER_PREFIXES = ["ollama:", "lmstudio:", "local:"] as const;
export const LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK = 32_768;
export const MODEL_PRICING_MAP: Record<string, number> = {
  "openai:gpt-4o-mini": 0.0003,
  "openai:gpt-4o": 0.005,
  "anthropic:claude-3-5-sonnet": 0.003,
  "anthropic:claude-3-7-sonnet": 0.003,
  "google:gemini-2.5-flash": 0.00035,
};
export const SECTION_FLOORS = {
  system: 1_000,
  plan: 2_000,
} as const;

export const DEFAULT_QG_MINIMUM_THRESHOLD = 20;
export const DEFAULT_QG_ENRICHMENT_THRESHOLD = 50;
export const DEFAULT_QG_PROCEED_THRESHOLD = 70;
export const DEFAULT_MAX_CLARIFICATION_ROUNDS = 5;
