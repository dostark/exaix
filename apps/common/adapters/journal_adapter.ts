/**
 * @module JournalAdapter
 * @path apps/common/adapters/journal_adapter.ts
 * @description Adapter for Journal Service using DatabaseService.
 * @architectural-layer Services
 * @related-files ["packages/storage-sqlite/src/database_service.ts", @exaix/core/types]
 */

import type { IJournalService } from "@exaix/core/types";
import type { IDatabaseService } from "@exaix/core/types";
import type { IActivityRecord, IJournalFilterOptions } from "@exaix/core/types";

export class JournalServiceAdapter implements IJournalService {
  constructor(private db: IDatabaseService) {}

  /**
   * Query the activity journal.
   */
  async query(filters: IJournalFilterOptions): Promise<IActivityRecord[]> {
    return await this.db.queryActivity(filters);
  }

  /** Get distinct values for a field (actor, agent_role, action_type, or target). */
  async getDistinctValues(field: string): Promise<string[]> {
    // Only allow specific fields for security and performance
    const allowedFields = ["actor", "agent_role", "action_type", "target"];
    if (!allowedFields.includes(field)) {
      return [];
    }

    try {
      // Use direct SQL query via DatabaseService's preparedAll method
      const results = await this.db.preparedAll<Record<string, string | null>>(
        `SELECT DISTINCT ${field} FROM activity WHERE ${field} IS NOT NULL ORDER BY ${field} ASC`,
      );

      return results
        .map((row) => row[field])
        .filter((val): val is string => val !== null);
    } catch (error) {
      console.error(`Error fetching distinct values for field '${field}':`, error);
      return [];
    }
  }
}
