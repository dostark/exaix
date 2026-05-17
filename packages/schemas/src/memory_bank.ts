/**
 * @module SharedMemoryBankSchema
 * @path src/shared/schemas/memory_bank.ts
 * @description Defines shared Zod validation schemas for Memory Bank data structures.
 * @architectural-layer Shared
 * @related-files ["src/services/memory/memory_bank.ts", "packages/schemas/src/plan_schema.ts"]
 */

import { z } from "zod";
import { DEFAULT_QUERY_LIMIT, DEFAULT_SKILL_INDEX_VERSION, MEMORY_STATUS_VALUES } from "@exaix/core";
import {
  type ActivityType,
  ConfidenceAssessmentLevel,
  ExecutionStatus,
  LearningCategory,
  MemoryBankSource,
  MemoryOperation,
  MemoryReferenceType,
  MemoryScope,
  type MemoryType,
  ReviewSource,
  type SkillImmutableField,
  type SkillManagedField,
  SkillStatus,
} from "@exaix/core";

// ===== Project Memory Schemas =====

export interface IMemorySearchResult {
  type: MemoryType;
  portal?: string;
  trace_id?: string;
  title: string;
  summary: string;
  relevance_score?: number;
  tags?: string[];
  id?: string;
}

/**
 * Skill match result from trigger matching
 */
export interface ISkillMatch {
  skillId: string;
  confidence: number;
  matchedTriggers: {
    keywords?: string[];
    task_types?: string[];
    file_patterns?: string[];
    tags?: string[];
  };
}

/**
 * Advanced search options for searchMemoryAdvanced
 */
export interface IAdvancedSearchOptions {
  tags?: string[];
  keyword?: string;
  portal?: string;
  limit?: number;
  useEmbeddings?: boolean;
}

/**
 * IActivity summary combining execution history and task activity
 */
export interface IActivitySummary {
  timestamp: string;
  type: ActivityType;
  portal: string;
  summary: string;
  trace_id?: string;
}

export const PatternSchema = z.object({
  name: z.string().describe("Pattern name (e.g., 'Repository Pattern')"),
  description: z.string().describe("What the pattern does and why it's used"),
  examples: z.array(z.string()).describe("File paths demonstrating this pattern"),
  tags: z.array(z.string()).optional().describe("Searchable tags (e.g., 'architecture', 'database')"),
});

export const DecisionSchema = z.object({
  date: z.string().describe("ISO date when decision was made (YYYY-MM-DD)"),
  decision: z.string().describe("What was decided"),
  rationale: z.string().describe("Why this decision was made"),
  alternatives: z.array(z.string()).optional().describe("Other options considered"),
  tags: z.array(z.string()).optional().describe("Searchable tags"),
});

export const ReferenceSchema = z.object({
  type: z.nativeEnum(MemoryReferenceType).describe("Type of reference"),
  path: z.string().describe("Path or URL to the reference"),
  description: z.string().describe("What this reference is about"),
});

export const ProjectMemorySchema = z.object({
  portal: z.string().describe("Portal name this memory belongs to"),
  overview: z.string().describe("High-level project summary and context"),
  patterns: z.array(PatternSchema).describe("Code patterns and conventions learned"),
  decisions: z.array(DecisionSchema).describe("Architectural decisions and their rationale"),
  references: z.array(ReferenceSchema).describe("Key references (files, docs, APIs)"),
});

export type IPattern = z.infer<typeof PatternSchema>;
export type IDecision = z.infer<typeof DecisionSchema>;
export type IReference = z.infer<typeof ReferenceSchema>;
export type IProjectMemory = z.infer<typeof ProjectMemorySchema>;

// ===== Execution Memory Schemas =====

export const ChangesSchema = z.object({
  files_created: z.array(z.string()).describe("Files created during execution"),
  files_modified: z.array(z.string()).describe("Files modified during execution"),
  files_deleted: z.array(z.string()).describe("Files deleted during execution"),
});

export const AmendmentSummarySchema = z.object({
  id: z.string().uuid().describe("Unique amendment ID"),
  trigger: z.string().describe("Source/reason for the amendment"),
  summary: z.string().describe("Human-readable summary of changes"),
  decision: z.string().describe("Whether it was approved, rejected, or expired"),
});

export const ExecutionMemorySchema = z.object({
  trace_id: z.string().uuid().describe("Unique execution trace ID"),
  request_id: z.string().describe("Request ID that triggered this execution"),
  started_at: z.string().describe("ISO timestamp when execution started"),
  completed_at: z.string().optional().describe("ISO timestamp when execution completed (if finished)"),
  status: z.nativeEnum(ExecutionStatus).describe("Current execution status"),
  portal: z.string().describe("Portal this execution ran against"),
  identity_id: z.string().describe("Identity (blueprint name) that performed the execution"),
  agent_id: z.string().optional().describe("Runtime agent instance ID, if available"),
  summary: z.string().describe("Human-readable summary of what was done"),

  context_files: z.array(z.string()).describe("Files provided as context"),
  context_portals: z.array(z.string()).describe("Portals used for context"),

  changes: ChangesSchema.describe("Files created/modified/deleted"),

  lessons_learned: z.array(z.string()).optional().describe("Insights and learnings from this execution"),
  error_message: z.string().optional().describe("Error message if execution failed"),
  amendments: z.array(AmendmentSummarySchema).optional().describe("Amendments proposed during execution"),
});

export type IChanges = z.infer<typeof ChangesSchema>;
export type IExecutionMemory = z.infer<typeof ExecutionMemorySchema>;

// ===== Learning Schemas (Phase 12.8: Global Memory) =====

/**
 * Learning reference - links to supporting evidence
 */
export const LearningReferenceSchema = z.object({
  type: z.nativeEnum(MemoryReferenceType),
  path: z.string(),
});

/**
 * Learning schema - represents a learned insight, pattern, or decision
 *
 * Learnings can be project-scoped or global, and flow through
 * a pending → approved workflow for quality control.
 */
export const LearningSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  source: z.nativeEnum(MemoryBankSource).describe("Who/what created this learning"),
  source_id: z.string().optional().describe("trace_id or user session if applicable"),

  scope: z.nativeEnum(MemoryScope).describe("Whether this applies globally or to a specific project"),
  project: z.string().optional().describe("Portal name if project-scoped"),

  title: z.string().max(100).describe("Short title for the learning"),
  description: z.string().max(2000).describe("Detailed description of the learning"),

  category: z.nativeEnum(LearningCategory).describe("Type of learning"),

  tags: z.array(z.string()).max(10).describe("Searchable tags"),

  confidence: z.nativeEnum(ConfidenceAssessmentLevel).describe("Confidence level in this learning"),

  references: z.array(LearningReferenceSchema).optional().describe("Supporting evidence"),

  status: z.enum(MEMORY_STATUS_VALUES).describe("Approval status"),
  approved_at: z.string().datetime().optional(),
  archived_at: z.string().datetime().optional(),
});

export type ILearningReference = z.infer<typeof LearningReferenceSchema>;
export type ILearning = z.infer<typeof LearningSchema>;

/**
 * Global pattern - a code pattern that applies across projects
 */
export const GlobalPatternSchema = z.object({
  name: z.string(),
  description: z.string(),
  applies_to: z.array(z.string()).describe("Project patterns or 'all'"),
  examples: z.array(z.string()),
  tags: z.array(z.string()),
});

/**
 * Global anti-pattern - something to avoid across all projects
 */
export const GlobalAntiPatternSchema = z.object({
  name: z.string(),
  description: z.string(),
  reason: z.string().describe("Why this is an anti-pattern"),
  alternative: z.string().describe("What to do instead"),
  tags: z.array(z.string()),
});

/**
 * Global memory statistics
 */
export const GlobalMemoryStatsSchema = z.object({
  total_learnings: z.number(),
  by_category: z.record(z.number()),
  by_project: z.record(z.number()),
  last_activity: z.string().datetime(),
});

/**
 * Global memory - cross-project learnings and patterns
 *
 * Stored in Memory/Global/ and contains learnings that apply
 * across all projects in the workspace.
 */
export const GlobalMemorySchema = z.object({
  version: z.string().describe("Schema version"),
  updated_at: z.string().datetime(),

  learnings: z.array(LearningSchema),

  patterns: z.array(GlobalPatternSchema).describe("Global code patterns"),

  anti_patterns: z.array(GlobalAntiPatternSchema).describe("What to avoid"),

  statistics: GlobalMemoryStatsSchema,
});

export type IGlobalPattern = z.infer<typeof GlobalPatternSchema>;
export type IGlobalAntiPattern = z.infer<typeof GlobalAntiPatternSchema>;
export type IGlobalMemoryStats = z.infer<typeof GlobalMemoryStatsSchema>;
export type IGlobalMemory = z.infer<typeof GlobalMemorySchema>;

// ===== Memory Update Proposal Schema (Phase 12.9: Agent Memory Updates) =====

/**
 * Partial learning schema for proposals (without status/approved_at fields)
 * These fields are managed by the proposal workflow, not the learning itself.
 */
export const ProposalLearningSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  source: z.nativeEnum(MemoryBankSource),
  source_id: z.string().optional(),
  scope: z.nativeEnum(MemoryScope),
  project: z.string().optional(),
  title: z.string().max(100),
  description: z.string().max(2000),
  category: z.nativeEnum(LearningCategory),
  tags: z.array(z.string()).max(10).optional().default([]),
  confidence: z.nativeEnum(ConfidenceAssessmentLevel),
  extracted_at: z.string().datetime().optional().describe("ISO timestamp when this learning was extracted"),
  references: z.array(LearningReferenceSchema).optional(),
});

/**
 * Memory Update Proposal - represents a proposed memory change
 *
 * Proposals are written to Memory/Pending/ and flow through
 * a review workflow: pending → approved/rejected
 */
export const MemoryUpdateProposalSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),

  operation: z.nativeEnum(MemoryOperation)
    .describe("Type of memory operation"),
  target_scope: z.nativeEnum(MemoryScope)
    .describe("Where the learning should be stored"),
  target_project: z.string().optional()
    .describe("Portal name if target_scope is 'project'"),

  learning: ProposalLearningSchema.describe("The proposed learning content"),

  reason: z.string().describe("Why this update is proposed"),
  identity_id: z.string().describe("Identity (blueprint name) that proposed the update"),
  execution_id: z.string().optional().describe("Related execution trace_id"),

  status: z.enum(MEMORY_STATUS_VALUES)
    .describe("Current proposal status"),
  reviewed_at: z.string().datetime().optional(),
  reviewed_by: z.nativeEnum(ReviewSource).optional(),
});

export type IProposalLearning = z.infer<typeof ProposalLearningSchema>;
export type IMemoryUpdateProposal = z.infer<typeof MemoryUpdateProposalSchema>;

// ===== Skill Schemas (Phase 17: Skills Architecture) =====

/**
 * Skill trigger conditions - determines when a skill should be activated
 */
export const SkillTriggersSchema = z.object({
  /** Keywords that trigger this skill (e.g., "implement", "security", "test") */
  keywords: z.array(z.string()).optional(),
  /** Task types this skill applies to (e.g., "feature", "bugfix", "refactor") */
  task_types: z.array(z.string()).optional(),
  /** File patterns that trigger this skill (glob patterns) */
  file_patterns: z.array(z.string()).optional(),
  /** Tags for matching (e.g., "testing", "security") */
  tags: z.array(z.string()).optional(),
});

/**
 * Quality criterion for skill evaluation
 */
export const SkillQualityCriterionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  weight: z.number().min(0).max(100).default(DEFAULT_QUERY_LIMIT),
});

/**
 * Skill compatibility constraints
 */
export const SkillCompatibilitySchema = z.object({
  /** Agent IDs this skill is compatible with ("*" for all) */
  agents: z.array(z.string()).default(["*"]),
  /** Flow IDs this skill can be used in */
  flows: z.array(z.string()).optional(),
});

/**
 * Skill - Procedural memory for how to accomplish tasks
 *
 * Unlike Learnings (observations) or Patterns (structures),
 * Skills are actionable instructions that agents apply.
 *
 * Skills encode domain expertise, procedures, and best practices
 * as reusable instruction modules.
 */
export const SkillSchema = z.object({
  // === Memory Bank Standard Fields ===
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  source: z.nativeEnum(MemoryBankSource).describe("Origin of the skill"),
  source_id: z.string().optional().describe("Learning IDs if derived"),

  scope: z.nativeEnum(MemoryScope).describe("Applicability scope"),
  project: z.string().optional().describe("Portal name if project-scoped"),

  status: z.nativeEnum(SkillStatus).describe("Skill lifecycle status"),

  // === Skill Identity ===
  skill_id: z.string().regex(/^[a-z0-9-]+$/).describe("Unique skill identifier (kebab-case)"),
  name: z.string().min(1).max(100).describe("Human-readable skill name"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).describe("Semantic version"),
  description: z.string().describe("Brief description of what the skill does"),

  // === Trigger Conditions ===
  triggers: SkillTriggersSchema.describe("Conditions for automatic activation"),

  // === Procedural Knowledge ===
  instructions: z.string().min(10).describe("The procedural instructions (markdown)"),

  // === Constraints and Quality ===
  constraints: z.array(z.string()).optional().describe("Rules that must be followed"),
  output_requirements: z.array(z.string()).optional().describe("Expected output format/content"),
  quality_criteria: z.array(SkillQualityCriterionSchema).optional().describe("Evaluation criteria"),

  // === Compatibility ===
  compatible_with: SkillCompatibilitySchema.optional().describe("Compatibility constraints"),

  // === Evolution Tracking ===
  derived_from: z.array(z.string()).optional().describe("Learning IDs this skill was derived from"),
  effectiveness_score: z.number().min(0).max(100).optional().describe("Measured effectiveness"),
  usage_count: z.number().default(0).describe("Number of times skill has been used"),
});

export type ISkillTriggers = z.infer<typeof SkillTriggersSchema>;
export type ISkillQualityCriterion = z.infer<typeof SkillQualityCriterionSchema>;
export type ISkillCompatibility = z.infer<typeof SkillCompatibilitySchema>;
export type ISkill = z.infer<typeof SkillSchema>;

/**
 * Skill fields that are automatically managed by the system.
 */
export type SkillManagedFields = `${SkillManagedField}`;

/**
 * Skill fields that cannot be changed after creation.
 */
export type SkillImmutableFields = `${SkillImmutableField}`;

/**
 * Skill interface without system-managed fields.
 */
export type SkillDefinition = Omit<ISkill, SkillManagedFields>;

/**
 * Skill updates interface.
 */
export type SkillUpdates = Partial<Omit<ISkill, SkillImmutableFields>>;

/**
 * Skill index entry for fast lookup
 */
export const SkillIndexEntrySchema = z.object({
  skill_id: z.string(),
  name: z.string(),
  version: z.string(),
  status: z.nativeEnum(SkillStatus),
  scope: z.nativeEnum(MemoryScope),
  project: z.string().optional(),
  triggers: SkillTriggersSchema,
  path: z.string().describe("Relative path to skill file"),
});

/**
 * Skill index for the Memory/Skills/ directory
 */
export const SkillIndexSchema = z.object({
  version: z.string().default(DEFAULT_SKILL_INDEX_VERSION),
  updated_at: z.string().datetime(),
  skills: z.array(SkillIndexEntrySchema),
});

export type ISkillIndexEntry = z.infer<typeof SkillIndexEntrySchema>;
export type ISkillIndex = z.infer<typeof SkillIndexSchema>;

// ===== Helper Types =====
