/**
 * @module SharedConstants
 * @path packages/shared/src/constants.ts
 * @description Constants that both @exaix/core and @exaix/schemas need. Living below
 *   both packages keeps them free of the core-schemas import cycle.
 * @architectural-layer Shared
 * @dependencies []
 * @related-files [packages/shared/mod.ts]
 */

/** Workspace path segment defaults, shared by core and schemas. */
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
export const DEFAULT_AGENTS_PATH = "Agents";
export const DEFAULT_FLOWS_PATH = "Flows";
export const DEFAULT_PROJECTS_MEMORY_PATH = "Projects";
export const DEFAULT_EXECUTION_MEMORY_PATH = "Execution";
export const DEFAULT_INDEX_MEMORY_PATH = "Index";
export const DEFAULT_SKILLS_MEMORY_PATH = "Skills";
export const DEFAULT_PENDING_MEMORY_PATH = "Pending";
export const DEFAULT_TASKS_MEMORY_PATH = "Tasks";
export const DEFAULT_GLOBAL_MEMORY_PATH = "Global";

/** Reflexive convergence limits, shared by core and schemas. */
export const DEFAULT_REFLEXIVE_CONVERGENCE_MIN_IMPROVEMENT_DELTA = 3;
export const DEFAULT_REFLEXIVE_CONVERGENCE_ABSOLUTE_MAX_ITERATIONS = 12;

/** Flow and namespace limits, shared by core and schemas. */
export const DEFAULT_FLOW_VERSION = "1.0.0";
export const DEFAULT_NAMESPACE_MAX_BYTES = 65536;

/** Token estimation and local-model context window, shared by core and schemas. */
export const TOKEN_ESTIMATION_CHARS_PER_TOKEN = 4;
export const LOCAL_MODEL_CONTEXT_WINDOW_FALLBACK = 32_768;

/** Skill name limit and the effort auto literal, shared by core and schemas. */
export const SKILL_NAME_MAX_LENGTH = 64;
export const EFFORT_AUTO = "auto" as const;

/** Composite directories, shared by core and schemas. */
export const DEFAULT_FLOWS_DIR = `${DEFAULT_BLUEPRINTS_PATH}/${DEFAULT_FLOWS_PATH}`;
export const DEFAULT_MEMORY_PROJECTS_DIR = `${DEFAULT_MEMORY_PATH}/${DEFAULT_PROJECTS_MEMORY_PATH}`;
export const DEFAULT_MEMORY_EXECUTION_DIR = `${DEFAULT_MEMORY_PATH}/${DEFAULT_EXECUTION_MEMORY_PATH}`;
export const DEFAULT_MEMORY_INDEX_DIR = `${DEFAULT_MEMORY_PATH}/${DEFAULT_INDEX_MEMORY_PATH}`;
export const DEFAULT_MEMORY_SKILLS_DIR = `${DEFAULT_MEMORY_PATH}/${DEFAULT_SKILLS_MEMORY_PATH}`;
export const DEFAULT_MEMORY_PENDING_DIR = `${DEFAULT_MEMORY_PATH}/${DEFAULT_PENDING_MEMORY_PATH}`;
export const DEFAULT_MEMORY_TASKS_DIR = `${DEFAULT_MEMORY_PATH}/${DEFAULT_TASKS_MEMORY_PATH}`;
export const DEFAULT_MEMORY_GLOBAL_DIR = `${DEFAULT_MEMORY_PATH}/${DEFAULT_GLOBAL_MEMORY_PATH}`;

/** Default location of the wait-states folder inside the workspace. */
export const DEFAULT_WAIT_STATES_PATH = "WaitStates";

/** The default each `paths.*` config key resolves to when a config omits it. */
export const ExaPathDefaults = {
  workspace: DEFAULT_WORKSPACE_PATH,
  runtime: DEFAULT_RUNTIME_PATH,
  memory: DEFAULT_MEMORY_PATH,
  portals: DEFAULT_PORTALS_PATH,
  blueprints: DEFAULT_BLUEPRINTS_PATH,
  flows: DEFAULT_FLOWS_DIR,
  waitStates: DEFAULT_WAIT_STATES_PATH,
  requests: DEFAULT_REQUESTS_PATH,
  plans: DEFAULT_PLANS_PATH,
  active: DEFAULT_ACTIVE_PATH,
  archive: DEFAULT_ARCHIVE_PATH,
  rejected: DEFAULT_REJECTED_PATH,
  agents: DEFAULT_AGENTS_PATH,
  memoryProjects: DEFAULT_MEMORY_PROJECTS_DIR,
  memoryExecution: DEFAULT_MEMORY_EXECUTION_DIR,
  memoryIndex: DEFAULT_MEMORY_INDEX_DIR,
  memorySkills: DEFAULT_MEMORY_SKILLS_DIR,
  memoryPending: DEFAULT_MEMORY_PENDING_DIR,
  memoryTasks: DEFAULT_MEMORY_TASKS_DIR,
  memoryGlobal: DEFAULT_MEMORY_GLOBAL_DIR,
} as const;
