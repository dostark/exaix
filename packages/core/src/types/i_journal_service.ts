/**
 * @module IJournalService
 * @path packages/core/src/types/i_journal_service.ts
 * @description Formal service interface for Journal operations consumed by the TUI.
 * @architectural-layer Shared
 * @related-files [src/services/adapters/journal_adapter.ts, "src/services/core/db.ts"]
 */

import type { IActivityRecord, IJournalFilterOptions } from "@exaix/core/types/database.ts";

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
