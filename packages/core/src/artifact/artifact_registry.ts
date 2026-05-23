/**
 * @module ArtifactRegistry
 * @path packages/core/src/artifact/artifact_registry.ts
 * @description Manages analysis artifacts produced by agents, storing them as markdown files with frontmatter.
 * @architectural-layer Services
 * @related-files ["packages/execution/src/agent_runner.ts", "packages/execution/src/execution_loop.ts"]
 */

import { join } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import type { IDatabaseService } from "@exaix/storage-sqlite";
import type {
  IArtifact,
  IArtifactFilters,
  IArtifactFrontmatter,
  IArtifactWithContent,
} from "@exaix/schemas/artifact.ts";
import { coerceReviewStatus, ReviewStatus } from "@exaix/core/status";
import { DEFAULT_EXECUTION_MEMORY_PATH, DEFAULT_MEMORY_PATH } from "@exaix/core";
import type { IReviewStatus } from "@exaix/core/status";

interface IArtifactRow {
  id: string;
  status: string;
  type: string;
  identity: string;
  portal: string | null;
  target_branch: string | null;
  created: string;
  updated: string | null;
  request_id: string;
  file_path: string;
  rejection_reason: string | null;
}

/**
 * Generate short ID for artifacts
 */
function shortId(): string {
  return crypto.randomUUID().split("-")[0];
}

import { ArtifactSubtype as ArtifactType } from "@exaix/core";

/**
 * Service for managing read-only agent artifacts
 */
export class ArtifactRegistry {
  private mapArtifactRow(row: IArtifactRow): IArtifact {
    return {
      id: row.id,
      status: coerceReviewStatus(row.status),
      type: row.type as ArtifactType,
      identity: row.identity,
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
    private db: IDatabaseService,
    rootDir: string = Deno.cwd(),
  ) {
    this.rootDir = rootDir;
  }

  /**
   * Create new artifact from identity execution
   */
  async createArtifact(
    requestId: string,
    identity: string,
    content: string,
    portal?: string,
    targetBranch?: string,
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
      identity,
      portal: portal || null,
      target_branch: targetBranch?.trim() ? targetBranch.trim() : null,
      created,
      request_id: requestId,
    };

    // Write file with frontmatter + content
    const fileContent = `---\n${stringifyYaml(frontmatter)}---\n\n${content}`;
    await Deno.writeTextFile(absoluteFilePath, fileContent);

    // Save to database
    await this.db.preparedRun(
      `INSERT INTO artifacts (id, status, type, identity, portal, target_branch, created, request_id, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        artifactId,
        ReviewStatus.PENDING,
        "analysis",
        identity,
        portal || null,
        targetBranch?.trim() ? targetBranch.trim() : null,
        created,
        requestId,
        relativeFilePath,
      ],
    );

    return artifactId;
  }

  /**
   * Update artifact status (approve/reject)
   */
  async updateStatus(
    artifactId: string,
    status: Exclude<IReviewStatus, typeof ReviewStatus.PENDING>,
    reason?: string,
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
    await this.db.preparedRun(
      `UPDATE artifacts SET status = ?, updated = ?, rejection_reason = ? WHERE id = ?`,
      [status, now, reason || null, artifactId],
    );
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
    const rows = await this.db.preparedAll<IArtifactRow>(
      `SELECT id, status, type, identity, portal, target_branch, created, updated, request_id, file_path, rejection_reason
       FROM artifacts WHERE id = ?`,
      [artifactId],
    );

    if (rows.length === 0) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    return this.mapArtifactRow(rows[0]);
  }

  /**
   * List artifacts with filters
   */
  async listArtifacts(filters?: IArtifactFilters): Promise<IArtifact[]> {
    let query =
      `SELECT id, status, type, identity, portal, target_branch, created, updated, request_id, file_path, rejection_reason
                 FROM artifacts WHERE 1=1`;
    const params: (string | null)[] = [];

    if (filters?.status) {
      query += ` AND status = ?`;
      params.push(filters.status);
    }

    if (filters?.identity) {
      query += ` AND identity = ?`;
      params.push(filters.identity);
    }

    if (filters?.portal !== undefined) {
      query += ` AND portal = ?`;
      params.push(filters.portal);
    }

    if (filters?.type) {
      query += ` AND type = ?`;
      params.push(filters.type);
    }

    query += ` ORDER BY created DESC`;

    const rows = await this.db.preparedAll<IArtifactRow>(query, params);

    return rows.map((row) => this.mapArtifactRow(row));
  }
}
