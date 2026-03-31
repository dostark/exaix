/**
 * @module Skill
 * @path src/shared/types/skill.ts
 * @description Module for Skill.
 * @architectural-layer Shared
 * * @related-files [src/shared/interfaces/i_skills_service.ts]
 */

/**
 * Configuration for the Skills Service.
 */
export interface ISkillsConfig {
  /** Enable automatic skill matching */
  autoMatch: boolean;
  /** Maximum number of skills to inject into a single request */
  maxSkillsPerRequest: number;
  /** Maximum character budget for skill context */
  skillContextBudget: number;
  /** Minimum confidence score for skill matching (0-1) */
  matchThreshold: number;
}

/**
 * Request context for skill matching.
 */
export interface ISkillMatchRequest {
  /** Keywords from the user request */
  keywords?: string[];
  /** Type of task (e.g., "feature", "bugfix") */
  taskType?: string;
  /** Files involved in the request */
  filePaths?: string[];
  /** User-specified tags */
  tags?: string[];
  /** Raw request text for additional context */
  requestText?: string;
  /** ID of the agent making the request */
  identityId?: string;
}
