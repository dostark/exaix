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

/** The optional filters of an artifact listing. */
interface IArtifactRecordFilters {
  status?: string;
  agent_role?: string;
  portal?: string | null;
  type?: string;
}

// unslop-ignore-next-line unused-type
/** The fields of a new artifact row. The update time and the rejection reason start empty. */
export interface INewArtifactRecord {
  id: string;
  status: string;
  type: string;
  agent_role: string;
  portal: string | null;
  target_branch: string | null;
  created: string;
  request_id: string;
  file_path: string;
}

export interface IArtifactRepository {
  createArtifactRecord(record: INewArtifactRecord): Promise<void>;

  updateArtifactStatus(
    id: string,
    status: string,
    updated: string,
    rejectionReason: string | null,
  ): Promise<void>;

  getArtifactRecord(id: string): Promise<IArtifactRow | undefined>;

  listArtifactRecords(filters?: Opt<IArtifactRecordFilters, Reason.QueryFilter>): Promise<IArtifactRow[]>;
}

export class DatabaseArtifactRepository implements IArtifactRepository {
  constructor(private db: IDatabaseService) {}

  async createArtifactRecord(record: INewArtifactRecord): Promise<void> {
    await this.db.preparedRun(
      `INSERT INTO artifacts (id, status, type, agent_role, portal, target_branch, created, request_id, file_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.status,
        record.type,
        record.agent_role,
        record.portal,
        record.target_branch,
        record.created,
        record.request_id,
        record.file_path,
      ],
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

  async listArtifactRecords(filters?: Opt<IArtifactRecordFilters, Reason.QueryFilter>): Promise<IArtifactRow[]> {
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
