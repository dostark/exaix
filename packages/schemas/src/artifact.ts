/**
 * @module ArtifactSchema
 * @path src/shared/schemas/artifact.ts
 * @description Defines schemas for analysis artifacts produced by read-only agents, stored as markdown files with YAML frontmatter.
 * @architectural-layer Schemas
 * @related-files [src/services/artifact_registry.ts, apps/exactl/src/review_commands.ts]
 */

import { z } from "zod";
import { ArtifactSubtype as ArtifactType } from "@exaix/core";
import { REVIEW_STATUS_VALUES, ReviewStatus as ReviewStatusValue } from "@exaix/core/status";

import type { IReviewStatus } from "@exaix/core/status";

/**
 * Artifact status values
 */
export const ArtifactStatus = ReviewStatusValue;

export type IArtifactStatusType = IReviewStatus;

/**
 * Artifact frontmatter schema (YAML)
 */
export const ArtifactFrontmatterSchema = z.object({
  status: z.enum(REVIEW_STATUS_VALUES),
  type: z.nativeEnum(ArtifactType),
  identity: z.string(),
  portal: z.string().nullable().optional(),
  target_branch: z.string().nullable().optional(),
  created: z.string(), // ISO 8601 timestamp
  request_id: z.string(),
});

export type IArtifactFrontmatter = z.infer<typeof ArtifactFrontmatterSchema>;

/**
 * Artifact database record schema
 */
export const ArtifactSchema = z.object({
  id: z.string(),
  status: z.enum(REVIEW_STATUS_VALUES),
  type: z.nativeEnum(ArtifactType),
  identity: z.string(),
  portal: z.string().nullable().optional(),
  target_branch: z.string().nullable().optional(),
  created: z.string(), // ISO 8601 timestamp
  updated: z.string().nullable().optional(), // ISO 8601 timestamp
  request_id: z.string(),
  file_path: z.string(), // Path to markdown file in Memory/Execution/
  rejection_reason: z.string().nullable().optional(),
});

export type IArtifact = z.infer<typeof ArtifactSchema>;

/**
 * Artifact with content (file content loaded)
 */
export interface IArtifactWithContent extends IArtifact {
  content: string; // Full markdown content with frontmatter
  body: string; // Markdown content without frontmatter
}

/**
 * Artifact creation input
 */
export const CreateArtifactInputSchema = z.object({
  request_id: z.string(),
  identity: z.string(),
  content: z.string(), // Markdown content (frontmatter will be added)
  portal: z.string().nullable().optional(),
  target_branch: z.string().nullable().optional(),
  type: z.nativeEnum(ArtifactType).default(ArtifactType.ANALYSIS),
});

export type ICreateArtifactInput = z.infer<typeof CreateArtifactInputSchema>;

/**
 * Artifact list filters
 */
export const ArtifactFiltersSchema = z.object({
  status: z.enum(REVIEW_STATUS_VALUES).optional(),
  identity: z.string().optional(),
  portal: z.string().nullable().optional(),
  type: z.nativeEnum(ArtifactType).optional(),
}).partial();

export type IArtifactFilters = z.infer<typeof ArtifactFiltersSchema>;
