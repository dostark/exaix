/**
 * @module ArtifactRegistry
 * @path packages/core/src/artifact/artifact_registry.ts
 * @description Manages analysis artifacts produced by agents, storing them as markdown files with frontmatter.
 * @architectural-layer Services
 * @related-files ["packages/execution/src/agent_runner.ts", "packages/execution/src/execution_loop.ts"]
 */

import { join } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import type {
  IArtifact,
  IArtifactFilters,
  IArtifactFrontmatter,
  IArtifactWithContent,
} from "@exaix/schemas/artifact.ts";
import { coerceReviewStatus, ReviewStatus } from "@exaix/core/status";
import type { Opt, Reason } from "@exaix/core/types";
import { ArtifactSubtype as ArtifactType, DEFAULT_EXECUTION_MEMORY_PATH, DEFAULT_MEMORY_PATH } from "@exaix/core";
import type { IReviewStatus } from "@exaix/core/status";
import type { IArtifactRepository, IArtifactRow } from "./artifact_repository.ts";

/**
 * Generate short ID for artifacts
 */
function shortId(): string {
  return crypto.randomUUID().split("-")[0];
}

/**
 * Service for managing read-only agent artifacts
 */
export class ArtifactRegistry {
  private mapArtifactRow(row: IArtifactRow): IArtifact {
    return {
      id: row.id,
      status: coerceReviewStatus(row.status),
      type: row.type as ArtifactType,
      agent_role: row.agent_role,
      portal: row.portal,
      target_branch: row.target_branch,
      created: row.created,
      updated: row.updated,
      request_id: row.request_id,
      file_path: row.file_path,
      rejection_reason: row.rejection_reason,
    };
  }

  private rootDir: string;

  constructor(
    private repo: IArtifactRepository,
    rootDir: string = Deno.cwd(),
  ) {
    this.rootDir = rootDir;
  }

  /**
   * Create new artifact from agent role execution
   */
  async createArtifact(
    requestId: string,
    agent_role: string,
    content: string,
    portal?: Opt<string, Reason.OptionalContext>,
    targetBranch?: Opt<string, Reason.OptionalContext>,
  ): Promise<string> {
    const artifactId = `artifact-${shortId()}`;
    const relativeFilePath = join(DEFAULT_MEMORY_PATH, DEFAULT_EXECUTION_MEMORY_PATH, `${artifactId}.md`);
    const absoluteFilePath = join(this.rootDir, relativeFilePath);
    const created = new Date().toISOString();

    // Ensure Memory/Execution directory exists
    await Deno.mkdir(join(this.rootDir, DEFAULT_MEMORY_PATH, DEFAULT_EXECUTION_MEMORY_PATH), { recursive: true });

    // Create frontmatter
    const frontmatter: IArtifactFrontmatter = {
      status: ReviewStatus.PENDING,
      type: ArtifactType.ANALYSIS,
      agent_role,
      portal: portal || null,
      target_branch: targetBranch?.trim() ? targetBranch.trim() : null,
      created,
      request_id: requestId,
    };

    // Write file with frontmatter + content
    const fileContent = `---\n${stringifyYaml(frontmatter)}---\n\n${content}`;
    await Deno.writeTextFile(absoluteFilePath, fileContent);

    // Save to database
    await this.repo.createArtifactRecord(
      artifactId,
      ReviewStatus.PENDING,
      "analysis",
      agent_role,
      portal || null,
      targetBranch?.trim() ? targetBranch.trim() : null,
      created,
      requestId,
      relativeFilePath,
    );

    return artifactId;
  }

  /**
   * Update artifact status (approve/reject)
   */
  async updateStatus(
    artifactId: string,
    status: Exclude<IReviewStatus, typeof ReviewStatus.PENDING>,
    reason?: Opt<string, Reason.OptionalInput>,
  ): Promise<void> {
    const artifact = await this.getArtifactRecord(artifactId);

    // Read current content
    const fullContent = await Deno.readTextFile(join(this.rootDir, artifact.file_path));

    // Parse frontmatter
    const match = fullContent.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
    if (!match) {
      throw new Error(`Invalid artifact format: ${artifactId}`);
    }

    const frontmatter = parseYaml(match[1]) as IArtifactFrontmatter;
    const body = match[2];

    // Update frontmatter
    frontmatter.status = status;

    // Write updated file
    const updated = `---\n${stringifyYaml(frontmatter)}---\n\n${body}`;
    await Deno.writeTextFile(join(this.rootDir, artifact.file_path), updated);

    // Update database
    const now = new Date().toISOString();
    await this.repo.updateArtifactStatus(artifactId, status, now, reason || null);
  }

  /**
   * Get artifact with content
   */
  async getArtifact(artifactId: string): Promise<IArtifactWithContent> {
    const artifact = await this.getArtifactRecord(artifactId);

    // Read file content
    const content = await Deno.readTextFile(join(this.rootDir, artifact.file_path));

    // Parse to extract body
    const match = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
    const body = match ? match[1] : "";

    return {
      ...artifact,
      content,
      body,
    };
  }

  /**
   * Get artifact database record
   */
  private async getArtifactRecord(artifactId: string): Promise<IArtifact> {
    const row = await this.repo.getArtifactRecord(artifactId);

    if (!row) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    return this.mapArtifactRow(row);
  }

  /**
   * List artifacts with filters
   */
  async listArtifacts(filters?: Opt<IArtifactFilters, Reason.QueryFilter>): Promise<IArtifact[]> {
    const rows = await this.repo.listArtifactRecords(filters);
    return rows.map((row) => this.mapArtifactRow(row));
  }
}
