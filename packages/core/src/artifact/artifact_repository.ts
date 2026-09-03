/**
 * @module ArtifactRepository
 * @path packages/core/src/artifact/artifact_repository.ts
 * @architectural-layer Core
 * @dependencies ["@exaix/storage-sqlite"]
 * @related-files ["packages/core/src/artifact/artifact_registry.ts"]
 * @description Narrow repository interface for artifact table CRUD operations.
 * Encapsulates IDatabaseService behind focused read/write methods so that
 * consumers like ArtifactRegistry do not depend on the full database service.
 */

import type { IDatabaseService } from "@exaix/core/types";
import type { Opt, Reason } from "@exaix/core/types";

export interface IArtifactRow {
  id: string;
  status: string;
  type: string;
  agent_role: string;
  portal: string | null;
  target_branch: string | null;
  created: string;
  updated: string | null;
  request_id: string;
  file_path: string;
  rejection_reason: string | null;
}

export interface IArtifactRepository {
  createArtifactRecord(
    id: string,
    status: string,
    type: string,
    agent_role: string,
    portal: string | null,
    targetBranch: string | null,
    created: string,
    requestId: string,
    filePath: string,
  ): Promise<void>;

  updateArtifactStatus(
    id: string,
    status: string,
    updated: string,
    rejectionReason: string | null,
  ): Promise<void>;

  getArtifactRecord(id: string): Promise<IArtifactRow | undefined>;

  listArtifactRecords(filters?: {
    status?: string;
    agent_role?: string;
    portal?: string | null;
    type?: string;
  }): Promise<IArtifactRow[]>;
}

export class DatabaseArtifactRepository implements IArtifactRepository {
  constructor(private db: IDatabaseService) {}

  async createArtifactRecord(
    id: string,
    status: string,
    type: string,
    agent_role: string,
    portal: string | null,
    targetBranch: string | null,
    created: string,
    requestId: string,
    filePath: string,
  ): Promise<void> {
    await this.db.preparedRun(
      `INSERT INTO artifacts (id, status, type, agent_role, portal, target_branch, created, request_id, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, status, type, agent_role, portal, targetBranch, created, requestId, filePath],
    );
  }

  async updateArtifactStatus(
    id: string,
    status: string,
    updated: string,
    rejectionReason: string | null,
  ): Promise<void> {
    await this.db.preparedRun(
      `UPDATE artifacts SET status = ?, updated = ?, rejection_reason = ? WHERE id = ?`,
      [status, updated, rejectionReason, id],
    );
  }

  async getArtifactRecord(id: string): Promise<IArtifactRow | undefined> {
    const rows = await this.db.preparedAll<IArtifactRow>(
      `SELECT id, status, type, agent_role, portal, target_branch, created, updated, request_id, file_path, rejection_reason
       FROM artifacts WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  async listArtifactRecords(
    filters?: Opt<{
      status?: string;
      agent_role?: string;
      portal?: string | null;
      type?: string;
    }, Reason.QueryFilter>,
  ): Promise<IArtifactRow[]> {
    let query =
      `SELECT id, status, type, agent_role, portal, target_branch, created, updated, request_id, file_path, rejection_reason
       FROM artifacts WHERE 1=1`;
    const params: (string | null)[] = [];

    if (filters?.status) {
      query += ` AND status = ?`;
      params.push(filters.status);
    }
    if (filters?.agent_role) {
      query += ` AND agent_role = ?`;
      params.push(filters.agent_role);
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

    return await this.db.preparedAll<IArtifactRow>(query, params);
  }
}
