/**
 * @module IJournalService
 * @path packages/core/src/types/i_journal_service.ts
 * @description Formal service interface for Journal operations consumed by the TUI.
 * @architectural-layer Shared
 * @related-files [apps/common/adapters/journal_adapter.ts, "packages/storage-sqlite/src/database_service.ts"]
 */

import type { IActivityRecord, IJournalFilterOptions } from "@exaix/core/types";

/**
 * Service interface for Journal (Activity Log) operations consumed by the TUI.
 */
export interface IJournalService {
  /**
   * Query activities based on filters.
   */
  query(filters: IJournalFilterOptions): Promise<IActivityRecord[]>;

  /**
   * Get distinct values for a specific field in the database.
   * Useful for population filter dropdowns.
   */
  getDistinctValues(field: string): Promise<string[]>;
}
